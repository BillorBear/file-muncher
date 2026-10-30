import './styles.css';
import './themes.css';
import './pet.css';
import './pet-motion.css';
import { bindPetGestures } from './pet-interactions';
import { bindFileTracking, type FileTracking } from './file-tracking';
import { getPetBodyBounds, PET_SIZE_DEFAULT, PET_SIZE_MIN, PET_SIZE_MAX } from '../shared/pet-layout';
import { THEMES, sceneMarkup } from './themes';
import { deriveGrowth } from '../shared/growth';
import type { AnimationPhase, AppState, BatchItemResult, DesktopApi, PreparedBatch, ThemeId } from '../shared/types';

const root = document.querySelector<HTMLDivElement>('#app')!;
const view = new URLSearchParams(location.search).get('view');
const isPet = view === 'pet';
const isPetSettings = view === 'pet-settings';
const isDesktop = Boolean(window.shredder);
let state: AppState = { preferences: { theme: 'munch', deletionMode: 'trash', petVisible: true, petSize: PET_SIZE_DEFAULT, reduceMotion: false }, stats: { files: 0, bytes: 0, meals: 0 } };
let busy = false;
let phaseTimer: ReturnType<typeof setTimeout> | undefined;
let lastTheme: ThemeId | undefined;
let petHovered = false;
let mealSpeech: string | undefined;
const sizeWrites = new Set<Promise<boolean>>();
let speechTimer: ReturnType<typeof setTimeout> | undefined;
let interactionTimer: ReturnType<typeof setTimeout> | undefined;
let fileTracking: FileTracking | undefined;
let dragHovered = false;
const MEAL_SPEECH_DURATION = 2000;
const INTERACTION_DURATION = 900;

const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3Z"/>',
  play: '<path d="m9 5 11 7-11 7Z"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor"/><circle cx="15" cy="17" r="3" fill="currentColor"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  pet: '<path d="M5 10 4 3l6 4h4l6-4-1 7c5 10-19 10-14 0Z"/><path d="M8 12h.1M16 12h.1M10 15q2 2 4 0"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
};
function icon(name: keyof typeof icons): string { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`; }
function element<T extends HTMLElement = HTMLElement>(selector: string): T { const found = document.querySelector<T>(selector); if (!found) throw new Error(`Missing UI element: ${selector}`); return found; }
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toLocaleString('zh-CN', { maximumFractionDigits: exponent === 0 ? 0 : 1 })} ${units[exponent]}`;
}
function previewApi(): DesktopApi {
  return {
    getState: async () => state,
    prepareDrop: async () => { throw new Error('浏览器仅供外观预览。请在桌面版中拖入真实文件。'); },
    choose: async () => { throw new Error('浏览器仅供外观预览。请启动桌面版选择文件。'); },
    executeBatch: async () => { throw new Error('预览模式不会删除文件。'); },
    updatePreferences: async (patch) => { state = { ...state, preferences: { ...state.preferences, ...patch } }; return state; },
    onState: () => () => undefined,
    onGlobalFileDrag: () => () => undefined,
    onPetSettingsDismissRequested: () => () => undefined,
    openMain: async () => { location.search = '?view=main'; },
    openPetSettings: async () => { location.search = '?view=pet-settings'; },
    closePetSettings: async () => { location.search = '?view=pet'; },
    dismissPetSettings: async () => { location.search = '?view=pet'; },
    beginPetDrag: async () => undefined,
    movePetDrag: () => undefined,
    endPetDrag: async () => undefined,
    quit: async () => { showMessage('浏览器预览可直接关闭标签页。'); }
  };
}
const api = window.shredder ?? previewApi();

