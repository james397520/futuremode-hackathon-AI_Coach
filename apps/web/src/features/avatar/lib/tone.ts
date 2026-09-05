/**
 * Single seam onto the design vocabulary this feature borrows.
 *
 * The avatar stage is mounted *inside* the simulation's persona card, so its
 * washes, pills and aurora glow must be the same objects the surrounding cards
 * use — a second, parallel set of colour helpers would drift within a sprint and
 * the card would visibly stop matching its own column.
 *
 * Everything is re-exported through this one file so the coupling to
 * `features/simulation/lib/tone` is a single, greppable import. Those helpers are
 * pure functions over design tokens (`color-mix()` on `var(--accent-*)`) with no
 * simulation state in them, and §99 forbids hex literals anywhere here.
 */
export {
  auroraGlow,
  INK,
  insetSurface,
  onMediaSurface,
  pillSurface,
  tint,
  TONE_CSS,
  toneText,
  toneVar,
  type ToneKey,
} from '../../simulation/lib/tone';

export { cn, GlassCard, GradientPill, Skeleton } from '@ai-coach/ui';
