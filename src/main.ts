import type { MenuItemConstructorOptions } from 'electron';
import {
  app,
  App,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  MenuItem,
  net,
  Notification,
  session,
  shell,
} from 'electron';
import { pathToFileURL, format as formatUrl, URLSearchParams } from 'node:url';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import started from 'electron-squirrel-startup';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'child_process';
import 'dotenv/config';
import { checkServerStatus } from './goosed';
import { startGoosed } from './goosed';
import { createClient, createConfig } from './api/client';
import { expandTilde } from './utils/pathUtils';
import log from './utils/logger';
import { ensureWinShims } from './utils/winShims';
import { formatErrorForLogging } from './utils/conversionUtils';
import type { Settings, SettingKey } from './utils/settings';
import { defaultSettings, getKeyboardShortcuts } from './utils/settings';
import * as crypto from 'crypto';
import windowStateKeeper from 'electron-window-state';
import { Client } from './api/client';
import installExtension, { REACT_DEVELOPER_TOOLS } from 'electron-devtools-installer';
import { BLOCKED_PROTOCOLS } from './utils/urlSecurity';

// Settings management
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

function getSettings(): Settings {
  if (fsSync.existsSync(SETTINGS_FILE)) {
    const data = fsSync.readFileSync(SETTINGS_FILE, 'utf8');
    const stored = JSON.parse(data) as Partial<Settings>;
    // Deep merge to ensure nested objects get their defaults too
    return {
      ...defaultSettings,
      ...stored,
      externalGoosed: {
        ...defaultSettings.externalGoosed,
        ...(stored.externalGoosed ?? {}),
      },
      keyboardShortcuts: {
        ...defaultSettings.keyboardShortcuts,
        ...(stored.keyboardShortcuts ?? {}),
      },
    };
  }
  return defaultSettings;
}

function updateSettings(modifier: (settings: Settings) => void): void {
  const settings = getSettings();
  modifier(settings);
  fsSync.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

async function configureProxy() {
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || '';

  const proxyUrl = httpsProxy || httpProxy;

  if (proxyUrl) {
    console.log('[Main] Configuring proxy');
    await session.defaultSession.setProxy({
      proxyRules: proxyUrl,
      proxyBypassRules: noProxy,
    });
    console.log('[Main] Proxy configured successfully');
  }
}

if (started) app.quit();

// Accept self-signed certificates from the local goosed server.
// Both certificate-error (renderer) and setCertificateVerifyProc (main-process
// net.fetch) pin to the exact cert fingerprint emitted by goosed at startup.
// Before the fingerprint is available (during the health-check bootstrap
// window) any localhost cert is accepted so the server can come up.
let pinnedCertFingerprint: string | null = null;

function isLocalhost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

function normalizeFingerprint(fp: string): string {
  if (fp.startsWith('sha256/')) {
    const b64 = fp.slice('sha256/'.length);
    const buf = Buffer.from(b64, 'base64');
    return Array.from(buf)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(':')
      .toUpperCase();
  }
  return fp.toUpperCase();
}

// Renderer requests: pin to the exact cert goosed generated once known.
// Before the fingerprint is available (during the health-check bootstrap
// window) any localhost cert is accepted so the server can come up.
app.on('certificate-error', (event, _webContents, url, _error, certificate, callback) => {
  const parsed = new URL(url);
  if (!isLocalhost(parsed.hostname)) {
    callback(false);
    return;
  }
  if (pinnedCertFingerprint) {
    const match =
      normalizeFingerprint(certificate.fingerprint) === pinnedCertFingerprint.toUpperCase();
    event.preventDefault();
    callback(match);
  } else {
    event.preventDefault();
    callback(true);
  }
});

// Main-process net.fetch: pin to the exact cert goosed generated.
app.whenReady().then(() => {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (!isLocalhost(request.hostname)) {
      callback(-3);
      return;
    }
    if (!pinnedCertFingerprint) {
      callback(0);
      return;
    }
    const match =
      normalizeFingerprint(request.certificate.fingerprint) === pinnedCertFingerprint.toUpperCase();
    callback(match ? 0 : -3);
  });
});

if (process.env.ENABLE_PLAYWRIGHT) {
  const debugPort = process.env.PLAYWRIGHT_DEBUG_PORT || '9222';
  console.log(`[Main] Enabling Playwright remote debugging on port ${debugPort}`);
  app.commandLine.appendSwitch('remote-debugging-port', debugPort);
}

