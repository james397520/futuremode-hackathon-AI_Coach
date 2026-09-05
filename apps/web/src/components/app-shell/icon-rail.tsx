'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronsLeft, HelpCircle, LogOut, PanelLeftOpen } from 'lucide-react';
import Image from 'next/image';
import { Avatar, Tooltip } from '@/components/ui';
import { RuntimeBadge } from '@/components/runtime';
import { useAuth } from '@/lib/auth-context';
import { ROLE_LABEL } from '@/lib/rbac';
import { cn, initials } from '@/lib/utils';
import { NAV_ITEMS, ROLE_NAV_IDS, isNavItemActive } from './nav';

const RAIL_PIN_KEY = 'ai-coach:rail-pinned';

/**
 * Compact workspace sidebar. It rests at 248px on large screens, can still be
 * collapsed by the user, becomes icon-only on tablets and a bottom strip on
 * mobile.
 *
 * Items are filtered by RBAC (§9) — a role that cannot use a section does not
 * see a disabled icon, it sees nothing.
 */
export function IconRail() {
  const pathname = usePathname();
  const { user, activeRole, can, signOut } = useAuth();
  const [pinned, setPinned] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const navLabelId = useId();
  const railRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(RAIL_PIN_KEY);
      setPinned(stored == null ? true : stored === '1');
    } catch {
      /* ignore */
    }
  }, []);

  const togglePin = useCallback(() => {
    setPinned((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(RAIL_PIN_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const expanded = pinned || hovered || focusWithin;
  const visibleIds = activeRole ? ROLE_NAV_IDS[activeRole] : [];
  const items = NAV_ITEMS.filter((item) => visibleIds.includes(item.id) && can(item.permission));

  return (
    <nav
      ref={railRef}
      aria-labelledby={navLabelId}
      data-expanded={expanded}
      className={cn(
        'workspace-sidebar relative z-20 flex shrink-0 flex-col gap-2 border-r border-border-soft bg-[var(--sidebar-background)] px-2.5 py-3',
        'transition-[width] duration-200 ease-out-soft',
        expanded ? 'w-rail-expanded' : 'w-rail',
        // < 768px the rail becomes a bottom-anchored icon strip (§46).
        'max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:h-16 max-md:w-full',
        'max-md:flex-row max-md:items-center max-md:justify-around max-md:overflow-x-auto',
        // Card glass + blur, not the strong fill: the strip overlays scrolling
        // content and must still read as part of the shell.
        'max-md:border-r-0 max-md:border-t max-md:bg-glass-card max-md:backdrop-blur-card max-md:py-2',
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false);
      }}
    >
      <h2 id={navLabelId} className="sr-only-live">
        主要導覽
      </h2>

      {/* Logo / pin toggle — §11 "click logo → expand". */}
      <div className="flex h-10 items-center gap-2 px-1 pb-1 max-md:hidden">
        <button
          type="button"
          onClick={togglePin}
          aria-pressed={pinned}
          aria-label={pinned ? '取消固定側邊導覽' : '固定展開側邊導覽'}
          // No drop shadow: --shadow-soft is an 18/50px card shadow and under a
          // 32px mark on the shell glass it read as a smudge.
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] transition-shadow duration-150 ease-out-soft hover:shadow-soft"
        >
          <Image src="/brand/logo-mark.png" alt="" width={28} height={28} priority aria-hidden />
        </button>
        {expanded ? (
          <div className="rail-expanded-only min-w-0 flex-1">
            <p className="truncate text-body-sm font-semibold tracking-[-0.01em]">AI Coach</p>
            <p className="truncate text-tiny text-text-tertiary">企業訓練工作區</p>
          </div>
        ) : null}
        {expanded ? (
          <span className="rail-expanded-only text-text-tertiary" aria-hidden>
            {pinned ? <ChevronsLeft size={16} strokeWidth={1.7} /> : <PanelLeftOpen size={16} strokeWidth={1.7} />}
          </span>
        ) : null}
      </div>

      {expanded ? <p className="rail-expanded-only meta-label px-2 pb-1 pt-2 max-md:hidden">工作區</p> : null}

      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto scroll-area max-md:flex-row max-md:items-center max-md:gap-1 max-md:overflow-x-auto">
        {items.map((item) => {
          const active = isNavItemActive(item, pathname);
          const link = (
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              data-active={active}
              className={cn('rail-item relative w-full', expanded ? 'justify-start' : 'justify-center')}
            >
              {active ? <span className="rail-indicator max-md:hidden" aria-hidden /> : null}
              <item.icon size={17} strokeWidth={1.6} aria-hidden className="shrink-0" />
              {expanded ? (
                <span className="rail-expanded-only truncate text-body-sm font-medium">{item.label}</span>
              ) : (
                <span className="sr-only-live">{item.label}</span>
              )}
            </Link>
          );

          return (
            <li key={item.id} className="max-md:shrink-0">
              {expanded ? link : <Tooltip content={item.label} side="right">{link}</Tooltip>}
            </li>
          );
        })}
      </ul>

      {/* Footer — runtime badge, theme, help, user (§11 bottom / §93). */}
      <div className="mt-auto flex flex-col gap-1.5 border-t border-border-soft pt-3 max-md:hidden">
        {expanded ? (
          <div className="rail-expanded-only px-1">
            <RuntimeBadge />
          </div>
        ) : (
          <RuntimeBadge variant="compact" />
        )}

        {/* The appearance switcher lives in Settings > Appearance, not here. In a
            64px rail it had nowhere to go: the three-option control could not
            shrink and clipped its last option. */}

        {expanded ? (
          <Link href="/settings" className="rail-item justify-start">
            <HelpCircle size={18} strokeWidth={1.6} aria-hidden />
            <span className="rail-expanded-only text-body-sm">說明與快速鍵</span>
          </Link>
        ) : (
          <Tooltip content="說明與快速鍵（⌘/）" side="right">
            <Link href="/settings" className="rail-item justify-center" aria-label="說明與快速鍵">
              <HelpCircle size={18} strokeWidth={1.6} aria-hidden />
            </Link>
          </Tooltip>
        )}

        <UserMenu expanded={expanded} name={user?.display_name ?? '未登入'} roleLabel={user ? user.roles.map((role) => ROLE_LABEL[role]).join(' · ') : ''} onSignOut={signOut} />
      </div>
    </nav>
  );
}

function UserMenu({
  expanded,
  name,
  roleLabel,
  onSignOut,
}: {
  expanded: boolean;
  name: string;
  roleLabel: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={cn('rail-item w-full', expanded ? 'justify-start' : 'justify-center')}
      >
        <Avatar name={name} size="sm" />
        {expanded ? (
          <span className="rail-expanded-only min-w-0 flex-1 text-left">
            <span className="block truncate text-body-sm font-medium">{name}</span>
            <span className="block truncate text-tiny text-text-tertiary">{roleLabel}</span>
          </span>
        ) : (
          <span className="sr-only-live">{`${name} 的帳號選單`}</span>
        )}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="帳號"
          className="glass-card absolute bottom-full left-0 z-30 mb-2 w-56 p-2 shadow-floating animate-card-enter"
        >
          <div className="px-2 pb-2">
            <p className="truncate text-body-sm font-semibold">{name}</p>
            <p className="truncate text-tiny text-text-tertiary">{roleLabel || '尚未指定身份'}</p>
          </div>
          <Link role="menuitem" href="/settings/profile" className="rail-item w-full justify-start px-2 text-body-sm">
            個人資料與偏好設定
          </Link>
          <Link role="menuitem" href="/workspace-select" className="rail-item w-full justify-start px-2 text-body-sm">
            切換工作區
          </Link>
          <Link role="menuitem" href="/role-select" className="rail-item w-full justify-start px-2 text-body-sm">
            切換身份
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={onSignOut}
            // `text-state-danger` measured 2.65:1 on the card glass in light.
            className="rail-item ink-danger w-full justify-start px-2 text-body-sm"
          >
            <LogOut size={16} strokeWidth={1.7} aria-hidden />
            登出
          </button>
        </div>
      ) : null}
    </div>
  );
}
