import Electron, { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { Settings, SettingKey } from './utils/settings';
import { defaultSettings } from './utils/settings';

const localStorageKeyMap: Partial<Record<SettingKey, string>> = {
  theme: 'theme',
  useSystemTheme: 'use_system_theme',
  responseStyle: 'response_style',
  showPricing: 'show_pricing',
};

function parseLocalStorageValue<K extends SettingKey>(
  key: K,
  rawValue: string
): Settings[K] | null {
  try {
    switch (key) {
      case 'theme':
        return (rawValue === 'dark' || rawValue === 'light' ? rawValue : null) as Settings[K];
      case 'useSystemTheme':
        return (rawValue === 'true') as unknown as Settings[K];
      case 'responseStyle':
        return rawValue as Settings[K];
      case 'showPricing':
        return (rawValue === 'true') as unknown as Settings[K];
      default:
        return null;
    }
  } catch {
    return null;
  }
}

interface NotificationData {
  title: string;
  body: string;
}

interface MessageBoxOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning';
  buttons?: string[];
  defaultId?: number;
  title?: string;
  message: string;
  detail?: string;
}

interface MessageBoxResponse {
  response: number;
  checkboxChecked?: boolean;
}

const config = JSON.parse(process.argv.find((arg) => arg.startsWith('{')) || '{}');

type ElectronAPI = {
  platform: string;
  reactReady: () => void;
  getConfig: () => Record<string, unknown>;
  logInfo: (txt: string) => void;
  showNotification: (data: NotificationData) => void;
  showMessageBox: (options: MessageBoxOptions) => Promise<MessageBoxResponse>;
  reloadApp: () => void;
  listFiles: (dirPath: string, extension?: string) => Promise<string[]>;
  getPathForFile: (file: File) => string;
  getSetting: <K extends SettingKey>(key: K) => Promise<Settings[K]>;
  setSetting: <K extends SettingKey>(key: K, value: Settings[K]) => Promise<void>;
  getSecretKey: () => Promise<string>;
  getGoosedHostPort: () => Promise<string | null>;
  on: (
    channel: string,
    callback: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
  ) => void;
  off: (
    channel: string,
    callback: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
  ) => void;
  emit: (channel: string, ...args: unknown[]) => void;
  openExternal: (url: string) => Promise<void>;
};

type AppConfigAPI = {
  get: (key: string) => unknown;
  getAll: () => Record<string, unknown>;
};

const electronAPI: ElectronAPI = {
  platform: process.platform,
  reactReady: () => ipcRenderer.send('react-ready'),
  getConfig: () => config,
  logInfo: (txt: string) => ipcRenderer.send('logInfo', txt),
  showNotification: (data: NotificationData) => ipcRenderer.send('notify', data),
  showMessageBox: (options: MessageBoxOptions) => ipcRenderer.invoke('show-message-box', options),
  reloadApp: () => ipcRenderer.send('reload-app'),
  listFiles: (dirPath: string, extension?: string) =>
    ipcRenderer.invoke('list-files', dirPath, extension),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getSetting: async <K extends SettingKey>(key: K): Promise<Settings[K]> => {
    try {
      const localStorageKey = localStorageKeyMap[key];
      if (localStorageKey) {
        const rawValue = localStorage.getItem(localStorageKey);
        if (rawValue !== null) {
          const parsed = parseLocalStorageValue(key, rawValue);
          if (parsed !== null) {
            return parsed;
          }
        }
      }
      return await ipcRenderer.invoke('get-setting', key);
    } catch (error) {
      console.error(`Failed to get setting '${key}', using default`, error);
      return defaultSettings[key];
    }
  },
  setSetting: async <K extends SettingKey>(key: K, value: Settings[K]): Promise<void> => {
    const localStorageKey = localStorageKeyMap[key];
    if (localStorageKey) {
      localStorage.removeItem(localStorageKey);
    }
    return ipcRenderer.invoke('set-setting', key, value);
  },
  getSecretKey: () => ipcRenderer.invoke('get-secret-key'),
  getGoosedHostPort: () => ipcRenderer.invoke('get-goosed-host-port'),
  on: (
    channel: string,
    callback: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
  ) => {
    ipcRenderer.on(channel, callback);
  },
  off: (
    channel: string,
    callback: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
  ) => {
    ipcRenderer.off(channel, callback);
  },
  emit: (channel: string, ...args: unknown[]) => {
    ipcRenderer.emit(channel, ...args);
  },
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
};

const appConfigAPI: AppConfigAPI = {
  get: (key: string) => config[key],
  getAll: () => config,
};

contextBridge.exposeInMainWorld('electron', electronAPI);
contextBridge.exposeInMainWorld('appConfig', appConfigAPI);

declare global {
  interface Window {
    electron: ElectronAPI;
    appConfig: AppConfigAPI;
  }
}