// In development mode, force registration as the default protocol client
// In production, register normally
if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
  // Development mode - force registration
  console.log('[Main] Development mode: Forcing protocol registration for goose://');
  app.setAsDefaultProtocolClient('goose');

  if (process.platform === 'darwin') {
    try {
      // Reset the default handler to ensure dev version takes precedence
      spawn('open', ['-a', process.execPath, '--args', '--reset-protocol-handler', 'goose'], {
        detached: true,
        stdio: 'ignore',
      });
    } catch {
      console.warn('[Main] Could not reset protocol handler');
    }
  }
} else {
  // Production mode - normal registration
  app.setAsDefaultProtocolClient('goose');
}

// Apply single instance lock on Windows and Linux where it's needed for deep links
// macOS uses the 'open-url' event instead
let gotTheLock = true;
if (process.platform !== 'darwin') {
  gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      const existingWindows = BrowserWindow.getAllWindows();
      if (existingWindows.length > 0) {
        const mainWindow = existingWindows[0];
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.focus();
      }
    });
  }

}

// Handle macOS drag-and-drop onto dock icon
app.on('will-finish-launching', () => {
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: 'Goose',
      applicationVersion: app.getVersion(),
    });
  }
});

// Handle drag-and-drop onto dock icon
app.on('open-file', async (event, filePath) => {
  event.preventDefault();
  await handleFileOpen(filePath);
});

// Handle multiple files/folders (macOS only)
if (process.platform === 'darwin') {
  // Use type assertion for non-standard Electron event
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.on('open-files' as any, async (event: any, filePaths: string[]) => {
    event.preventDefault();
    for (const filePath of filePaths) {
      await handleFileOpen(filePath);
    }
  });
}

async function handleFileOpen(filePath: string) {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return;
    }

    const stats = fsSync.lstatSync(filePath);
    let targetDir = filePath;

    // If it's a file, use its parent directory
    if (stats.isFile()) {
      targetDir = path.dirname(filePath);
    }

    // Create new window for the directory
    const newWindow = await createChat(app, { dir: targetDir });

    // Focus the new window
    if (newWindow) {
      newWindow.show();
      newWindow.focus();
      newWindow.moveTop();
    }
  } catch (error) {
    console.error('Failed to handle file open:', error);

    // Show user-friendly error notification
    new Notification({
      title: 'Goose',
      body: `Could not open directory: ${path.basename(filePath)}`,
    }).show();
  }
}

declare var MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare var MAIN_WINDOW_VITE_NAME: string;

function getAppUrl(): URL {
  return MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    : pathToFileURL(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
}

// Parse command line arguments
const parseArgs = () => {
  let dirPath = null;

  // Remove first two elements in dev mode (electron and script path)
  const args = !dirPath && app.isPackaged ? process.argv : process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && i + 1 < args.length) {
      dirPath = args[i + 1];
      break;
    }
  }

  return { dirPath };
};

interface BundledConfig {
  defaultProvider?: string;
  defaultModel?: string;
  predefinedModels?: string;
  baseUrlShare?: string;
  version?: string;
}

const getBundledConfig = (): BundledConfig => {
  //{env-macro-start}//
  //needed when goose is bundled for a specific provider
  //{env-macro-end}//
  return {
    defaultProvider: process.env.GOOSE_DEFAULT_PROVIDER,
    defaultModel: process.env.GOOSE_DEFAULT_MODEL,
    predefinedModels: process.env.GOOSE_PREDEFINED_MODELS,
    baseUrlShare: process.env.GOOSE_BASE_URL_SHARE,
    version: process.env.GOOSE_VERSION,
  };
};

const { defaultProvider, defaultModel, predefinedModels, baseUrlShare, version } =
  getBundledConfig();

const resolveGoosePathRoot = (): string | undefined => {
  const pathRoot = process.env.GOOSE_PATH_ROOT?.trim();
  if (pathRoot) {
    return expandTilde(pathRoot);
  }
  return undefined;
};

const GENERATED_SECRET = crypto.randomBytes(32).toString('hex');

const getServerSecret = (settings: Settings): string => {
  if (settings.externalGoosed?.enabled && settings.externalGoosed.secret) {
    return settings.externalGoosed.secret;
  }
  if (process.env.GOOSE_EXTERNAL_BACKEND) {
    if (!process.env.GOOSE_SERVER__SECRET_KEY) {
      throw new Error(
        'GOOSE_SERVER__SECRET_KEY must be set when using GOOSE_EXTERNAL_BACKEND. ' +
          'Set it to the same value on both the server and the desktop client.'
      );
    }
    return process.env.GOOSE_SERVER__SECRET_KEY;
  }
  return GENERATED_SECRET;
};

