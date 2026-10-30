import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { AppState, DesktopApi, PointerTarget } from '../shared/types';
import { CHANNELS } from './host-policy';

const api: DesktopApi = {
  getState: () => ipcRenderer.invoke(CHANNELS.state),
  prepareDrop: (files: File[]) => {
    if (!Array.isArray(files) || files.length === 0 || files.length > 200) {
      return Promise.reject(new Error('请每次拖入 1 至 200 个文件或文件夹。'));
    }
    try {
      const paths = files.map(file => webUtils.getPathForFile(file));
      if (paths.some(filePath => !filePath)) {
        return Promise.reject(new Error('只能处理从文件管理器拖入的本地文件。'));
      }
      return ipcRenderer.invoke(CHANNELS.prepare, paths);
    } catch {
      return Promise.reject(new Error('无法读取拖入的文件，请从文件管理器重新拖入。'));
    }
  },
  choose: kind => ipcRenderer.invoke(CHANNELS.choose, kind),
  executeBatch: token => ipcRenderer.invoke(CHANNELS.execute, token),
  updatePreferences: patch => ipcRenderer.invoke(CHANNELS.preferences, patch),
  onState: listener => {
    const callback = (_event: IpcRendererEvent, state: AppState): void => listener(state);
    ipcRenderer.on(CHANNELS.stateChanged, callback);
    return () => ipcRenderer.removeListener(CHANNELS.stateChanged, callback);
  },
  onGlobalFileDrag: listener => {
    const callback = (_event: IpcRendererEvent, point: PointerTarget | null): void => listener(point);
    ipcRenderer.on(CHANNELS.globalFileDrag, callback);
    return () => ipcRenderer.removeListener(CHANNELS.globalFileDrag, callback);
  },
  onPetSettingsDismissRequested: listener => {
    const callback = (_event: IpcRendererEvent, requestId: number): void => listener(requestId);
    ipcRenderer.on(CHANNELS.petSettingsDismissRequested, callback);
    return () => ipcRenderer.removeListener(CHANNELS.petSettingsDismissRequested, callback);
  },
  openMain: () => ipcRenderer.invoke(CHANNELS.openMain),
  openPetSettings: () => ipcRenderer.invoke(CHANNELS.openPetSettings),
  closePetSettings: () => ipcRenderer.invoke(CHANNELS.closePetSettings),
  dismissPetSettings: requestId => ipcRenderer.invoke(CHANNELS.dismissPetSettings, requestId),
  beginPetDrag: () => ipcRenderer.invoke(CHANNELS.beginPetDrag),
  movePetDrag: () => ipcRenderer.send(CHANNELS.movePetDrag),
  endPetDrag: () => ipcRenderer.invoke(CHANNELS.endPetDrag),
  quit: () => ipcRenderer.invoke(CHANNELS.quit),
};

contextBridge.exposeInMainWorld('shredder', api);
