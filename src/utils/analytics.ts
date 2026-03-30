/**
 * Analytics is intentionally disabled in this trimmed frontend build.
 * The exported functions remain as no-ops so the UI can compile without
 * any telemetry, onboarding funnel, or usage tracking behavior.
 */

export type AnalyticsEvent =
  | { name: 'page_view'; properties: { page: string; referrer?: string } }
  | { name: 'onboarding_started'; properties: Record<string, never> }
  | {
      name: 'onboarding_provider_selected';
      properties: {
        method:
          | 'api_key'
          | 'openrouter'
          | 'tetrate'
          | 'chatgpt_codex'
          | 'ollama'
          | 'local'
          | 'other';
      };
    }
  | {
      name: 'onboarding_completed';
      properties: { provider: string; model?: string; duration_seconds?: number };
    }
  | { name: 'onboarding_abandoned'; properties: { step: string; duration_seconds?: number } }
  | {
      name: 'onboarding_setup_failed';
      properties: {
        provider: 'openrouter' | 'tetrate' | 'chatgpt_codex' | 'local';
        error_message?: string;
      };
    }
  | {
      name: 'error_occurred';
      properties: {
        error_type: string;
        component?: string;
        page?: string;
        action?: string;
        stack_summary?: string;
        recoverable: boolean;
      };
    }
  | { name: 'app_crashed'; properties: { error_type: string; component?: string; page?: string } }
  | { name: 'app_reloaded'; properties: { reason?: string } }
  | { name: 'model_changed'; properties: { provider: string; model: string } }
  | { name: 'settings_tab_viewed'; properties: { tab: string } }
  | { name: 'setting_toggled'; properties: { setting: string; enabled: boolean } }
  | {
      name: 'telemetry_preference_set';
      properties: { enabled: boolean; location: 'settings' | 'onboarding' | 'modal' };
    }
  | { name: 'input_file_attached'; properties: { file_type: 'file' | 'directory' } }
  | {
      name: 'input_voice_dictation';
      properties: {
        action: 'start' | 'stop' | 'transcribed' | 'error' | 'auto_submit';
        duration_seconds?: number;
        error_type?: string;
      };
    }
  | { name: 'input_mode_changed'; properties: { from_mode: string; to_mode: string } }
  | { name: 'input_diagnostics_opened'; properties: Record<string, never> }
  | {
      name: 'update_check_started';
      properties: { trigger: 'startup' | 'manual'; current_version: string };
    }
  | {
      name: 'update_check_completed';
      properties: {
        result: 'available' | 'not_available' | 'error';
        current_version: string;
        latest_version?: string;
        using_fallback: boolean;
        error_type?: string;
      };
    }
  | {
      name: 'update_download_started';
      properties: {
        version: string;
        method: 'electron-updater' | 'github-fallback';
      };
    }
  | {
      name: 'update_download_progress';
      properties: {
        milestone: 25 | 50 | 75 | 100;
        version: string;
        method: 'electron-updater' | 'github-fallback';
      };
    }
  | {
      name: 'update_download_completed';
      properties: {
        success: boolean;
        version: string;
        method: 'electron-updater' | 'github-fallback';
        duration_seconds?: number;
        error_type?: string;
      };
    }
  | {
      name: 'update_install_initiated';
      properties: {
        version: string;
        method: 'electron-updater' | 'github-fallback';
        action: 'quit_and_install' | 'open_folder_and_quit' | 'open_folder_only';
      };
    };

export type UpdateMethod = 'electron-updater' | 'github-fallback';

export function setTelemetryEnabled(_enabled: boolean): void {}

export function trackEvent<T extends AnalyticsEvent>(_event: T): void {}

export function trackPageView(_page: string, _referrer?: string): void {}

export function trackError(
  _errorType: string,
  _options: {
    component?: string;
    page?: string;
    action?: string;
    stackSummary?: string;
    recoverable?: boolean;
  } = {}
): void {}

export function trackErrorWithContext(
  _error: unknown,
  _context: {
    component?: string;
    page?: string;
    action?: string;
    recoverable?: boolean;
  } = {}
): void {}

export function trackOnboardingStarted(): void {}

export function trackOnboardingProviderSelected(
  _method: 'api_key' | 'openrouter' | 'tetrate' | 'chatgpt_codex' | 'ollama' | 'local' | 'other'
): void {}

export function trackOnboardingCompleted(_provider: string, _model?: string): void {}

export function trackOnboardingAbandoned(_step: string): void {}

export function trackOnboardingSetupFailed(
  _provider: 'openrouter' | 'tetrate' | 'chatgpt_codex' | 'local',
  _errorMessage?: string
): void {}

export function trackModelChanged(_provider: string, _model: string): void {}

export function trackSettingsTabViewed(_tab: string): void {}

export function trackSettingToggled(_setting: string, _enabled: boolean): void {}

export function trackTelemetryPreference(
  _enabled: boolean,
  _location: 'settings' | 'onboarding' | 'modal'
): void {}

export function getErrorType(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name || 'Error';
    const message = error.message.split('\n')[0].slice(0, 200);
    return `${name}: ${message}`;
  }
  return String(error).slice(0, 200);
}

export function getStackSummary(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.stack) {
    return undefined;
  }

  const lines = error.stack.split('\n').slice(1, 5);
  const frames = lines
    .map((line) => {
      const match = line.match(/at\s+([A-Za-z0-9_$.]+)/);
      return match ? match[1] : null;
    })
    .filter(Boolean);

  return frames.length > 0 ? frames.join(' > ') : undefined;
}

export function trackFileAttached(_fileType: 'file' | 'directory'): void {}

export function trackVoiceDictation(
  _action: 'start' | 'stop' | 'transcribed' | 'error' | 'auto_submit',
  _durationSeconds?: number,
  _errorType?: string
): void {}

export function trackModeChanged(_fromMode: string, _toMode: string): void {}

export function trackDiagnosticsOpened(): void {}

export function trackUpdateCheckStarted(
  _trigger: 'startup' | 'manual',
  _currentVersion: string
): void {}

export function trackUpdateCheckCompleted(
  _result: 'available' | 'not_available' | 'error',
  _currentVersion: string,
  _options: {
    latestVersion?: string;
    usingFallback: boolean;
    errorType?: string;
  }
): void {}

export function trackUpdateDownloadStarted(_version: string, _method: UpdateMethod): void {}

export function trackUpdateDownloadProgress(_percent: number): void {}

export function trackUpdateDownloadCompleted(
  _success: boolean,
  _version: string,
  _method: UpdateMethod,
  _errorType?: string
): void {}

export function trackUpdateInstallInitiated(
  _version: string,
  _method: UpdateMethod,
  _action: 'quit_and_install' | 'open_folder_and_quit' | 'open_folder_only'
): void {}