let appConfig = {
  GOOSE_DEFAULT_PROVIDER: defaultProvider,
  GOOSE_DEFAULT_MODEL: defaultModel,
  GOOSE_PREDEFINED_MODELS: predefinedModels,
  GOOSE_API_HOST: 'https://localhost',
  GOOSE_PATH_ROOT: resolveGoosePathRoot(),
  GOOSE_WORKING_DIR: '',
  // If GOOSE_ALLOWLIST_WARNING env var is not set, defaults to false (strict blocking mode)
  GOOSE_ALLOWLIST_WARNING: process.env.GOOSE_ALLOWLIST_WARNING === 'true',
};

const windowMap = new Map<number, BrowserWindow>();
const goosedClients = new Map<number, Client>();
// Track pending initial messages per window
const pendingInitialMessages = new Map<number, string>(); // windowId -> initialMessage

interface CreateChatOptions {
  initialMessage?: string;
  dir?: string;
  resumeSessionId?: string;
  viewType?: string;
}

const createChat = async (app: App, options: CreateChatOptions = {}) => {
  const { initialMessage, dir, resumeSessionId, viewType } = options;
  const settings = getSettings();
  const serverSecret = getServerSecret(settings);

  const goosedResult = await startGoosed({
    serverSecret,
    dir: dir || os.homedir(),
    env: {
      GOOSE_PATH_ROOT: appConfig.GOOSE_PATH_ROOT as string | undefined,
    },
    externalGoosed: settings.externalGoosed,
    isPackaged: app.isPackaged,
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
    logger: log,
  });

  // Pin the certificate fingerprint so the cert handlers above only accept
  // the exact cert that *this* goosed instance generated.
  if (goosedResult.certFingerprint) {
    pinnedCertFingerprint = goosedResult.certFingerprint;
  }

  app.on('will-quit', async () => {
    log.info('App quitting, terminating goosed server');
    await goosedResult.cleanup();
  });

  const { baseUrl, workingDir, process: goosedProcess, errorLog } = goosedResult;

  const mainWindowState = windowStateKeeper({
    defaultWidth: 940,
    defaultHeight: 800,
  });

  const mainWindow = new BrowserWindow({
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 20, y: 16 } : undefined,
    vibrancy: process.platform === 'darwin' ? 'window' : undefined,
    frame: process.platform !== 'darwin',
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 450,
    resizable: true,
    useContentSize: true,
    icon: path.join(__dirname, '../images/icon.icns'),
    webPreferences: {
      spellcheck: settings.spellcheckEnabled ?? true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      nodeIntegration: false,
      contextIsolation: true,
      additionalArguments: [
        JSON.stringify({
          ...appConfig,
          GOOSE_API_HOST: baseUrl,
          GOOSE_WORKING_DIR: workingDir,
          REQUEST_DIR: dir,
          GOOSE_BASE_URL_SHARE: baseUrlShare,
          GOOSE_VERSION: version,
          SECURITY_ML_MODEL_MAPPING: process.env.SECURITY_ML_MODEL_MAPPING,
        }),
      ],
      partition: 'persist:goose',
    },
  });

  if (!app.isPackaged) {
    installExtension(REACT_DEVELOPER_TOOLS, {
      loadExtensionOptions: { allowFileAccess: true },
      session: mainWindow.webContents.session,
    })
      .then(() => log.info('added react dev tools'))
      .catch((err) => log.info('failed to install react dev tools:', err));
  }

  // Re-create the client with Electron's net.fetch so requests to the local
  // self-signed HTTPS server go through the session's certificate handling.
  const goosedClient = createClient(
    createConfig({
      baseUrl,
      fetch: net.fetch as unknown as typeof globalThis.fetch,
      headers: {
        'Content-Type': 'application/json',
        'X-Secret-Key': serverSecret,
      },
    })
  );
  goosedClients.set(mainWindow.id, goosedClient);

  const serverReady = await checkServerStatus(goosedClient, errorLog);
  if (!serverReady) {
    const isUsingExternalBackend = settings.externalGoosed?.enabled;

    if (isUsingExternalBackend) {
      const response = dialog.showMessageBoxSync({
        type: 'error',
        title: 'External Backend Unreachable',
        message: `Could not connect to external backend at ${settings.externalGoosed?.url}`,
        detail: 'The external goosed server may not be running.',
        buttons: ['Disable External Backend & Retry', 'Quit'],
        defaultId: 0,
        cancelId: 1,
      });

      if (response === 0) {
        updateSettings((s) => {
          if (s.externalGoosed) {
            s.externalGoosed.enabled = false;
          }
        });
        mainWindow.destroy();
        return createChat(app, { initialMessage, dir });
      }
    } else {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'Goose Failed to Start',
        message: 'The backend server failed to start.',
        detail: errorLog.join('\n'),
        buttons: ['OK'],
      });
    }
    app.quit();
  }

  // Let windowStateKeeper manage the window
  mainWindowState.manage(mainWindow);

  mainWindow.webContents.session.setSpellCheckerLanguages(['en-US', 'en-GB']);
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu();
    const hasSpellingSuggestions = params.dictionarySuggestions.length > 0 || params.misspelledWord;

    if (hasSpellingSuggestions) {
      for (const suggestion of params.dictionarySuggestions) {
        menu.append(
          new MenuItem({
            label: suggestion,
            click: () => mainWindow.webContents.replaceMisspelling(suggestion),
          })
        );
      }

      if (params.misspelledWord) {
        menu.append(
          new MenuItem({
            label: 'Add to dictionary',
            click: () =>
              mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
          })
        );
      }

      if (params.selectionText) {
        menu.append(new MenuItem({ type: 'separator' }));
      }
    }
    if (params.selectionText) {
      menu.append(
        new MenuItem({
          label: 'Cut',
          accelerator: 'CmdOrCtrl+X',
          role: 'cut',
        })
      );
      menu.append(
        new MenuItem({
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',
          role: 'copy',
        })
      );
    }

    // Only show paste in editable fields (text inputs)
    if (params.isEditable) {
      menu.append(
        new MenuItem({
          label: 'Paste',
          accelerator: 'CmdOrCtrl+V',
          role: 'paste',
        })
      );
    }

    if (menu.items.length > 0) {
      menu.popup();
    }
  });

  // Handle new window creation for links (fallback for any links not handled by onClick)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const protocol = new URL(url).protocol;
      if (BLOCKED_PROTOCOLS.includes(protocol)) {
        return { action: 'deny' };
      }
    } catch {
      return { action: 'deny' };
    }

    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle new-window events (alternative approach for external links)
  // Use type assertion for non-standard Electron event
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mainWindow.webContents.on('new-window' as any, function (event: any, url: string) {
    event.preventDefault();
    try {
      const protocol = new URL(url).protocol;
      if (BLOCKED_PROTOCOLS.includes(protocol)) {
        return;
      }
    } catch {
      return;
    }
    shell.openExternal(url);
  });

  const windowId = mainWindow.id;
  const url = getAppUrl();

  let appPath = '/';
  const routeMap: Record<string, string> = {
    chat: '/',
    pair: '/pair',
    sessions: '/sessions',
  };

  if (viewType) {
    appPath = routeMap[viewType] || '/';
  }
  if (appPath === '/' && initialMessage) {
    appPath = '/pair';
  }

  let searchParams = new URLSearchParams();
  if (resumeSessionId) {
    searchParams.set('resumeSessionId', resumeSessionId);
    if (appPath === '/') {
      appPath = '/pair';
    }
  }

  // Goose's react app uses HashRouter, so the path + search params follow a #/
  url.hash = `${appPath}?${searchParams.toString()}`;
  let formattedUrl = formatUrl(url);
  log.info('Opening URL: ', formattedUrl);
  mainWindow.loadURL(formattedUrl);

  // If we have an initial message, store it to send after React is ready
  if (initialMessage) {
    pendingInitialMessages.set(mainWindow.id, initialMessage);
  }

  // Set up local keyboard shortcuts that only work when the window is focused
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'r' && input.meta) {
      mainWindow.reload();
      event.preventDefault();
    }

    if (input.key === 'i' && input.alt && input.meta) {
      mainWindow.webContents.openDevTools();
      event.preventDefault();
    }
  });

  windowMap.set(windowId, mainWindow);

  // Handle window closure
  mainWindow.on('closed', () => {
    windowMap.delete(windowId);

    // Clean up pending initial message
    pendingInitialMessages.delete(windowId);

    if (goosedProcess && typeof goosedProcess === 'object' && 'kill' in goosedProcess) {
      goosedProcess.kill();
    }
  });
  return mainWindow;
};

