export interface ExternalGoosedConfig {
  enabled: boolean;
  url: string;
  secret: string;
}

export interface KeyboardShortcuts {
  newChat: string | null;
  find: string | null;
  findNext: string | null;
  findPrevious: string | null;
  toggleNavigation: string | null;
}

export type DefaultKeyboardShortcuts = {
  [K in keyof KeyboardShortcuts]: string;
};

export interface Settings {
  spellcheckEnabled: boolean;
  externalGoosed: ExternalGoosedConfig;
  keyboardShortcuts: KeyboardShortcuts;

  // UI preferences (migrated from localStorage)
  theme: 'dark' | 'light';
  useSystemTheme: boolean;
  responseStyle: string;
  showPricing: boolean;
}

export type SettingKey = keyof Settings;

export const defaultKeyboardShortcuts: DefaultKeyboardShortcuts = {
  newChat: 'CommandOrControl+T',
  find: 'CommandOrControl+F',
  findNext: 'CommandOrControl+G',
  findPrevious: 'CommandOrControl+Shift+G',
  toggleNavigation: 'CommandOrControl+/',
};

export const defaultSettings: Settings = {
  spellcheckEnabled: true,
  keyboardShortcuts: defaultKeyboardShortcuts,
  externalGoosed: {
    enabled: false,
    url: '',
    secret: '',
  },

  // UI preferences
  theme: 'light',
  useSystemTheme: true,
  responseStyle: 'concise',
  showPricing: true,
};

export function getKeyboardShortcuts(settings: Settings): KeyboardShortcuts {
  return { ...defaultKeyboardShortcuts, ...settings.keyboardShortcuts };
}
