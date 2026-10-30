import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, session, shell, Tray } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, NativeImage } from 'electron';
import type { AppState, BatchResult, Preferences, PreparedBatch } from '../shared/types';
import { getPetWindowSize } from '../shared/pet-layout';
import { deriveGrowth } from '../shared/growth';
import { FileService } from './file-service';
import { StateStore } from './state-store';
import { getProfilePath } from './profile';
import { BatchOwnership, CHANNELS, clampBounds, getPetSettingsBounds, parsePreferencePatch, PendingPreferenceWrites, permanentDeletionDetail, PetDragSession } from './host-policy';

const APP_NAME = 'file muncher';
const batchOwnership = new BatchOwnership();
const petDragSession = new PetDragSession();
const pendingPreferenceWrites = new PendingPreferenceWrites();
const expectedUrls = new Map<number, string>();
let mainWindow: BrowserWindow | null = null;
let petWindow: BrowserWindow | null = null;
let petSettingsWindow: BrowserWindow | null = null;
let petSettingsPointerHeld = false;
let petSettingsDismissalSequence = 0;
let pendingPetSettingsDismissal: number | undefined;
let tray: Tray | null = null;
let stateStore: StateStore;
let fileService: FileService;
let executing = false;
let quitRequested = false;
let quitting = false;

app.setName(APP_NAME);
const profilePath = getProfilePath(app.getPath('appData'), process.env['FILE_MUNCHER_USER_DATA']);
mkdirSync(profilePath, { recursive: true });
app.setPath('userData', profilePath);

const hasLock = process.env['FILE_MUNCHER_SMOKE'] === '1' || app.requestSingleInstanceLock();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误。';
}

function assertSender(event: IpcMainInvokeEvent | IpcMainEvent): BrowserWindow {
  const source = BrowserWindow.fromWebContents(event.sender);
  const expectedUrl = expectedUrls.get(event.sender.id);
  if (!source || source.isDestroyed() || !expectedUrl || event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== expectedUrl) {
    throw new Error('不允许此窗口执行文件操作。');
  }
  return source;
}

function assertPetSender(event: IpcMainInvokeEvent | IpcMainEvent): BrowserWindow {
  const source = assertSender(event);
  if (source !== petWindow) throw new Error('只有桌面宠物窗口可以执行此操作。');
  return source;
}

function assertFileSender(event: IpcMainInvokeEvent): BrowserWindow {
  const source = assertSender(event);
  if (source !== mainWindow && source !== petWindow) throw new Error('此窗口不能处理文件。');
  return source;
}

function iconPath(): string {
  return path.join(app.getAppPath(), 'dist', 'icon.png');
}

function broadcastState(): AppState {
  const state = stateStore.getState();
  positionPetSettings();
  for (const window of [mainWindow, petWindow, petSettingsWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(CHANNELS.stateChanged, state);
  }
  rebuildTrayMenu();
  return state;
}

function secureWindow(window: BrowserWindow, view: 'main' | 'pet' | 'pet-settings'): void {
  const entryPath = path.join(app.getAppPath(), 'dist', 'index.html');
  expectedUrls.set(window.webContents.id, `${pathToFileURL(entryPath).href}?view=${view}`);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  const ownerId = window.webContents.id;
  window.webContents.on('destroyed', () => {
    expectedUrls.delete(ownerId);
    for (const token of batchOwnership.removeOwner(ownerId)) fileService.cancel(token);
  });
  void window.loadFile(entryPath, { query: { view } }).catch(error => {
    dialog.showErrorBox('无法打开 file muncher', errorMessage(error));
  });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1120,
    height: 800,
    minWidth: 940,
    minHeight: 700,
    title: APP_NAME,
    backgroundColor: '#f7f4ee',
    show: false,
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow = window;
  window.once('ready-to-show', () => window.show());
  window.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
    showPet();
    void savePreferences({ petVisible: true }).catch(error => {
      dialog.showErrorBox('设置暂未保存', errorMessage(error));
    });
  });
  window.on('closed', () => { mainWindow = null; });
  secureWindow(window, 'main');
  return window;
}

