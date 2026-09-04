/** Formatting helpers for the Live Simulation surface. */

/** `0:22` / `1:04:07` — transcript timecodes (§16 `Avatar Name 00:08`). */
export function formatClock(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** `00:08` — always two-digit minutes, used by the session timer badge. */
export function formatTimer(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const body = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return hours > 0 ? `${hours}:${body}` : body;
}

export function formatPercent(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${Math.round(Math.min(100, Math.max(0, safe)))}%`;
}

export function formatScore(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return String(Math.round(Math.min(100, Math.max(0, safe))));
}

export function formatSimilarity(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  // Retrieval scores arrive either 0–1 or 0–100 depending on the reranker (§12.5).
  const normalised = value > 1 ? value / 100 : value;
  return normalised.toFixed(3);
}

/** Human label for an intent slug: `price_objection` → `Price Objection` (§20 / §22). */
export function humaniseSlug(slug: string | undefined): string {
  if (!slug) return '—';
  return slug
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => (part.length <= 2 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1)))
    .join(' ');
}

export function clampPercent(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural ?? `${singular}s`}`;
}