// Global error handler
const handleFatalError = (error: Error) => {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((win) => {
    win.webContents.send('fatal-error', error.message || 'An unexpected error occurred');
  });
};

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', formatErrorForLogging(error));
  handleFatalError(error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', formatErrorForLogging(error));
  handleFatalError(error instanceof Error ? error : new Error(String(error)));
});

ipcMain.on('react-ready', (event) => {
  log.info('React ready event received');

  // Get the window that sent the react-ready event
  const window = BrowserWindow.fromWebContents(event.sender);
  const windowId = window?.id;

  // Send any pending initial message for this window
  if (windowId && pendingInitialMessages.has(windowId)) {
    const initialMessage = pendingInitialMessages.get(windowId)!;
    log.info('Sending pending initial message to window:', initialMessage);
    window.webContents.send('set-initial-message', initialMessage);
    pendingInitialMessages.delete(windowId);
  }

  log.info('React ready - window is prepared for deep links');
});

ipcMain.handle('open-external', async (_event, url: string) => {
  const parsedUrl = new URL(url);

  if (BLOCKED_PROTOCOLS.includes(parsedUrl.protocol)) {
    console.warn(`[Main] Blocked dangerous protocol: ${parsedUrl.protocol}`);
    return;
  }

  await shell.openExternal(url);
});