function openMainWindow(): void {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createMainWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function keepPetOnScreen(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const bounds = petWindow.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const clamped = clampBounds(bounds, workArea);
  if (clamped.x !== bounds.x || clamped.y !== bounds.y) petWindow.setBounds(clamped);
  positionPetSettings();
}

function createPetWindow(): BrowserWindow {
  const workArea = screen.getPrimaryDisplay().workArea;
  const size = getPetWindowSize(stateStore.getState().preferences.petSize);
  const window = new BrowserWindow({
    ...clampBounds({ x: workArea.x + workArea.width - size.width - 24,
      y: workArea.y + workArea.height - size.height - 24, ...size }, workArea),
    title: `${APP_NAME} · 桌面宠物`,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  petWindow = window;
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.once('ready-to-show', () => {
    if (stateStore.getState().preferences.petVisible) window.showInactive();
  });
  window.on('moved', keepPetOnScreen);
  window.on('hide', () => petDragSession.end());
  window.on('blur', () => petDragSession.end());
  window.webContents.on('before-mouse-event', (_event, input) => {
    if (input.type === 'mouseUp') petDragSession.end();
  });
  window.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    void savePreferences({ petVisible: false }).catch(error => {
      dialog.showErrorBox('设置暂未保存', errorMessage(error));
    });
  });
  window.on('closed', () => { petDragSession.end(); petWindow = null; });
  secureWindow(window, 'pet');
  return window;
}

function showPet(): void {
  const window = petWindow && !petWindow.isDestroyed() ? petWindow : createPetWindow();
  keepPetOnScreen();
  if (!window.isVisible()) window.showInactive();
}

function keepPetSettingsOnScreen(): void {
  if (!petSettingsWindow || petSettingsWindow.isDestroyed()) return;
  const bounds = petSettingsWindow.getBounds();
  const clamped = clampBounds(bounds, screen.getDisplayMatching(bounds).workArea);
  if (clamped.x !== bounds.x || clamped.y !== bounds.y) petSettingsWindow.setBounds(clamped);
}

function positionPetSettings(): void {
  if (petSettingsPointerHeld || pendingPreferenceWrites.hasPending || !petSettingsWindow || petSettingsWindow.isDestroyed() ||
    !petSettingsWindow.isVisible() || !petWindow || petWindow.isDestroyed()) return;
  const petBounds = petWindow.getBounds();
  const state = stateStore.getState();
  const bounds = getPetSettingsBounds(petBounds, screen.getDisplayMatching(petBounds).workArea,
    state.preferences.theme, deriveGrowth(state.stats).scale);
  const current = petSettingsWindow.getBounds();
  if (current.x !== bounds.x || current.y !== bounds.y) petSettingsWindow.setBounds(bounds);
}

function openPetSettingsWindow(pet: BrowserWindow): void {
  pendingPetSettingsDismissal = undefined;
  const petBounds = pet.getBounds();
  const state = stateStore.getState();
  const bounds = getPetSettingsBounds(petBounds, screen.getDisplayMatching(petBounds).workArea,
    state.preferences.theme, deriveGrowth(state.stats).scale);
  if (petSettingsWindow && !petSettingsWindow.isDestroyed()) {
    petSettingsWindow.setBounds(bounds);
    petSettingsWindow.show();
    petSettingsWindow.focus();
    return;
  }
  const window = new BrowserWindow({
    ...bounds,
    title: `${APP_NAME} · 宠物大小`,
    backgroundColor: '#fcfff7',
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  petSettingsWindow = window;
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.once('ready-to-show', () => { window.show(); window.focus(); });
  window.webContents.on('before-mouse-event', (_event, input) => {
    if (input.type === 'mouseDown') petSettingsPointerHeld = true;
    if (input.type === 'mouseUp') { petSettingsPointerHeld = false; positionPetSettings(); }
  });
  window.on('focus', () => { pendingPetSettingsDismissal = undefined; });
  window.on('blur', () => {
    petSettingsPointerHeld = false;
    if (quitRequested || window !== petSettingsWindow || window.webContents.isDestroyed()) return;
    pendingPetSettingsDismissal = ++petSettingsDismissalSequence;
    window.webContents.send(CHANNELS.petSettingsDismissRequested, pendingPetSettingsDismissal);
  });
  window.on('moved', keepPetSettingsOnScreen);
  window.on('closed', () => { petSettingsWindow = null; petSettingsPointerHeld = false; pendingPetSettingsDismissal = undefined; });
  secureWindow(window, 'pet-settings');
}

function applyVisibility(state: AppState): void {
  if (state.preferences.petVisible) showPet();
  else {
    petWindow?.hide();
    petSettingsWindow?.close();
  }
}

function applyPetSize(state: AppState): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const bounds = petWindow.getBounds();
  const size = getPetWindowSize(state.preferences.petSize);
  if (bounds.width === size.width && bounds.height === size.height) return;
  petDragSession.end();
  petWindow.setBounds(clampBounds({ ...bounds, ...size }, screen.getDisplayMatching(bounds).workArea));
}

async function savePreferences(patch: Partial<Preferences>): Promise<AppState> {
  pendingPreferenceWrites.begin();
  try {
    await stateStore.updatePreferences(patch);
  } finally {
    try {
      if (!quitRequested) {
        applyPetSize(stateStore.getState());
        applyVisibility(stateStore.getState());
      }
      broadcastState();
    } finally {
      pendingPreferenceWrites.finish();
      positionPetSettings();
      resumeRequestedQuit();
    }
  }
  return stateStore.getState();
}

function resumeRequestedQuit(): void {
  if (quitRequested && !executing && !pendingPreferenceWrites.hasPending) setImmediate(() => app.quit());
}

function trayIcon(): NativeImage {
  const rows = ['0000000000000000', '0000110000110000', '0000111111110000', '0011111111111100',
    '0011001111001100', '0011001111001100', '0011111111111100', '0011111111111100',
    '0011100000011100', '0011100000011100', '0011111111111100', '0001111111111000',
    '0000110000110000', '0000110000110000', '0000000000000000', '0000000000000000'];
  const bitmap = Buffer.alloc(16 * 16 * 4);
  rows.forEach((row, y) => [...row].forEach((pixel, x) => {
    if (pixel === '1') bitmap[(y * 16 + x) * 4 + 3] = 255;
  }));
  const icon = nativeImage.createFromBitmap(bitmap, { width: 16, height: 16 });
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  return icon;
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const visible = stateStore.getState().preferences.petVisible;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 file muncher', click: openMainWindow },
    { label: visible ? '隐藏桌面宠物' : '显示桌面宠物', click: () => {
      void savePreferences({ petVisible: !stateStore.getState().preferences.petVisible }).catch(error => {
        dialog.showErrorBox('设置暂未保存', errorMessage(error));
      });
    } },
    { type: 'separator' },
    { label: '退出 file muncher', click: () => app.quit() },
  ]));
}

