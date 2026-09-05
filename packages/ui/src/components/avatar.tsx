/**
 * Avatar / PersonaAvatar — spec §9 Radius（Avatar 10–16px，**預設不是圓形**）、
 * §43 Live Speaking（avatar 柔和光暈 + tiny pulse，不整張卡閃爍）、§98 dark mode 柔和陰影。
 *
 * `Avatar`        通用頭像：squircle（radius-avatar）為預設，可選 circle。
 * `PersonaAvatar` 在頭像外加一圈 accent 光暈 ring，用於 AI 模擬人物；
 *                 `speaking` 時只有光暈做呼吸，不動到卡片本體（§43）。
 *
 * 這裡不含任何 persona 的業務欄位，只有 src / name / size / state。
 */
import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';

import { cn } from '../lib/cn';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const avatarSizeClass: Record<AvatarSize, string> = {
  xs: 'size-6 text-tiny',
  sm: 'size-8 text-meta',
  md: 'size-10 text-body-sm',
  lg: 'size-14 text-body',
  xl: 'size-[72px] text-section',
};

/** §9：Avatar radius 10–16px。xs 用 10px，其餘用 --radius-avatar(14px)。 */
const avatarRadiusClass: Record<AvatarSize, string> = {
  xs: 'rounded-[10px]',
  sm: 'rounded-avatar',
  md: 'rounded-avatar',
  lg: 'rounded-avatar',
  xl: 'rounded-avatar',
};

/** 從名字取 1–2 個字元的縮寫（純字串處理，無業務語意）。 */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
  const a = first.charAt(0);
  const b = last.charAt(0);
  return (a + b).toUpperCase();
}

export interface AvatarProps
  extends Omit<React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>, 'children'> {
  src?: string;
  /** 圖片替代文字。留空表示純裝飾（旁邊已有名字）。 */
  alt?: string;
  /** 用來產生 fallback 縮寫。 */
  name?: string;
  /**
   * 具名尺寸，或直接給像素數（呼叫端常常只想指定 40 / 56）。
   * 給數字時走 inline style，仍保留 squircle radius。
   */
  size?: AvatarSize | number;
  /** §9 預設 squircle；只有真的需要時才用 circle。 */
  shape?: 'squircle' | 'circle';
  /** 自訂 fallback 內容（icon 等）。 */
  fallback?: React.ReactNode;
  imageClassName?: string;
}

export const Avatar = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Root>, AvatarProps>(
  function Avatar(
    { src, alt, name, size = 'md', shape = 'squircle', fallback, imageClassName, className, style, ...props },
    ref,
  ) {
    // 數字尺寸走 inline style；具名尺寸走 token class。
    const numeric = typeof size === 'number';
    const namedSize: AvatarSize = numeric ? 'md' : size;
    const radius = shape === 'circle' ? 'rounded-pill' : avatarRadiusClass[namedSize];

    return (
      <AvatarPrimitive.Root
        ref={ref}
        style={numeric ? { width: size, height: size, ...style } : style}
        className={cn(
          'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden',
          'border border-border-glass bg-glass-strong',
          numeric ? undefined : avatarSizeClass[namedSize],
          radius,
          className,
        )}
        {...props}
      >
        {src != null ? (
          <AvatarPrimitive.Image
            src={src}
            alt={alt ?? ''}
            className={cn('size-full object-cover', imageClassName)}
          />
        ) : null}
        <AvatarPrimitive.Fallback
          delayMs={src != null ? 200 : 0}
          className="flex size-full items-center justify-center font-semibold text-text-secondary"
        >
          {fallback ?? (name != null ? initialsFromName(name) : null)}
        </AvatarPrimitive.Fallback>
      </AvatarPrimitive.Root>
    );
  },
);

export interface PersonaAvatarProps extends AvatarProps {
  /** §43 Live Speaking：光暈做 tiny pulse。遵守 prefers-reduced-motion。 */
  speaking?: boolean;
  /** 光暈色調。預設 indigo；一般不要每個 persona 換色（§99）。 */
  glow?: 'indigo' | 'mint' | 'none';
  /** 右下角狀態點（在線 / 靜音…）。搭配 statusLabel 才不會只靠顏色（§47）。 */
  status?: React.ReactNode;
  statusLabel?: string;
  wrapperClassName?: string;
}

/* A glow is emission, not a cast shadow: it sits around the avatar, not 18px below it. */
const glowClass: Record<'indigo' | 'mint', string> = {
  indigo:
    '[box-shadow:0_0_0_5px_color-mix(in_srgb,var(--accent-indigo)_12%,transparent),0_6px_24px_-2px_color-mix(in_srgb,var(--accent-indigo)_22%,transparent)]',
  mint: '[box-shadow:0_0_0_5px_color-mix(in_srgb,var(--accent-mint)_12%,transparent),0_6px_24px_-2px_color-mix(in_srgb,var(--accent-mint)_22%,transparent)]',
};

export const PersonaAvatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  PersonaAvatarProps
>(function PersonaAvatar(
  { speaking = false, glow = 'indigo', status, statusLabel, wrapperClassName, className, size = 'lg', ...props },
  ref,
) {
  return (
    <span
      data-speaking={speaking ? '' : undefined}
      className={cn('relative inline-flex', wrapperClassName)}
    >
      {glow !== 'none' ? (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute -inset-1 rounded-avatar',
            glowClass[glow],
            speaking && 'animate-pulse motion-reduce:animate-none',
          )}
        />
      ) : null}
      <Avatar ref={ref} size={size} className={cn('relative', className)} {...props} />
      {status != null ? (
        <span className="absolute -bottom-0.5 -right-0.5 inline-flex items-center">
          {status}
          {statusLabel != null ? <span className="sr-only">{statusLabel}</span> : null}
        </span>
      ) : null}
    </span>
  );
});
