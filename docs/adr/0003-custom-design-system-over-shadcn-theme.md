# ADR-0003 — A custom design system over an off-the-shelf shadcn theme

- **Status:** accepted
- **Date:** initial architecture pass
- **Spec:** Part II §48.2 (UI decision), §0–§4 (design decisions, reference language, glass parameters, colour tokens), §98 (dark mode), §99 (forbidden practices), §102 (design summary)

## Context

The product's visual identity is not decoration; it is a stated requirement.
Part II §102 puts it in the one-line summary: port the reference image's soft
Aurora background, frosted glass, floating cards, document-feel transcript,
narrow icon rail and pastel AI pill *faithfully*. Part II §87 turns that into
visual acceptance criteria, and Part II §100 makes it a release gate — the
first bullet under "Visual" is that a viewer should feel the same design
language at first glance, and it is explicit that this means blur, depth,
floating cards, borders, background light, spacing, roundness, transcript
structure, gradient status pill and icon rail, **not** "the colours look
similar".

shadcn/ui is the obvious starting point for a Next.js + Radix + Tailwind
application, and it is a good library. The question is whether to adopt its
theme.

Part II §48.2 answers it directly:

> Custom Design System + Radix UI primitives + Tailwind CSS / CSS Variables
>
> **Key decision:** do not use the complete default shadcn theme to build a
> generic SaaS. You may use the primitives, but glass, blur, gradient, spacing,
> cards and button skin must all be defined yourself.

Part II §99 then forbids, by name, several things a default theme gives you for
free: 8px radii, filled material-design cards, heavy borders, Bootstrap-style
tables, and excessive shadows.

## Decision

**Take Radix primitives for behaviour. Write every pixel of the skin
ourselves.**

Concretely:

**`packages/design-tokens`** owns every visual constant: the light and dark
CSS-variable sets, the Tailwind preset, the aurora background and the dot-matrix
pattern. No component defines a colour, a blur radius, a shadow or a corner
radius. Nothing else in the repository is permitted a hex literal — Part II §99,
enforced in `CONTRIBUTING.md` and in the PR checklist.

**`packages/ui`** owns the components. Each wraps a Radix primitive (or is
plain, where no primitive is needed) and applies our skin through the tokens.
Radix supplies focus management, keyboard interaction, portalling, ARIA wiring,
controlled/uncontrolled state and dismissal semantics — the parts that are hard,
tedious and dangerous to get wrong (Part I §47 requires real accessibility).
It supplies no visual opinion, which is exactly the division we want.

**Not shadcn's CLI or its `components/ui` copy-in pattern.** We depend on
`@radix-ui/*` directly. shadcn's model is to copy pre-skinned source into your
repository; the skin is the part we are replacing wholesale, so copying it in
first and then rewriting it produces a component that looks custom and reads
like a diff against someone else's defaults.

Two guard rails follow from the same reasoning:

- **Generic visual components go in `packages/ui`, never in `apps/web`.** A
  `Button` living in a feature folder is how a second, divergent design system
  starts.
- **`packages/ui` carries no business semantics.** No `PersonaCard`, no
  `ScenarioPill`. Those are app-level and belong in `apps/web/src/components` or
  a feature folder. Otherwise the UI package accretes product knowledge and
  stops being reusable.

## Consequences

### Good

- **§100's visual acceptance is achievable.** Glass depth, aurora light and the
  transcript's document feel are the identity. A theme override on top of a
  system designed for flat cards fights it at every step; owning the tokens
  means it is just the design.
- **Dark mode is designed, not derived.** Part II §98 is explicit that dark mode
  is not an inversion of light mode — the imagined framing is the reference
  image *at night*: glass still transparent, blue-violet light sources more
  prominent, white borders becoming low-opacity white. Two authored token sets
  express that. A generated dark variant cannot.
- **The §99 forbidden list is structurally avoidable.** Radii, borders, shadows
  and card treatments are all token values, so "8px radius" is not reachable by
  accident.
- **Accessibility comes from the primitives.** Radix's focus traps, roving
  tabindex, escape handling and ARIA are battle-tested. Writing those ourselves
  to match a custom skin would be the actual mistake.
- **One place to change anything visual.** A blur value, an accent, a spacing
  step: one file, whole app.

### Bad, and what we do about it

- **Real up-front cost.** Roughly 27 components had to be written before the
  first page could be built. That is Phase 0 work that shows nothing to a
  stakeholder, and it was still the right order.
- **Every new component is our problem.** No `npx shadcn add`. Mitigated by
  `packages/ui/README.md` documenting the house pattern (Radix primitive + `cn`
  + tokens + `focus-ring`) so a new component is composition rather than
  invention.
- **We own the accessibility of anything Radix does not cover.** Custom
  compositions — the transcript, the persona state card, the data-viz components
  — get no primitive. Part I §47 still applies to them.
- **Contributors have to learn our conventions before ours-vs-Tailwind's
  instinct is right.** The no-hex-literals rule is the one people trip over, so
  it is in `CONTRIBUTING.md`, in the PR checklist, and worth a lint rule in
  Phase 1.
- **Divergence risk between `packages/ui` and `apps/web`.** The
  ownership map in `docs/PROJECT_STRUCTURE.md` §4 states what may not go in each
  package, and the PR checklist asks about it directly.

### Rejected alternatives

- **shadcn/ui default theme, lightly customised** — rejected by Part II §48.2 by
  name, and rejected on merits: the default theme's flat cards, 8px radii and
  filled surfaces are on the §99 forbidden list, so "lightly customised" would
  in practice mean overriding almost all of it while inheriting its structure.
- **A full component library** (MUI, Mantine, Chakra) — rejected. Each brings a
  strong visual opinion and a styling runtime, and fighting that opinion is more
  work than not having it.
- **Headless UI instead of Radix** — a reasonable alternative with a narrower
  primitive set. Radix was chosen for coverage: it has the popover, dropdown,
  slider, switch, tabs, scroll-area and tooltip primitives the spec's pages
  need, and the spec's own §48.2 names it.
- **Tailwind alone, no primitives** — rejected. It would mean hand-writing focus
  management and ARIA for every interactive component, which is where
  accessibility bugs live.