async function prepareBatch(paths: unknown, owner: number): Promise<PreparedBatch> {
  if (quitRequested) throw new Error('file muncher 正在退出，请下次打开后再拖入。');
  if (executing) throw new Error('粉碎机正在处理文件，请稍后再拖入。');
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 200 ||
      !paths.every((item: unknown) => typeof item === 'string' && item.length > 0 && item.length < 32768 && !item.includes('\0'))) {
    throw new Error('拖入的文件列表无效。');
  }
  batchOwnership.beginPreparation(owner);
  try {
    for (const token of batchOwnership.removeOwner(owner)) fileService.cancel(token);
    const batch = await fileService.prepare(paths as string[], stateStore.getState().preferences.deletionMode);
    if (quitRequested || !expectedUrls.has(owner)) {
      fileService.cancel(batch.token);
      throw new Error('窗口已关闭或应用正在退出，请重新打开后拖入。');
    }
    batchOwnership.add(batch.token, owner);
    return batch;
  } finally {
    batchOwnership.finishPreparation(owner);
  }
}

async function executeBatch(event: IpcMainInvokeEvent, token: unknown): Promise<BatchResult> {
  const owner = assertFileSender(event);
  if (quitRequested) throw new Error('file muncher 正在退出，未开始新的文件操作。');
  if (executing) throw new Error('粉碎机正在处理另一批文件，请稍后重试。');
  if (typeof token !== 'string' || token.length === 0 || token.length > 128) throw new Error('文件批次无效。');
  batchOwnership.begin(token, event.sender.id);
  executing = true;
  try {
    const batch = fileService.getBatch(token);
    if (!batch) throw new Error('这批文件已过期，请重新拖入。');
    if (batch.mode === 'permanent' && batch.entries.length > 0) {
      const confirmation = await dialog.showMessageBox(owner, {
        type: 'warning',
        title: '确认永久删除',
        message: '永久删除这些文件？',
        detail: permanentDeletionDetail(batch),
        buttons: ['取消', '永久删除'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (confirmation.response !== 1) {
        return { items: [], cancelled: true, state: stateStore.getState() };
      }
    }
    const items = await fileService.execute(token);
    let warning: string | undefined;
    try {
      await stateStore.recordResults(items);
    } catch (error) {
      console.error('[File Muncher] Could not save statistics:', errorMessage(error));
      warning = '文件已处理，但统计暂未保存到磁盘；当前统计保留在本次运行中。';
    }
    return { items, cancelled: false, state: broadcastState(), ...(warning ? { warning } : {}) };
  } finally {
    fileService.cancel(token);
    batchOwnership.finish(token);
    executing = false;
    resumeRequestedQuit();
  }
}

function registerIpc(): void {
  ipcMain.handle(CHANNELS.state, event => { assertSender(event); return stateStore.getState(); });
  ipcMain.handle(CHANNELS.prepare, (event, paths: unknown) => {
    assertFileSender(event);
    return prepareBatch(paths, event.sender.id);
  });
  ipcMain.handle(CHANNELS.choose, async (event, kind: unknown) => {
    const window = assertFileSender(event);
    if (kind !== 'files' && kind !== 'directory') throw new Error('文件选择类型无效。');
    if (executing) throw new Error('粉碎机正在处理文件，请稍后再选择。');
    const result = await dialog.showOpenDialog(window, {
      title: kind === 'directory' ? '选择要喂给粉碎机的文件夹' : '选择要喂给粉碎机的文件',
      buttonLabel: '选择',
      properties: kind === 'directory' ? ['openDirectory', 'multiSelections', 'dontAddToRecent'] :
        ['openFile', 'multiSelections', 'dontAddToRecent'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return prepareBatch(result.filePaths, event.sender.id);
  });
  ipcMain.handle(CHANNELS.execute, executeBatch);
  ipcMain.handle(CHANNELS.preferences, (event, patch: unknown) => {
    assertSender(event);
    return savePreferences(parsePreferencePatch(patch));
  });
  ipcMain.handle(CHANNELS.openMain, event => { assertSender(event); openMainWindow(); });
  ipcMain.handle(CHANNELS.openPetSettings, event => {
    const window = assertPetSender(event);
    if (quitRequested || !window.isVisible()) throw new Error('宠物窗口当前不可用。');
    openPetSettingsWindow(window);
  });
  ipcMain.handle(CHANNELS.closePetSettings, event => {
    const window = assertSender(event);
    if (window !== petSettingsWindow) throw new Error('只有宠物设置窗口可以关闭此面板。');
    pendingPetSettingsDismissal = undefined;
    window.close();
  });
  ipcMain.handle(CHANNELS.dismissPetSettings, (event, requestId: unknown) => {
    const window = assertSender(event);
    if (window !== petSettingsWindow) throw new Error('只有宠物设置窗口可以关闭此面板。');
    if (typeof requestId !== 'number' || !Number.isSafeInteger(requestId) || requestId < 1) {
      throw new Error('宠物设置关闭请求无效。');
    }
    if (requestId !== pendingPetSettingsDismissal || window.isFocused()) return;
    pendingPetSettingsDismissal = undefined;
    window.close();
  });
  ipcMain.handle(CHANNELS.beginPetDrag, event => {
    const window = assertPetSender(event);
    if (quitRequested || !window.isVisible()) throw new Error('宠物窗口当前不可移动。');
    petDragSession.begin(window.getBounds(), screen.getCursorScreenPoint());
  });
  ipcMain.on(CHANNELS.movePetDrag, event => {
    try {
      const window = assertPetSender(event);
      if (quitRequested || !window.isVisible()) { petDragSession.end(); return; }
      const cursor = screen.getCursorScreenPoint();
      const bounds = petDragSession.move(cursor, screen.getDisplayNearestPoint(cursor).workArea);
      if (bounds) window.setBounds(bounds);
    } catch (error) {
      console.warn('[File Muncher] Could not move desktop pet:', errorMessage(error));
    }
  });
  ipcMain.handle(CHANNELS.endPetDrag, event => { assertPetSender(event); petDragSession.end(); });
  ipcMain.handle(CHANNELS.quit, event => { assertSender(event); setImmediate(() => app.quit()); });
}

async function start(): Promise<void> {
  stateStore = new StateStore(path.join(app.getPath('userData'), 'state.json'));
  let loadWarning: string | null = null;
  try {
    await stateStore.load();
  } catch (error) {
    loadWarning = errorMessage(error);
  }
  const protectedPaths = [app.getAppPath(), app.getPath('userData'), process.execPath];
  if (app.isPackaged) protectedPaths.push(path.dirname(process.execPath));
  const appBundle = process.execPath.match(/^(.+\.app)(?:\/|$)/)?.[1];
  if (appBundle) protectedPaths.push(appBundle);
  fileService = new FileService({ trash: filePath => shell.trashItem(filePath), protectedPaths });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', event => event.preventDefault());
  registerIpc();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: APP_NAME, submenu: [
      { label: '打开主窗口', click: openMainWindow },
      { type: 'separator' as const },
      { label: '退出 file muncher', accelerator: 'Command+Q', click: () => app.quit() },
    ] }] : []),
    { label: '编辑', submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ]));
  createMainWindow();
  createPetWindow();
  tray = new Tray(trayIcon());
  tray.setToolTip(APP_NAME);
  tray.on('double-click', openMainWindow);
  rebuildTrayMenu();
  screen.on('display-removed', keepPetOnScreen);
  screen.on('display-metrics-changed', keepPetOnScreen);
  screen.on('display-removed', keepPetSettingsOnScreen);
  screen.on('display-metrics-changed', keepPetSettingsOnScreen);
  if (loadWarning) dialog.showErrorBox('设置读取失败，已使用默认设置', loadWarning);
}

if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (app.isReady()) openMainWindow(); });
  app.on('activate', () => { if (app.isReady() && stateStore) openMainWindow(); });
  app.on('window-all-closed', () => { /* The tray keeps the desktop pet available. */ });
  app.on('before-quit', event => {
    quitRequested = true;
    pendingPreferenceWrites.close();
    if (executing || pendingPreferenceWrites.hasPending) {
      event.preventDefault();
      return;
    }
    quitting = true;
  });
  app.on('will-quit', () => { tray?.destroy(); });
  void app.whenReady().then(start).catch(error => {
    dialog.showErrorBox('file muncher 启动失败', errorMessage(error));
    app.quit();
  });
}
