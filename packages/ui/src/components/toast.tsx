/**
 * Toast — Radix Toast + 玻璃 skin。spec §82 Toast / §47（live region 由 Radix 提供）。
 *
 * §82：成功類使用 indigo → cyan → mint 的小面積漸層 accent bar；
 * warning 淡 amber；error 淡紅、**不用滿版紅**。
 * 因此 toast 本體固定是 strong surface 玻璃，tone 只影響左側 accent bar 與 icon。
 *
 * 用法：
 *   <ToastProvider>…app…</ToastProvider>   // 內含 viewport
 *   const { toast } = useToast();
 *   toast({ tone: 'success', title: 'Knowledge indexed successfully', sparkle: true });
 */
import * as React from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus-ring';
import { glassSurface } from './glass-card';
import { AiSparkle } from './sparkle';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastOptions {
  title: React.ReactNode;
  description?: React.ReactNode;
  tone?: ToastTone;
  /** ms；不傳則用 Provider 的預設值。0 = 不自動關閉。 */
  duration?: number;
  /** 右側動作，例如 View / Undo。請放 `<ToastAction altText="…">`。 */
  action?: React.ReactNode;
  /** §86 AI 產生的通知（transcript ready / AI insight）前面加 ✦。 */
  sparkle?: boolean;
  /** 覆寫預設 icon（§85 線性 icon）。 */
  icon?: React.ReactNode;
}

export interface ToastRecord extends ToastOptions {
  id: string;
}

export interface ToastContextValue {
  /** 推一個 toast，回傳 id。 */
  toast: (options: ToastOptions) => string;
  /** 手動關閉。 */
  dismiss: (id: string) => void;
  /** 關閉全部。 */
  dismissAll: () => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const toneAccent: Record<ToastTone, string> = {
  info: 'bg-state-info',
  success: 'bg-state-success',
  warning: 'bg-[color:var(--warning)]',
  danger: 'bg-[color:var(--danger)]',
};

/* icons are 3:1 graphics; --accent-mint on light glass was 1.7:1 → inks */
const toneIconClass: Record<ToastTone, string> = {
  info: 'text-state-info-ink',
  success: 'text-state-success-ink',
  warning: 'text-state-warning-ink',
  danger: 'text-state-danger-ink',
};

function defaultToneIcon(tone: ToastTone): React.ReactElement {
  switch (tone) {
    case 'success':
      return <CheckCircle2 aria-hidden className="size-4" />;
    case 'warning':
      return <AlertTriangle aria-hidden className="size-4" />;
    case 'danger':
      return <XCircle aria-hidden className="size-4" />;
    default:
      return <Info aria-hidden className="size-4" />;
  }
}

export const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(function ToastViewport({ className, ...props }, ref) {
  // 正常路徑是 `<ToastProvider>` 自己渲染 viewport。但把 `<ToastViewport />`
  // 單獨放進 layout 是很自然的寫法，而 Radix 的 Viewport 沒有 Provider 祖先
  // 會直接丟 `ToastViewport must be used within ToastProvider`——SSR prerender
  // 也一樣會炸。這裡用自家的 ToastContext 判斷是否在 Provider 內，
  // 不在的話就自帶一個 Radix Provider，讓元件能獨立使用。
  const insideProvider = React.useContext(ToastContext) !== null;

  const viewport = (
    <ToastPrimitive.Viewport
      ref={ref}
      className={cn(
        'fixed bottom-0 right-0 z-[60] m-0 flex w-full max-w-[26rem] list-none flex-col gap-2.5 p-safe outline-none',
        className,
      )}
      {...props}
    />
  );

  if (insideProvider) return viewport;
  return <ToastPrimitive.Provider>{viewport}</ToastPrimitive.Provider>;
});

export const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Action>
>(function ToastAction({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Action
      ref={ref}
      className={cn(
        'inline-flex h-8 shrink-0 items-center rounded-button border border-border-soft px-3',
        'text-body-sm font-medium text-text-primary',
        'transition-colors duration-[var(--dur-hover)] hover:bg-glass-card motion-reduce:transition-none',
        focusRing,
        className,
      )}
      {...props}
    />
  );
});

export interface ToastItemProps {
  record: ToastRecord;
  onDismiss: (id: string) => void;
}

export function ToastItem({ record, onDismiss }: ToastItemProps): React.ReactElement {
  const tone = record.tone ?? 'info';

  return (
    <ToastPrimitive.Root
      duration={record.duration}
      onOpenChange={(open) => {
        if (!open) onDismiss(record.id);
      }}
      className={cn(
        'relative flex items-start gap-3 overflow-hidden rounded-card p-4 pl-5 pr-10',
        'text-text-primary',
        glassSurface.overlay,
        'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]',
        'data-[swipe=cancel]:translate-x-0',
      )}
    >
      {/* §82 小面積漸層 accent bar，取代滿版彩色底 */}
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', toneAccent[tone])} />

      <span className={cn('mt-0.5 inline-flex shrink-0 items-center', toneIconClass[tone])}>
        {record.icon ?? defaultToneIcon(tone)}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <ToastPrimitive.Title className="flex items-center gap-1.5 text-card-title text-text-primary">
          {record.sparkle ? <AiSparkle size={13} /> : null}
          <span className="min-w-0">{record.title}</span>
        </ToastPrimitive.Title>
        {record.description != null ? (
          <ToastPrimitive.Description className="text-body-sm text-text-secondary">
            {record.description}
          </ToastPrimitive.Description>
        ) : null}
        {record.action != null ? <div className="mt-1.5 flex gap-2">{record.action}</div> : null}
      </div>

      <ToastPrimitive.Close
        aria-label="Dismiss notification"
        className={cn(
          'absolute right-2.5 top-2.5 inline-flex size-8 items-center justify-center rounded-button',
          'text-text-tertiary transition-colors duration-[var(--dur-hover)]',
          'hover:bg-glass-card hover:text-text-primary motion-reduce:transition-none',
          focusRing,
        )}
      >
        <X aria-hidden className="size-4" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

export interface ToastProviderProps {
  children?: React.ReactNode;
  /** 預設自動關閉時間（ms）。 */
  duration?: number;
  swipeDirection?: 'right' | 'left' | 'up' | 'down';
  /** 同時最多顯示幾則，超過時丟掉最舊的。 */
  limit?: number;
  viewportClassName?: string;
}

export function ToastProvider({
  children,
  duration = 5000,
  swipeDirection = 'right',
  limit = 4,
  viewportClassName,
}: ToastProviderProps): React.ReactElement {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  const counter = React.useRef(0);

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const dismissAll = React.useCallback(() => setToasts([]), []);

  const toast = React.useCallback(
    (options: ToastOptions) => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      setToasts((prev) => {
        const next = [...prev, { ...options, id }];
        return next.length > limit ? next.slice(next.length - limit) : next;
      });
      return id;
    },
    [limit],
  );

  const value = React.useMemo<ToastContextValue>(
    () => ({ toast, dismiss, dismissAll }),
    [toast, dismiss, dismissAll],
  );

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider duration={duration} swipeDirection={swipeDirection}>
        {children}
        {toasts.map((record) => (
          <ToastItem key={record.id} record={record} onDismiss={dismiss} />
        ))}
        <ToastViewport className={viewportClassName} />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

/** 取得 toast API。必須在 `<ToastProvider>` 之內呼叫。 */
export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (ctx === null) {
    throw new Error('useToast() must be used inside <ToastProvider>.');
  }
  return ctx;
}
