/**
 * Single seam onto the shared UI kit.
 *
 * Every `@ai-coach/ui` import in this feature funnels through this one file, so
 * if the kit's surface shifts there is exactly one place to fix. Only the pieces
 * actually used are re-exported.
 *
 * ── Verified against `packages/ui/src` ───────────────────────────────────────
 *   cn(...inputs: ClassValue[])            clsx + tailwind-merge (preset scales
 *                                          registered, so our className always wins)
 *   GlassCard   HTMLAttributes<div> + { variant|tone: 'card'|'strong'|'floating',
 *                                       radius, padding, interactive, bleed, strong }
 *   GradientPill HTMLAttributes<span> + { tone, size, sparkle, icon, srLabel }
 *   Textarea    TextareaHTMLAttributes + { resize, invalid, hint }, forwards ref
 *   Tooltip     { content?, side?, align?, sideOffset?, children }  (renders
 *               children bare when `content` is empty; Radix Root carries its own
 *               default provider context, so no app-level Provider is required)
 *   Modal       { open, onClose?, onOpenChange?, title?, description?, footer?,
 *                 size?, children, className? }
 *   Avatar      { src?, alt?, name?, size?: AvatarSize | number, shape?, fallback? }
 *   PersonaAvatar  Avatar props + { speaking?, glow?, status?, statusLabel? }
 *   Skeleton    HTMLAttributes<span> + { shape? }
 *
 * NOTE on `size`: the kit types `size` as `AvatarSize | number`, but its
 * implementation only maps the named scale to a class, so this feature always
 * passes named sizes ('sm' in the transcript gutter, 'xl' on the persona stage).
 *
 * Deliberately NOT used, and why:
 *   - `Progress`   — §22 wants a 4px hairline meter, not a progress bar, so
 *                    `atoms.tsx#Meter` renders it from tokens directly.
 *   - `ScrollArea` — the transcript needs raw scroll events + `scrollTop` control
 *                    to yield auto-scroll to the reader; it uses a plain overflow
 *                    container styled by `.sim-scroll`.
 *   - motion presets — `packages/ui/src/components/motion.tsx` exports plain
 *     objects that the consumer feeds to `framer-motion`. §43 motion here is
 *     pure CSS (`simulation-styles.tsx`) using the *same* numbers (enter 8px /
 *     280ms, float-in 12px / 320ms, hover -1px, ease `--ease-out-soft`): the
 *     transcript is a high-frequency list, and keyframes keep the streaming
 *     rows off the animation runtime entirely. Swapping to the presets later is
 *     a local change in `simulation-styles.tsx` + the `sim-*` class users.
 *   - `lucide-react` — available in `apps/web`, but the icon set here is local
 *     inline SVG so a transcript row costs no extra module graph.
 */
export {
  cn,
  GlassCard,
  GradientPill,
  Textarea,
  Tooltip,
  Modal,
  PersonaAvatar,
  Avatar,
  Skeleton,
} from '@ai-coach/ui';