function mainMarkup(): string {
  return `<div class="app-shell">
    <header class="app-header"><div class="brand"><img src="./icon.svg" alt=""/><div><b>file muncher</b><span>文件阿呜</span></div></div>
      <div class="header-actions"><span class="offline-tag"><i></i>离线小伙伴</span><button class="quiet-button" id="toggle-pet">${icon('pet')}<span>桌面宠物</span><i class="switch-indicator"></i></button><button class="icon-button" id="settings" aria-label="打开设置">${icon('settings')}</button></div>
    </header>
    <div class="workspace">
      <aside class="collection"><div class="eyebrow">THE LITTLE COLLECTION</div><div class="collection-title"><h1>选一只，开饭。</h1><span>05</span></div><p class="collection-intro">多余的文件，也能有个有趣的结局。</p>
        <nav class="theme-list" aria-label="选择粉碎机造型">${THEMES.map(theme => `<button class="theme-option" data-select-theme="${theme.id}" aria-pressed="false"><div class="theme-thumb mini-scene" data-phase="idle">${sceneMarkup(theme.id)}</div><span class="theme-copy"><strong>${theme.name}</strong><small>${theme.tagline}</small></span><span class="theme-index">${theme.number}</span></button>`).join('')}</nav>
        <div class="keepers-note"><span class="note-star">✳</span><b>关掉窗口，快乐继续</b><p>小家伙会留在桌面上。<br>把文件拖给它，随时开饭。</p><button class="text-button" id="show-pet">去桌面找它 ${icon('arrow')}</button></div>
      </aside>
      <main class="main-content">
        <div class="stage-heading"><div><div class="eyebrow">A LITTLE LESS CLUTTER, A LITTLE MORE JOY.</div><h2 id="theme-title"></h2></div><button class="mode-badge" id="mode-badge">${icon('shield')}<span></span></button></div>
        <section class="stage" id="drop-zone" aria-label="将文件或文件夹拖到这里喂给宠物" data-phase="idle" tabindex="0">
          <div class="stage-corner"><span id="style-label"></span><span class="stage-edition">ORIGINAL SERIES / <span id="edition"></span></span></div>
          <div class="stage-decoration star-one">✳</div><div class="stage-decoration star-two">✧</div><div class="stage-decoration orbit-mark">+</div>
          <div class="speech-bubble" id="speech">今天有什么好吃的？</div>
          <div class="hero-creature" id="creature" role="button" tabindex="0" aria-label="点击与宠物互动"></div>
          <div class="drop-caption"><h3 id="drop-title">拖进来，喂给我。</h3><p id="drop-subtitle">文件或文件夹都可以，我不挑食。</p></div>
          <div class="drop-overlay" aria-hidden="true"></div><div class="stage-floor"></div>
        </section>
        <div class="feeding-actions"><div class="choose-actions"><button class="primary-button" id="choose-files">${icon('plus')}选文件喂它</button><button class="folder-button" id="choose-folder" title="选择文件夹" aria-label="选择文件夹">${icon('folder')}</button></div><button class="preview-button" id="preview">${icon('play')}试播动画<span>不删除文件</span></button></div>
        <section class="pet-stats" aria-label="宠物成长统计"><div class="stat"><span>累计吃掉</span><strong><span data-stat="files">0</span><small>个文件</small></strong></div><div class="stat"><span>吞下的数据</span><strong data-stat="bytes">0 B</strong></div><div class="stat weight-stat"><span>现在的体重 <i title="虚拟体重；根据成功处理的文件数和大小成长">↗</i></span><strong><span data-stat="weight">1.2</span><small>kg</small></strong></div><div class="growth-stat"><span class="growth-level" data-stat="level"></span><span class="growth-label" data-stat="growth"></span><div class="growth-track"><i id="growth-progress"></i></div><small>慢慢长大，最多长到 1.3 倍</small></div></section>
        <div class="result-panel" id="result-panel" aria-live="polite"><span class="result-icon">${icon('shield')}</span><div><strong id="result-title">只处理你主动拖入或选择的文件。</strong><p id="result-detail">当前删除方式显示在右上角。成长记录会保存在这台电脑上。</p><ul id="result-items"></ul></div></div>
      </main>
    </div><footer class="app-footer"><span>一点清爽，一点快乐。</span><span id="environment-label">本地处理 · 不上传文件</span><span>v1.0.2</span></footer>
  </div>
  <dialog id="settings-dialog"><form id="settings-form"><div class="dialog-heading"><div><span class="eyebrow">MAKE YOURSELF AT HOME</span><h2>小家伙的日常</h2></div><button type="button" class="icon-button" id="close-settings" aria-label="关闭设置">${icon('close')}</button></div>
    <fieldset><legend>喂食之后，文件去哪里？</legend><label class="radio-option"><input type="radio" name="mode" value="trash"><span><b>系统回收站</b><small>默认方式，可从系统回收站恢复。</small></span><span class="recommended">推荐</span></label><label class="radio-option"><input type="radio" name="mode" value="permanent"><span><b>永久删除</b><small>跳过回收站。每一批都会再次确认，无法在软件中撤销。</small></span></label></fieldset>
    <label class="setting-toggle"><span><b>桌面悬浮宠物</b><small>主窗口关闭后，仍可拖文件喂食。</small></span><input id="pref-pet" type="checkbox"></label>
    <label class="setting-size" for="pref-size"><span><b>悬浮宠物大小</b><output id="pref-size-label">70%</output></span><input id="pref-size" type="range" min="50" max="100" step="5" value="70"><small>拖动滑块即时生效，桌面宠物同步缩放。</small></label>
    <label class="setting-toggle"><span><b>减少动态效果</b><small>使用简短反馈；也会尊重系统的减少动态设置。</small></span><input id="pref-motion" type="checkbox"></label>
    <p class="settings-note">统计的是成功处理的文件数和逻辑大小，文件夹内的文件会一并计入。体重是趣味数值；普通删除不等于磁盘安全擦除。</p><p class="settings-error" id="settings-error" role="alert"></p><button type="submit" class="primary-button save-settings">保存设置 ${icon('check')}</button>
  </form></dialog>`;
}

