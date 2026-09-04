/**
 * Fixture scaffolding for the demo scenario in §59 (insurance-sales AI Coach).
 *
 * Everything under `src/lib/fixtures/` is typed against `@ai-coach/shared-types`
 * so that swapping a fixture for a real API call is a one-line change in the
 * page/feature that consumes it. No fixture may invent a field that is not in
 * the contract.
 *
 * Timestamps are fixed strings rather than `Date.now()` so server and client
 * render identically (no hydration mismatch) and screenshots stay stable.
 */
export const TENANT_ID = 'tn_hexagon';
export const WORKSPACE_ID = 'ws_life_apac';
export const NOW_ISO = '2026-03-18T09:24:00.000Z';

/** Convenience for fixture authoring: `daysAgo(3)` → ISO string. */
export function daysAgo(days: number, hours = 0): string {
  const base = new Date(NOW_ISO).getTime();
  return new Date(base - days * 86_400_000 - hours * 3_600_000).toISOString();
}

export function minutesAgo(minutes: number): string {
  return new Date(new Date(NOW_ISO).getTime() - minutes * 60_000).toISOString();
}

export function inDays(days: number): string {
  return new Date(new Date(NOW_ISO).getTime() + days * 86_400_000).toISOString();
}

export const SCOPE = {
  tenant_id: TENANT_ID,
  workspace_id: WORKSPACE_ID,
} as const;
