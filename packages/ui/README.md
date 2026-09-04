# `@ai-coach/ui`

Soft Aurora Glassmorphism 元件庫。React 18 + TypeScript + Tailwind + Radix primitives。

對應規格：`docs/spec/AI_Coach_Spec_v3.md` Part II（§0–§47、§79–§87、§99–§100）。
歸屬定義：`docs/PROJECT_STRUCTURE.md` §4 / §5（Owner = UI Kit，只能寫 `packages/ui/**`）。

---

## 1. 這裡放什麼 / 不放什麼

| 放這裡（`packages/ui`） | 放 `apps/web` |
|---|---|
| Button / GlassCard / GradientPill / Slider / DataList… | 任何有業務語意的元件 |
| `CommandPalette` **primitive**（items 由外部傳入） | Command palette 的指令清單（Start simulation、New persona…） |
| `StepProgress` 的視覺與 a11y | 9-step Scenario Builder 的步驟名稱（§17） |
| `PersonaAvatar` 的光暈與 speaking 狀態 | Persona 的欄位、狀態機、API 呼叫 |
| `motion` preset 物件 | `framer-motion` 的實際使用與頁面編排 |
| `ScrollArea` 極細 scrollbar（§84） | Transcript 的訊息型別與虛擬清單邏輯 |

判準一句話：**看得到「Persona / Scenario / Knowledge / Session / Report」這些字，就不該出現在這個 package 裡。**
本 package 對外的 API 只有 `label` / `items` / `steps` / `tone` 這種通用名詞。

---

## 2. Tokens only — 沒有 hex

- 顏色、圓角、陰影、blur、字級、間距**一律**來自 `@ai-coach/design-tokens`：
  - Tailwind preset utility：`bg-glass-card`、`bg-glass-strong`、`text-text-primary`、
    `border-border-soft`、`rounded-card`、`rounded-button`、`shadow-floating`、
    `backdrop-blur-card`、`text-card-title`、`p-safe`、`max-w-shell`、`ease-out-soft`…
  - 需要組合值時用 `var(--…)`：例如
    `[box-shadow:var(--shadow-soft),var(--shadow-inset-hi)]`、
    `duration-[var(--dur-hover)]`。
  - 需要「同一顏色的低透明度」時用 `color-mix(in srgb, var(--accent-blue) 45%, transparent)`，
    這樣 light / dark 會自動跟著 token 走，而不是寫死 `rgba()`。
- **禁止**在元件裡出現 `#rrggbb`。唯一例外是 `text-white` / `bg-white`
  （漸層 pill / switch thumb 上的前景，與 `aurora.css` 的 `.gradient-pill { color: #fff }` 一致）。
- `packages/design-tokens/**` 是**契約，只能讀不能改**。需要新 token 時去改契約層，不要在這裡發明。

### 禁止清單（§99），已在元件層面避開

純黑背景、neon cyan outline、大面積 purple gradient text、每張卡片不同顏色、
8px radius、heavy border、excessive shadow、完全透明看不清字的玻璃、
Bootstrap table（改用 `DataList`）、material filled card、pie chart / gauge（`StatTile` 只留 sparkline 插槽）、
ChatGPT 左右 bubble（本 package 不提供任何 chat bubble 元件）。

---

## 3. 前置條件

Host app（`apps/web/src/app/globals.css`）需要：

```css
@import '@ai-coach/design-tokens/tokens.css';
@import '@ai-coach/design-tokens/aurora.css';
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`tailwind.config.ts`：

```ts
import { aiCoachPreset } from '@ai-coach/design-tokens/tailwind-preset';

export default {
  presets: [aiCoachPreset],
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}', // ← 必須包含，否則 UI kit 的 class 會被 purge
  ],
};
```

`EmptyState` 的 dot matrix 背景直接使用 `aurora.css` 的 `.dot-matrix`，
`GlassShell` 假設背景層由 host 的 `.aurora-canvas` 提供。

---

## 4. 動效

本 package **不依賴 framer-motion**，只導出純物件 preset（`components/motion.tsx`），
也不含任何 `@keyframes`（唯一動畫是 Tailwind 內建的 `animate-pulse`、`animate-spin`，
並且都帶 `motion-reduce:animate-none`）。

```tsx
import { motion } from 'framer-motion';
import { cardEnter, respectsReducedMotion, useReducedMotion } from '@ai-coach/ui';