function petMarkup(): string {
  return `<main class="pet-widget" id="drop-zone" data-phase="idle">
    <div class="pet-speech" id="speech" role="status" hidden></div>
    <div class="pet-scene" id="creature" role="button" tabindex="0" aria-label="悬浮宠物：点击互动，拖动身体移动，右键调整大小，拖入文件喂食"></div>
    <div class="pet-reaction" aria-hidden="true"><svg viewBox="0 0 100 80"><path class="reaction-heart" d="M50 56 27 33C10 13 38 1 50 20 62 1 90 13 73 33Z"/><path class="reaction-spark" d="m12 50 3 8 8 3-8 3-3 8-3-8-8-3 8-3Zm76-39 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"/></svg></div>
    <div class="drop-overlay" aria-hidden="true"></div><div class="pet-result" id="result-panel" role="status" hidden><strong id="result-title"></strong><p id="result-detail"></p><ul id="result-items"></ul><button id="pet-result-dismiss" aria-label="收起提示">知道了</button></div></main>`;
}

function petSettingsMarkup(): string {
  return `<main class="pet-settings-panel"><header><div><b>小一点，也可爱。</b><span>文件阿呜 · 桌面大小</span></div><button class="icon-button" id="close-pet-settings" aria-label="关闭大小设置">${icon('close')}</button></header>
    <label for="pet-size">宠物大小 <output id="pet-size-label">70%</output></label><input id="pet-size" type="range" min="${PET_SIZE_MIN * 100}" max="${PET_SIZE_MAX * 100}" step="5" value="${PET_SIZE_DEFAULT * 100}">
    <p class="size-hint">拖动滑块，看旁边的小家伙实时变大变小。</p><p id="size-error" role="alert"></p>
    <footer><button id="pet-main">打开主窗口</button><button id="pet-hide">隐藏宠物</button><button id="pet-quit">退出</button></footer></main>`;
}

