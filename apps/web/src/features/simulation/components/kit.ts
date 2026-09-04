/**
 * Single reconciliation point for the shared UI kit.
 *
 * `packages/ui` is owned by another agent and is being written in parallel, so
 * every import of it in this feature funnels through this one file. If a name or
 * prop shape lands differently, this is the only file that needs to change.
 *
 * ── Assumed contracts ────────────────────────────────────────────────────────
 *   cn(...classes: Array<string | false | null | undefined>): string
 *   GlassShell    { className?, children }                        // §3.1 outer glass frame
 *   GlassCard     { className?, children, strong?: boolean }      // §3.2 / §3.3 inner card
 *   GradientPill  { className?, children }                        // §86 small gradient status pill
 *   Button        <button> props + { variant?: 'primary'|'secondary'|'ghost'|'danger',
 *                                    size?: 'sm'|'md'|'lg' }
 *   IconButton    <button> props + { label: string, size?: 'sm'|'md'|'lg',
 *                                    variant?: 'ghost'|'secondary'|'danger' }
 *   Textarea      <textarea> props, forwards ref
 *   Tooltip       { content: ReactNode, children }
 *   Modal         { open: boolean, onClose: () => void, title?: ReactNode, children }
 *   Switch        { checked: boolean, onCheckedChange: (v: boolean) => void, label?: string }
 *   PersonaAvatar { name: string, src?: string, size?: number|string, speaking?: boolean }
 *   Avatar        { name: string, src?: string, size?: number|string }
 *   AiSparkle     { className? }
 *   Skeleton      { className? }
 *
 * Deliberately NOT used here (and why):
 *   - `Progress`      — §22 wants a 4px hairline meter, not a progress bar.
 *   - `ScrollArea`    — the transcript needs direct scroll-event + scrollTop
 *                       control for yield-on-scroll-up, so it uses a plain
 *                       overflow container with token-styled scrollbars.
 *   - motion presets  — `framer-motion` is not guaranteed to be a dependency of
 *                       `apps/web` (that package.json belongs to another owner),
 *                       so §43 motion is implemented in CSS in `simulation-styles`.
 */
export {
  cn,
  GlassShell,
  GlassCard,
  GradientPill,
  Button,
  IconButton,
  Textarea,
  Tooltip,
  Modal,
  Switch,
  PersonaAvatar,
  Avatar,
  AiSparkle,
  Skeleton,
} from '@ai-coach/ui';
