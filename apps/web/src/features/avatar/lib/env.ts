/**
 * Avatar Runtime endpoints — §39 base URL, §67 `.env`.
 *
 * The runtime binds to loopback and is *optional*: a laptop with no engines
 * installed simply has nothing on port 8765, and that must be a normal, quiet
 * state rather than an error (§53). The defaults below therefore always point at
 * a plausible local runtime; presence is decided by `GET /health`, not by config.
 *
 * `process.env.NEXT_PUBLIC_*` is read as a literal member expression so Next
 * inlines it at build time.
 */

/*
 * The two origins come from the single source of truth (`@/lib/runtime-env`) so
 * they cannot drift from what `next.config.mjs` pins in `connect-src`. Only the
 * avatar-specific knobs below live here.
 */
import { AVATAR_BASE_URL, AVATAR_WS_BASE_URL } from '@/lib/runtime-env';

function trimmed(value: string | undefined): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

/** `NEXT_PUBLIC_AVATAR_BASE_URL` — HTTP origin of the Avatar Runtime. */
export { AVATAR_BASE_URL };

/** `NEXT_PUBLIC_AVATAR_WS_URL` — WebSocket origin; derived from the HTTP one when unset. */
export const AVATAR_WS_URL: string = AVATAR_WS_BASE_URL;

/** `NEXT_PUBLIC_AVATAR_ID` — the prepared avatar asset (§7). */
export const AVATAR_ID: string = trimmed(process.env.NEXT_PUBLIC_AVATAR_ID) || 'customer_001';

/**
 * `NEXT_PUBLIC_AVATAR_ENABLED=0` hard-disables every network call, for reviewers
 * who want the fallback path deterministically (and for CI).
 */
export const AVATAR_ENABLED: boolean = trimmed(process.env.NEXT_PUBLIC_AVATAR_ENABLED) !== '0';

/** §35 / §56 starting profile. The runtime may lower fps via `/capabilities`. */
export const AVATAR_DEFAULT_FPS = 25;
export const AVATAR_DEFAULT_WIDTH = 512;
export const AVATAR_DEFAULT_HEIGHT = 512;

/** §3.1 — Mode A (expression state bank) is the P0 runtime mode. */
export const AVATAR_DEFAULT_MODE = 'state_bank' as const;

/** Health probes must fail fast: an absent runtime should not stall the stage. */
export const AVATAR_PROBE_TIMEOUT_MS = 2_500;
export const AVATAR_REQUEST_TIMEOUT_MS = 8_000;
