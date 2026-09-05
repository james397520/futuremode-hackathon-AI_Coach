/**
 * The ONE place that answers "where is the backend, and is there one?".
 *
 * This used to be answered in three places with different defaults:
 * `api-client.ts` and `ws-client.ts` defaulted to `http://localhost:8000`, while
 * `features/simulation/lib/env.ts` defaulted to `''` and treated the empty
 * string as "no backend". The result was a session whose REST calls hit the real
 * API while its conversation replayed the scripted demo — a fake conversation
 * that looked completely real. Everything now imports from here.
 *
 * Values come from the monorepo-root `.env`, which `next.config.mjs` loads
 * before the build reads `process.env` (see `loadRootEnv` there). NEXT_PUBLIC_*
 * is the only prefix Next inlines into the browser bundle, so no secret can
 * reach the client through this module.
 */

/**
 * Next inlines `process.env.NEXT_PUBLIC_X` only for *literal* member reads, so
 * each variable must be spelled out rather than looked up by a computed key.
 */
function read(value: string | undefined, fallback: string): string {
  const text = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
  return text.length > 0 ? text : fallback;
}

/** FastAPI orchestrator. */
export const API_BASE_URL: string = read(
  process.env.NEXT_PUBLIC_API_BASE_URL,
  'http://localhost:8000',
);

/** Same server, WebSocket scheme — derived from the API origin when unset. */
export const WS_BASE_URL: string = read(
  process.env.NEXT_PUBLIC_WS_BASE_URL,
  API_BASE_URL.replace(/^http/, 'ws'),
);

/** Local avatar runtime (LivePortrait + MuseTalk), loopback-only and optional. */
export const AVATAR_BASE_URL: string = read(
  process.env.NEXT_PUBLIC_AVATAR_BASE_URL,
  'http://127.0.0.1:8765',
);

export const AVATAR_WS_BASE_URL: string = read(
  process.env.NEXT_PUBLIC_AVATAR_WS_URL,
  AVATAR_BASE_URL.replace(/^http/, 'ws'),
);

/**
 * A backend origin is always configured now (the fallback above is a real,
 * reachable dev default), so this is true unless someone explicitly blanks it.
 */
export const hasBackend: boolean = API_BASE_URL.length > 0;

/**
 * The scripted §59 insurance demo is **opt-in**, never a silent fallback.
 *
 * Set `NEXT_PUBLIC_USE_MOCK=1` to replay it (design reviews, offline demos,
 * screenshots). When the backend is simply unreachable the session surfaces a
 * connection error instead of quietly inventing a conversation — the previous
 * behaviour made a scripted persona indistinguishable from the live model.
 */
export const shouldUseMockStream: boolean = read(process.env.NEXT_PUBLIC_USE_MOCK, '') === '1';
