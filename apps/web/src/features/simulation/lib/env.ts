/**
 * Backend presence detection. When `NEXT_PUBLIC_API_BASE_URL` is unset the page
 * runs the scripted demo stream from `../mock/mock-event-stream` so the most
 * important screen of the product is always demoable with no backend.
 */

function readEnv(key: 'NEXT_PUBLIC_API_BASE_URL' | 'NEXT_PUBLIC_WS_BASE_URL'): string {
  // Next.js inlines these at build time; the indexed read keeps the file
  // resilient if `process` is momentarily unavailable (e.g. a test runner).
  const env = typeof process !== 'undefined' ? process.env : undefined;
  const value = key === 'NEXT_PUBLIC_API_BASE_URL' ? env?.NEXT_PUBLIC_API_BASE_URL : env?.NEXT_PUBLIC_WS_BASE_URL;
  return typeof value === 'string' ? value.trim() : '';
}

export const API_BASE_URL: string = readEnv('NEXT_PUBLIC_API_BASE_URL');
export const WS_BASE_URL: string = readEnv('NEXT_PUBLIC_WS_BASE_URL');

/** True when a real backend is configured. */
export const hasBackend: boolean = API_BASE_URL.length > 0;

/** True when the page should replay the §59 scripted insurance demo. */
export const shouldUseMockStream: boolean = !hasBackend;
