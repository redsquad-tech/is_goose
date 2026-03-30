/**
 * Telemetry is disabled in this trimmed desktop build.
 * These helpers remain as no-ops so error handling code can stay simple.
 */

export type AnalyticsEvent = {
  name: string;
  properties?: Record<string, unknown>;
};

export function setTelemetryEnabled(_enabled: boolean): void {}

export function trackEvent(_event: AnalyticsEvent): void {}

export function trackErrorWithContext(
  _error: unknown,
  _context: {
    component?: string;
    page?: string;
    action?: string;
    recoverable?: boolean;
  } = {}
): void {}

export function getErrorType(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name || 'Error';
    const message = error.message.split('\n')[0].slice(0, 200);
    return `${name}: ${message}`;
  }
  return String(error).slice(0, 200);
}