function say(text: string): void {
  if (!isPet && !isPetSettings) element('#speech').textContent = text;
}
function renderPetSpeech(): void {
  if (!isPet) return;
  const speech = element('#speech');
  const growth = deriveGrowth(state.stats);
  const count = state.stats.files < 10000 ? state.stats.files.toLocaleString('zh-CN') : `约 ${new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(state.stats.files)}`;
  speech.textContent = dragHovered ? readySpeech() : mealSpeech ?? `我吃了 ${count} 个文件，${formatBytes(state.stats.bytes)}。现在重 ${growth.weightKg.toFixed(1)} kg 啦。`;
  speech.hidden = !dragHovered && !mealSpeech && (!petHovered || busy);
}
function readySpeech(): string { return lastTheme === 'blade' ? 'stand by !' : '看见啦，松手开饭！'; }
function hideMealSpeech(): void {
  if (!isPet) return;
  clearTimeout(speechTimer);
  mealSpeech = undefined;
  renderPetSpeech();
}
function showMealSpeech(text: string): void {
  if (!isPet) { say(text); return; }
  clearTimeout(speechTimer);
  mealSpeech = text;
  renderPetSpeech();
  speechTimer = setTimeout(hideMealSpeech, MEAL_SPEECH_DURATION);
}

function syncSizeControl(): void {
  if (isPet || sizeWrites.size > 0) return;
  const value = String(Math.round(state.preferences.petSize * 100));
  element<HTMLInputElement>(isPetSettings ? '#pet-size' : '#pref-size').value = value;
  element(isPetSettings ? '#pet-size-label' : '#pref-size-label').textContent = `${value}%`;
}
function bindSizeControl(): void {
  const slider = element<HTMLInputElement>(isPetSettings ? '#pet-size' : '#pref-size');
  const label = element(isPetSettings ? '#pet-size-label' : '#pref-size-label');
  const errorLabel = element(isPetSettings ? '#size-error' : '#settings-error');
  slider.addEventListener('input', () => {
    label.textContent = `${slider.value}%`;
    errorLabel.textContent = '';
    const write = api.updatePreferences({ petSize: Number(slider.value) / 100 }).then(next => {
      if (!isDesktop) updateState(next);
      return true;
    }).catch((error: unknown) => {
      errorLabel.textContent = errorMessage(error);
      return false;
    }).finally(() => { sizeWrites.delete(write); syncSizeControl(); });
    sizeWrites.add(write);
  });
}
function stopInteraction(): void {
  clearTimeout(interactionTimer);
  delete element('#drop-zone').dataset.interacting;
}
function interact(): void {
  if (busy) return;
  stopInteraction();
  const zone = element('#drop-zone');
  void zone.offsetWidth;
  zone.dataset.interacting = 'true';
  interactionTimer = setTimeout(stopInteraction, INTERACTION_DURATION);
}

