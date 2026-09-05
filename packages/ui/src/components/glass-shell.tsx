/**
 * GlassShell — spec §10 App Shell / §3.1 Main Glass Frame。
 *
 * Desktop uses a restrained floating application frame over the lavender
 * stage. The host app owns the stage; this component owns only the shell.
 */
import * as React from 'react';

import { cn } from '../lib/cn';

export interface GlassShellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 外層 24px safe area（`var(--shell-safe-area)`）。關掉時由 host 自行控制外距。 */
  safeArea?: boolean;
  /** 撐滿 viewport 高度，做出 app-like 的固定外框。 */
  fullHeight?: boolean;
  /** 內距（Desktop 24–32px，§8）。dense 版面可關掉自行處理。 */
  padded?: boolean;
  /** 額外套在最外層 safe-area wrapper 上的 class。 */
  outerClassName?: string;
}

/**
 * 外框允許子卡片略微「浮出」邊界（§14.1 的 floating depth），
 * 因此刻意不設 `overflow-hidden`。需要裁切的區域請在內部自行包一層。
 */
export const GlassShell = React.forwardRef<HTMLDivElement, GlassShellProps>(function GlassShell(
  {
    safeArea = true,
    fullHeight = true,
    padded = true,
    outerClassName,
    className,
    children,
    ...props
  },
  ref,
) {
  return (
    <div
      className={cn(
        'flex w-full justify-center',
        safeArea && 'p-safe',
        fullHeight && 'min-h-screen',
        outerClassName,
      )}
    >
      <div
        ref={ref}
        className={cn(
          'relative flex w-full max-w-shell flex-col',
          'rounded-shell border border-border-glass bg-glass-shell',
          // rim comes from .liquid-glass::after; do not stack --shadow-inset-hi on it
          'shadow-shell',
          'text-text-primary',
          fullHeight && 'min-h-[calc(100vh_-_2_*_var(--shell-safe-area))]',
          padded && 'p-5 xl:p-6',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  );
});
