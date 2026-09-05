/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SINGLE SEAM BETWEEN apps/web AND packages/ui
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every generic glass primitive used anywhere in this app is re-exported from
 * here, and nowhere else imports `@ai-coach/ui` directly. `packages/ui` is
 * written by a different owner (see docs/PROJECT_STRUCTURE.md §5), so if a name
 * or prop shape shifts, this is the *only* file that needs editing.
 *
 * Surface below is **verified against `packages/ui/src`**. All props optional
 * unless noted; every component accepts `className` and forwards unknown DOM
 * props (aria-*, role, onClick) to its root element.
 *
 * Three prop names are easy to get wrong because they are not the DOM spelling:
 *   - `Select` / `Tabs` / `SegmentedControl` take `ariaLabel`, not `aria-label`
 *     (they do not spread HTML attributes). `Progress` and `StepProgress` DO
 *     take `aria-label`.
 *   - `CommandPalette` items use `description`, not `hint`.
 *   - `StatTile` and `EmptyState` default to `surface="plain"` / `"card"`
 *     respectively — pass `surface="card"` for a standalone StatTile.
 *
 *   GlassShell        { children, className }                       §3.1 outer frame
 *   GlassCard         { children, className, tone?: 'card'|'strong'|'floating', padding? }
 *                       `floating` = card glass + --shadow-floating; use it for anything
 *                       that hovers over the page (consent card, popovers).
 *   Button            { variant?: 'primary'|'secondary'|'ghost'|'subtle'|'danger',
 *                       size?: 'sm'|'md'|'lg', asChild?, ...button }
 *                       `asChild` follows the Radix convention (§48.2 mandates Radix
 *                       primitives) and is used to render a real <Link> anchor while
 *                       keeping the button skin. If the kit does not ship it, replace
 *                       those call sites with a router push.
 *   IconButton        { label (required, a11y), size?, ...button }
 *   Pill              { tone?: 'gradient'|'neutral'|'success'|'warning'|'danger'|'info'|'accent',
 *                       size?: 'sm'|'md' }                          §86 status pill
 *                       Avoid `gradient` for text pills — white on the ramp is ~2:1.
 *   StatTile          { label, value, delta?, hint?, icon? }         §13.3 KPI
 *   StepProgress      { steps: {id,label}[], current: number }       §33 / §17 stepper
 *   CommandPalette    { open, onOpenChange, groups, placeholder? }   §79
 *   Input/Textarea    native props + { invalid? }
 *   Select            { value, onValueChange: (s: string) => void,
 *                       options: {value,label}[], disabled? }
 *   Switch            { checked, onCheckedChange: (b: boolean) => void, label?, disabled? }
 *                       Pass `aria-label` when `label` is omitted.
 *   Slider            { value: number, onValueChange: (n: number) => void,
 *                       min?, max?, step?, label?, hint?, disabled? }  §35 gradient track
 *   Field             { label, hint?, error?, className?, children }
 *   Tabs              { value, onValueChange, items: {value,label,count?}[] }
 *                       Renders the tab strip only — panels are rendered by the caller.
 *   Modal             { open, onOpenChange, title, description?, footer?,
 *                       size?: 'sm'|'md'|'lg', children }              §83 glass modal
 *   Drawer            { open, onOpenChange, side?: 'right'|'left', title, children }
 *   Tooltip           { content, side?, children }
 *   Avatar            { name, src?, size?: 'sm'|'md'|'lg' } — initials fallback
 *   ProgressBar       { value, max?, tone?: 'default'|'success'|'warning'|'danger',
 *                       label? (a11y name, not visible) }              §29 pipeline bar
 *   EmptyState        { icon?, title, description?, action? }        §45
 *   SegmentedControl  { value, onValueChange, options: {value,label,icon?}[] }
 *   ToastViewport     {}                                            §82
 *
 * `Badge` (a small `Pill`) and `Skeleton` also exist in the kit but are not
 * re-exported here because nothing in this app uses them yet — keeping the seam
 * to exactly what is consumed means a kit rename can only break code we own.
 *
 * Do NOT add business-semantic components (Persona/Score/Transcript...) to
 * packages/ui — those live in apps/web (`src/components/*`, `src/features/*`).
 */
export {
  GlassShell,
  GlassCard,
  Button,
  IconButton,
  Pill,
  StatTile,
  StepProgress,
  CommandPalette,
  Input,
  Textarea,
  Select,
  Switch,
  Slider,
  Field,
  Tabs,
  Modal,
  Drawer,
  Tooltip,
  Avatar,
  ProgressBar,
  EmptyState,
  SegmentedControl,
  ToastViewport,
} from '@ai-coach/ui';