function setPhase(phase: AnimationPhase): void {
  if (phaseTimer) clearTimeout(phaseTimer);
  element('#drop-zone').dataset.phase = phase;
  if (phase === 'success' || phase === 'error') phaseTimer = setTimeout(() => setPhase('idle'), 2800);
}
function setBusy(value: boolean): void {
  if (value) fileTracking?.stop();
  busy = value;
  if (!value) fileTracking?.reset();
  document.body.classList.toggle('is-busy', value);
  document.querySelectorAll<HTMLButtonElement>('[data-select-theme], #choose-files, #choose-folder, #preview, #settings, #mode-badge').forEach(button => { button.disabled = value; });
  element('#drop-zone').setAttribute('aria-busy', String(value));
  if (!value) updateState(state);
  renderPetSpeech();
}
function updateState(next: AppState): void {
  state = next;
  // Apply cross-window theme changes after the active meal or preview finishes.
  const themeId = busy && lastTheme ? lastTheme : state.preferences.theme;
  const theme = THEMES.find(item => item.id === themeId) ?? THEMES[0]!;
  const growth = deriveGrowth(state.stats);
  document.body.dataset.theme = theme.id;
  document.body.classList.toggle('reduce-motion', state.preferences.reduceMotion);
  document.documentElement.style.setProperty('--theme-accent', theme.color);
  syncSizeControl();
  if (isPetSettings) return;
  if (lastTheme !== theme.id) { element('#creature').innerHTML = sceneMarkup(theme.id); lastTheme = theme.id; }
  document.querySelectorAll<HTMLElement>('[data-stat="files"]').forEach(node => { node.textContent = state.stats.files.toLocaleString('zh-CN'); });
  document.querySelectorAll<HTMLElement>('[data-stat="bytes"]').forEach(node => { node.textContent = formatBytes(state.stats.bytes); });
  document.querySelectorAll<HTMLElement>('[data-stat="weight"]').forEach(node => { node.textContent = growth.weightKg.toFixed(1); });
  const modeText = state.preferences.deletionMode === 'trash' ? '回收站 · 可恢复' : '永久删除 · 每次确认';
  if (isPet) {
    renderPetSpeech();
    element('#creature').style.setProperty('--pet-scale', String(growth.scale));
    element('#drop-zone').style.setProperty('--pet-body-top', `${getPetBodyBounds(innerWidth, theme.id, growth.scale).y}px`);
  } else {
    element('#theme-title').textContent = theme.name;
    element('#style-label').textContent = theme.tagline;
    element('#edition').textContent = theme.number;
    element('#mode-badge span').textContent = modeText;
    element('#mode-badge').classList.toggle('permanent', state.preferences.deletionMode === 'permanent');
    element('#toggle-pet').classList.toggle('active', state.preferences.petVisible);
    element('#toggle-pet').setAttribute('aria-pressed', String(state.preferences.petVisible));
    element('[data-stat="level"]').textContent = `Lv.${growth.level}`;
    element('[data-stat="growth"]').textContent = growth.label;
    element('#growth-progress').style.width = `${Math.max(4, growth.progress * 100)}%`;
    document.querySelectorAll<HTMLButtonElement>('[data-select-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.selectTheme === theme.id)));
  }
}

function showMessage(title: string, detail = '', items: BatchItemResult[] = []): void {
  if (isPetSettings) { element('#size-error').textContent = `${title} ${detail}`; return; }
  element('#result-panel').hidden = false;
  element('#result-title').textContent = title;
  element('#result-detail').textContent = detail;
  const list = element<HTMLUListElement>('#result-items');
  list.replaceChildren();
  items.filter(item => item.status === 'error').forEach(item => {
    const li = document.createElement('li');
    li.textContent = `${item.name}：${item.message ?? '未能处理，请重试。'}`;
    list.append(li);
  });
  element('#result-panel').classList.toggle('has-error', items.some(item => item.status === 'error'));
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '操作未完成，请重试。'; }
async function withFeedback(action: () => Promise<void>): Promise<void> {
  try { await action(); } catch (error) { if (!isPetSettings) setPhase('error'); showMessage('这次没吃下去', errorMessage(error)); say('出了点小状况'); }
}
async function feed(prepare: () => Promise<PreparedBatch | null>): Promise<void> {
  if (busy) { showMessage('还在咀嚼这一口', '等这一批处理完成，再把文件拖进来。'); return; }
  setBusy(true);
  hideMealSpeech();
  stopInteraction();
  setPhase('idle');
  await withFeedback(async () => {
    say('先看看这份大餐…');
    const batch = await prepare();
    if (!batch) { setPhase('idle'); say('下次再开饭也可以'); return; }
    const rejected: BatchItemResult[] = batch.rejected.map(item => ({ ...item, status: 'error', fileCount: 0, bytes: 0 }));
    if (!batch.entries.length) { setPhase('error'); showMessage('这些文件暂时不能喂给我', '没有删除任何文件。', rejected); say('这一口先留着吧'); return; }
    const isTank = lastTheme === 'blade';
    if (!isTank) setPhase('processing');
    say(batch.mode === 'permanent' ? '请确认这份永久删除大餐' : isTank ? '目标锁定，正在处理…' : '啊呜，开动啦！');
    let started = performance.now();
    const result = await api.executeBatch(batch.token);
    if (result.cancelled) { setPhase('idle'); showMessage('已取消，文件还在原处。'); say('留着下次再吃'); return; }
    if (isTank && result.items.some(item => item.status === 'success')) {
      setPhase('processing');
      say('开火！');
      started = performance.now();
    }
    const minimum = state.preferences.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches ? 160 : 1800;
    await new Promise(resolve => setTimeout(resolve, Math.max(0, minimum - (performance.now() - started))));
    const items = [...result.items, ...rejected];
    const successful = result.items.filter(item => item.status === 'success');
    const failures = items.filter(item => item.status === 'error');
    const totalFiles = successful.reduce((sum, item) => sum + item.fileCount, 0);
    const totalBytes = successful.reduce((sum, item) => sum + item.bytes, 0);
    setPhase(failures.length ? 'error' : 'success');
    if (successful.length) showMealSpeech(failures.length ? '吃掉了一部分，看看提示吧' : isTank ? '目标处理完毕！' : '嗝～这顿真不错！');
    else say('这次没吃下去');
    const title = successful.length ? `吃掉 ${successful.length} 项，${totalFiles} 个文件 · ${formatBytes(totalBytes)}` : '未能处理这些文件';
    const destination = batch.mode === 'trash' ? '成功项已移入系统回收站，可从那里恢复。' : '成功项已永久删除。';
    if (isPet && !failures.length && !result.warning) element('#result-panel').hidden = true;
    else showMessage(title, `${successful.length ? destination : ''}${failures.length ? ` ${failures.length} 项未完成，请查看原因。` : ''}${result.warning ? ` ${result.warning}` : ''}`, items);
  });
  setBusy(false);
}

function bindDrop(): void {
  const zone = element('#drop-zone');
  fileTracking = bindFileTracking({
    zone,
    creature: element('#creature'),
    isBusy: () => busy,
    onHoverChange: hovered => {
      dragHovered = hovered;
      if (!busy) {
        setPhase(hovered ? 'hover' : 'idle');
        say(hovered ? readySpeech() : '今天有什么好吃的？');
      }
      renderPetSpeech();
    },
    onDrop: files => { void feed(() => api.prepareDrop(files)); },
  });
  const unsubscribeGlobalDrag = api.onGlobalFileDrag?.(point => fileTracking?.trackGlobalFileDrag(point));
  window.addEventListener('pagehide', () => unsubscribeGlobalDrag?.(), { once: true });
  zone.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target === zone && !isPet) { event.preventDefault(); void feed(() => api.choose('files')); } });
}