const reduced = useReducedMotion();
<motion.div {...respectsReducedMotion(cardEnter, reduced)} />;
```

Modal / Popover 的進場動效同樣交給 app 層包一層 motion 元件。

---

## 5. Accessibility（§47）

- 每個互動元件都套 `focusRing` / `focusRingTight`（accent-blue 低透明度 ring，非 neon）。
- 所有尺寸的命中區 ≥ 32px（`Button` sm = h-8、`IconButton` sm = 32px、menu item `min-h-8`）。
- `IconButton.label` 是**必填**，icon-only 控件一定有 `aria-label`。
- 狀態不只靠顏色：`StepProgress`、`StatTile`、`GradientPill` 都附 `sr-only` 文字或方向箭頭。
- ARIA：dialog / tabs / progressbar / listbox 由 Radix 提供；
  `DataList` 自行輸出 `role="table" / row / columnheader / cell`（視覺上沒有表格線）。
- `prefers-reduced-motion` 由 `motion-reduce:` variant 與 `respectsReducedMotion()` 雙重處理。

---

## 6. 匯出清單

**Layout / surface**
`GlassShell`、`GlassCard`（`card` / `strong` / `floating`、`bleed` 可浮出容器 §14.1）、
`glassSurface`、`SectionHeader`

**Controls**
`Button`（`primary` / `glass` / `ghost` / `danger`、`loading`）、`IconButton`、
`Input`、`Textarea`、
`Select` + `SelectTrigger` / `SelectContent` / `SelectItem` / `SelectGroup` / `SelectLabel` / `SelectValue` / `SelectSeparator` / `SelectScrollUpButton` / `SelectScrollDownButton`、
`Switch`、`Slider`（§35 人格滑桿：4px track、gradient range、數值顯示）、
`Tabs` / `TabsList` / `TabsTrigger` / `TabsContent`（pill 型、無底線）

**Overlays**
`Modal` / `ModalTrigger` / `ModalContent` / `ModalOverlay` / `ModalHeader` / `ModalTitle` / `ModalDescription` / `ModalBody` / `ModalFooter` / `ModalClose` / `ModalPortal`（§83）、
`Tooltip` / `TooltipProvider` / `TooltipRoot` / `TooltipTrigger` / `TooltipContent`、
`DropdownMenu`（含 `CheckboxItem` / `RadioItem` / `Sub*` / `Shortcut`）、
`Popover` / `PopoverTrigger` / `PopoverContent` / `PopoverAnchor` / `PopoverClose`、
`ToastProvider` / `ToastViewport` / `ToastItem` / `ToastAction` / `useToast`（§82，tone `info` / `success` / `warning` / `danger`）、
`CommandPalette` / `useCommandPaletteHotkey`（§79，無業務語意）

**Data display**
`GradientPill`（§86，小面積漸層）、`AiSparkle`（§86）、
`Progress` / `StepProgress`（§29 文件處理、§17 wizard）、
`Avatar`（radius-avatar，預設非圓形）/ `PersonaAvatar`（柔和光暈 + speaking）、
`ScrollArea` / `ScrollBar`（§84）、
`Skeleton` / `SkeletonText` / `SkeletonCard`（§44）、
`EmptyState`（§45，dot matrix 背景）、
`StatTile`（§13.3 KPI，無 pie / gauge）、
`DataList` / `DataRow`（§99 的 Bootstrap table 替代品）

**Utils / motion**
`cn`、`focusRing`、`focusRingTight`、`focusRingWithin`、`minHitTarget`、
`cardEnter`、`floatIn`、`hoverLift`、`speakingPulse`、`staggerChildren`、`motionPresets`、
`respectsReducedMotion`、`prefersReducedMotion`、`useReducedMotion`、`EASE_OUT_SOFT`

---

## 7. Light / Dark

元件不寫任何 light/dark 分支，顏色全部走 token，主題切換由 `[data-theme]` 驅動（§6）。
唯一的 `dark:` 例外是 Modal 的 backdrop（§83 要求 dark 時 backdrop 更深）。
Dark mode 是深海軍藍紫玻璃，不是 AMOLED 純黑（§5 / §98）。
