/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SINGLE SEAM BETWEEN apps/web AND packages/ui
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every generic glass primitive used anywhere in this app is re-exported from
 * here, and nowhere else imports `@ai-coach/ui` directly. `packages/ui` is
 * written by a different owner (see docs/PROJECT_STRUCTURE.md §5), so if a name
 * or prop shape lands differently, this is the *only* file that needs editing.
 *
 * Assumed API surface (all props optional unless noted). EVERY component is also
 * assumed to accept `className` and to forward unknown DOM props (aria-*, role,
 * onClick) to its root element:
 *
 *   GlassShell        { children, className }                       §3.1 outer frame
 *   GlassCard         { children, className, tone?: 'card'|'strong', padding? }
 *   Button            { variant?: 'primary'|'secondary'|'ghost'|'subtle'|'danger',
 *                       size?: 'sm'|'md'|'lg', asChild?, ...button }
 *                       `asChild` follows the Radix convention (§48.2 mandates Radix
 *                       primitives) and is used to render a real <Link> anchor while
 *                       keeping the button skin. If the kit does not ship it, replace
 *                       those call sites with a router push.
 *   IconButton        { label (required, a11y), size?, ...button }
 *   Pill              { tone?: 'gradient'|'neutral'|'success'|'warning'|'danger'|'info',
 *                       size?: 'sm'|'md' }                          §86 status pill
 *   Badge             { tone?, children }
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
 *   Skeleton          { className }
 *   ToastViewport     {}                                            §82
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
  Badge,
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
  Skeleton,
  ToastViewport,
} from '@ai-coach/ui';