function openSettings(): void {
  const dialog = element<HTMLDialogElement>('#settings-dialog');
  element<HTMLInputElement>(`input[name="mode"][value="${state.preferences.deletionMode}"]`).checked = true;
  element<HTMLInputElement>('#pref-pet').checked = state.preferences.petVisible;
  element<HTMLInputElement>('#pref-motion').checked = state.preferences.reduceMotion;
  element<HTMLInputElement>('#pref-size').value = String(Math.round(state.preferences.petSize * 100));
  element('#pref-size-label').textContent = `${Math.round(state.preferences.petSize * 100)}%`;
  element('#settings-error').textContent = '';
  dialog.showModal();
}
function bindMain(): void {
  const creature = element('#creature');
  creature.addEventListener('click', interact);
  creature.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); interact(); }
  });
  document.querySelectorAll<HTMLButtonElement>('[data-select-theme]').forEach(button => button.addEventListener('click', () => { void withFeedback(async () => {
    updateState(await api.updatePreferences({ theme: button.dataset.selectTheme as ThemeId }));
    if (!busy) { setPhase('idle'); say('换个口味，继续快乐'); }
  }); }));
  element('#choose-files').addEventListener('click', () => { void feed(() => api.choose('files')); });
  element('#choose-folder').addEventListener('click', () => { void feed(() => api.choose('directory')); });
  element('#preview').addEventListener('click', () => {
    if (busy) return;
    setBusy(true); setPhase('processing'); say('表演时间！这次只吃空气');
    showMessage('正在试播动画', '没有操作真实文件，成长统计也不会改变。');
    setTimeout(() => { setPhase('success'); say('好啦，轮到你的文件了'); setBusy(false); }, state.preferences.reduceMotion ? 500 : 2300);
  });
  bindSizeControl();
  element('#settings').addEventListener('click', openSettings);
  element('#mode-badge').addEventListener('click', openSettings);
  element('#close-settings').addEventListener('click', () => element<HTMLDialogElement>('#settings-dialog').close());
  element('#toggle-pet').addEventListener('click', () => { void withFeedback(async () => updateState(await api.updatePreferences({ petVisible: !state.preferences.petVisible }))); });
  element('#show-pet').addEventListener('click', () => { void withFeedback(async () => { updateState(await api.updatePreferences({ petVisible: true })); showMessage('小家伙已经在桌面等你了。', '按住宠物身体拖动位置，轻点与它互动；右键宠物可调整大小，悬停会告诉你它的胃口。'); }); });
  element<HTMLFormElement>('#settings-form').addEventListener('submit', event => {
    event.preventDefault();
    const submit = element<HTMLButtonElement>('.save-settings'); submit.disabled = true;
    const mode = element<HTMLInputElement>('input[name="mode"]:checked').value === 'permanent' ? 'permanent' : 'trash';
    void (async () => {
      if (!(await flushSizeWrites())) return;
      updateState(await api.updatePreferences({ deletionMode: mode, petVisible: element<HTMLInputElement>('#pref-pet').checked, reduceMotion: element<HTMLInputElement>('#pref-motion').checked }));
      element<HTMLDialogElement>('#settings-dialog').close();
      showMessage(mode === 'trash' ? '已设为移入系统回收站。' : '已设为永久删除，每一批都会再次确认。', mode === 'trash' ? '删除后可从系统回收站恢复。' : '请确认文件不再需要；这不会保证磁盘内容无法恢复。');
    })().catch((error: unknown) => { element('#settings-error').textContent = errorMessage(error); }).finally(() => { submit.disabled = false; });
  });
}