ipcMain.handle('get-setting', (_event, key: SettingKey) => {
  const settings = getSettings();
  return settings[key];
});

// Valid setting keys for runtime validation
const validSettingKeys: Set<string> = new Set([
  'spellcheckEnabled',
  'externalGoosed',
  'keyboardShortcuts',
  'theme',
  'useSystemTheme',
  'responseStyle',
  'showPricing',
]);

ipcMain.handle('set-setting', (_event, key: SettingKey, value: unknown) => {
  // Validate key at runtime to prevent prototype pollution
  if (!validSettingKeys.has(key)) {
    console.error(`Invalid setting key rejected: ${key}`);
    return;
  }

  const settings = getSettings();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (settings as any)[key] = value;
  fsSync.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
});

ipcMain.handle('get-secret-key', () => {
  const settings = getSettings();
  return getServerSecret(settings);
});

ipcMain.handle('get-goosed-host-port', async (event) => {
  const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
  if (!windowId) {
    return null;
  }
  const client = goosedClients.get(windowId);
  if (!client) {
    return null;
  }
  return client.getConfig().baseUrl || null;
});

ipcMain.handle('list-files', async (_event, dirPath, extension) => {
  try {
    // Expand tilde to home directory
    const expandedPath = expandTilde(dirPath);

    const files = await fs.readdir(expandedPath);
    if (extension) {
      return files.filter((file) => file.endsWith(extension));
    }
    return files;
  } catch (error) {
    console.error('Error listing files:', error);
    return [];
  }
});

ipcMain.handle('show-message-box', async (_event, options) => {
  return dialog.showMessageBox(options);
});

const createNewWindow = async (app: App, dir?: string | null) => {
  return await createChat(app, { dir: dir || undefined });
};