function bindPet(): void {
  const creature = element('#creature');
  window.addEventListener('resize', () => updateState(state));
  bindPetGestures(creature, api, interact, error => showMessage('暂时无法移动宠物', errorMessage(error)));
  creature.addEventListener('pointerenter', () => { petHovered = true; renderPetSpeech(); });
  creature.addEventListener('pointerleave', () => { petHovered = false; renderPetSpeech(); });
  creature.addEventListener('contextmenu', event => { event.preventDefault(); void withFeedback(() => api.openPetSettings()); });
  creature.addEventListener('keydown', event => {
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault(); void withFeedback(() => api.openPetSettings());
    }
  });
  element('#pet-result-dismiss').addEventListener('click', () => { element('#result-panel').hidden = true; });
}
async function flushSizeWrites(): Promise<boolean> {
  return (await Promise.all([...sizeWrites])).every(Boolean);
}
function bindPetSettings(): void {
  bindSizeControl();
  const finish = (action: () => Promise<void>): void => {
    void withFeedback(async () => { if (await flushSizeWrites()) await action(); });
  };
  element('#close-pet-settings').addEventListener('click', () => finish(() => api.closePetSettings()));
  element('#pet-main').addEventListener('click', () => { void withFeedback(() => api.openMain()); });
  element('#pet-hide').addEventListener('click', () => finish(async () => { await api.updatePreferences({ petVisible: false }); }));
  element('#pet-quit').addEventListener('click', () => finish(() => api.quit()));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') finish(() => api.closePetSettings()); });
  const unsubscribe = api.onPetSettingsDismissRequested(requestId => finish(() => api.dismissPetSettings(requestId)));
  window.addEventListener('pagehide', unsubscribe, { once: true });
}

async function start(): Promise<void> {
  if (!isDesktop && /Electron\//.test(navigator.userAgent)) { root.textContent = '桌面连接未能启动，请重启应用。为保护文件，已停止文件操作。'; return; }
  document.body.classList.toggle('pet-view', isPet);
  document.body.classList.toggle('pet-settings-view', isPetSettings);
  root.innerHTML = isPet ? petMarkup() : isPetSettings ? petSettingsMarkup() : mainMarkup();
  if (isPetSettings) bindPetSettings();
  else { bindDrop(); if (isPet) bindPet(); else bindMain(); }
  updateState(await api.getState());
  api.onState(updateState);
  if (!isDesktop && !isPet && !isPetSettings) element('#environment-label').textContent = '外观预览 · 不执行文件删除';
  document.addEventListener('visibilitychange', () => { document.body.classList.toggle('paused', document.hidden); });
}
void start().catch((error: unknown) => { root.textContent = `启动失败：${errorMessage(error)}`; });