async function appMain() {
  await configureProxy();

  // Ensure Windows shims are available before any MCP processes are spawned
  await ensureWinShims();

  // Handle microphone permission requests
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    console.log('Permission requested:', permission);
    // Allow microphone and media access
    if (permission === 'media') {
      callback(true);
    } else {
      // Default behavior for other permissions
      callback(true);
    }
  });

  const buildConnectSrc = (): string => {
    const sources = [
      "'self'",
      'http://127.0.0.1:*',
      'https://127.0.0.1:*',
      'http://localhost:*',
      'https://localhost:*',
      'https://api.github.com',
      'https://github.com',
      'https://objects.githubusercontent.com',
    ];

    const settings = getSettings();
    if (settings.externalGoosed?.enabled && settings.externalGoosed.url) {
      try {
        const externalUrl = new URL(settings.externalGoosed.url);
        sources.push(externalUrl.origin);
      } catch {
        console.warn('Invalid external goosed URL in settings, skipping CSP entry');
      }
    }

    return sources.join(' ');
  };

  // Add CSP headers to all sessions
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy':
          "default-src 'self';" +
          "style-src 'self' 'unsafe-inline';" +
          "script-src 'self' 'unsafe-inline';" +
          "img-src 'self' data: https:;" +
          `connect-src ${buildConnectSrc()};` +
          "object-src 'none';" +
          "frame-src 'self' https: http:;" +
          "font-src 'self' data: https:;" +
          "media-src 'self' mediastream:;" +
          "form-action 'none';" +
          "base-uri 'self';" +
          "manifest-src 'self';" +
          "worker-src 'self';" +
          'upgrade-insecure-requests;',
      },
    });
  });

  const settings = getSettings();

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['Origin'] = 'http://localhost:5173';
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  const { dirPath } = parseArgs();

  await createNewWindow(app, dirPath);

  const shortcuts = getKeyboardShortcuts(settings);
  const findSubmenu: MenuItemConstructorOptions[] = [
    {
      label: 'Find…',
      accelerator: shortcuts.find || undefined,
      click() {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (focusedWindow) focusedWindow.webContents.send('find-command');
      },
    },
    {
      label: 'Find Next',
      accelerator: shortcuts.findNext || undefined,
      click() {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (focusedWindow) focusedWindow.webContents.send('find-next');
      },
    },
    {
      label: 'Find Previous',
      accelerator: shortcuts.findPrevious || undefined,
      click() {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (focusedWindow) focusedWindow.webContents.send('find-previous');
      },
    },
    {
      label: 'Use Selection for Find',
      accelerator: process.platform === 'darwin' ? 'Command+E' : undefined,
      click() {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (focusedWindow) focusedWindow.webContents.send('use-selection-find');
      },
      visible: process.platform === 'darwin',
    },
  ];

  const menuTemplate: MenuItemConstructorOptions[] = [];

  if (process.platform === 'darwin') {
    menuTemplate.push({ role: 'appMenu' });
  }

  menuTemplate.push({
    label: 'File',
    submenu: [
      {
        label: 'New Chat',
        accelerator: shortcuts.newChat || undefined,
        click() {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow) focusedWindow.webContents.send('new-chat');
        },
      },
      { type: 'separator' },
      process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
    ],
  });

  menuTemplate.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(process.platform === 'darwin' ? [{ role: 'pasteAndMatchStyle' as const }] : []),
      { role: 'delete' },
      { role: 'selectAll' },
      { type: 'separator' },
      { label: 'Find', submenu: findSubmenu },
    ],
  });

  menuTemplate.push({
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(shortcuts.toggleNavigation
        ? [
            { type: 'separator' as const },
            {
              label: 'Toggle Navigation',
              accelerator: shortcuts.toggleNavigation || undefined,
              click() {
                const focusedWindow = BrowserWindow.getFocusedWindow();
                if (focusedWindow) {
                  focusedWindow.webContents.send('toggle-navigation');
                }
              },
            },
          ]
        : []),
    ],
  });

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createNewWindow(app);
    }
  });

  ipcMain.on('notify', (event, data) => {
    try {
      // Validate notification data
      if (!data || typeof data !== 'object') {
        console.error('Invalid notification data');
        return;
      }

      // Validate title and body
      if (typeof data.title !== 'string' || typeof data.body !== 'string') {
        console.error('Invalid notification title or body');
        return;
      }

      // Limit the length of title and body
      const MAX_LENGTH = 1000;
      if (data.title.length > MAX_LENGTH || data.body.length > MAX_LENGTH) {
        console.error('Notification title or body too long');
        return;
      }

      // Remove any HTML tags for security
      const sanitizeText = (text: string) => text.replace(/<[^>]*>/g, '');

      console.log('NOTIFY', data);
      const notification = new Notification({
        title: sanitizeText(data.title),
        body: sanitizeText(data.body),
      });

      // Add click handler to focus the window
      notification.on('click', () => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) {
          if (window.isMinimized()) {
            window.restore();
          }
          window.show();
          window.focus();
        }
      });

      notification.show();
    } catch (error) {
      console.error('Error showing notification:', error);
    }
  });

  ipcMain.on('logInfo', (_event, info) => {
    try {
      // Validate log info
      if (info === undefined || info === null) {
        console.error('Invalid log info: undefined or null');
        return;
      }

      // Convert to string if not already
      const logMessage = String(info);

      // Limit log message length
      const MAX_LENGTH = 10000; // 10KB limit
      if (logMessage.length > MAX_LENGTH) {
        console.error('Log message too long');
        return;
      }

      // Log the sanitized message
      log.info('from renderer:', logMessage);
    } catch (error) {
      console.error('Error logging info:', error);
    }
  });

  ipcMain.on('reload-app', (event) => {
    // Get the window that sent the event
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.reload();
    }
  });

}

app.whenReady().then(async () => {
  try {
    await appMain();
  } catch (error) {
    dialog.showErrorBox('Goose Error', `Failed to create main window: ${error}`);
    app.quit();
  }
});

app.on('will-quit', async () => {});

app.on('window-all-closed', () => {
  app.quit();
});
