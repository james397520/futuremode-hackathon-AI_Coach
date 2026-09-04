'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronsLeft, HelpCircle, LogOut, PanelLeftOpen, Sparkles } from 'lucide-react';
import { Avatar, Tooltip } from '@/components/ui';
import { RuntimeBadge } from '@/components/runtime';
import { ThemeToggle } from '@/components/theme';
import { useAuth } from '@/lib/auth-context';
import { ROLE_LABEL } from '@/lib/rbac';
import { cn, initials } from '@/lib/utils';
import { NAV_ITEMS, ROLE_NAV_IDS, isNavItemActive } from './nav';

const RAIL_PIN_KEY = 'ai-coach:rail-pinned';

/**
 * §11 Sidebar — a 64px glass icon rail, expanding to 232px.
 *
 * Explicitly NOT a permanent 240px sidebar (forbidden by §99). Collapsed is the
 * default and the resting state; expansion is transient (hover / focus) unless
 * the user pins it. Labels only exist in the expanded state.
 *
 * Items are filtered by RBAC (§9) — a role that cannot use a section does not
 * see a disabled icon, it sees nothing.
 */
export function IconRail() {
  const pathname = usePathname();
  const { user, activeRole, can, signOut } = useAuth();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const navLabelId = useId();
  const railRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      setPinned(window.localStorage.getItem(RAIL_PIN_KEY) === '1');
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
        'relative z-20 flex shrink-0 flex-col gap-2 border-r border-border-soft/70 px-2.5 py-4',
        'transition-[width] duration-200 ease-out-soft',
        expanded ? 'w-rail-expanded' : 'w-rail',
        // < 768px the rail becomes a bottom-anchored icon strip (§46).
        'max-sm:absolute max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:h-16 max-sm:w-full',
        'max-sm:flex-row max-sm:items-center max-sm:justify-around max-sm:overflow-x-auto',
        'max-sm:border-r-0 max-sm:border-t max-sm:bg-glass-strong max-sm:py-2',
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
      <div className="flex items-center gap-2 px-1 pb-2 max-sm:hidden">
        <button
          type="button"
          onClick={togglePin}
          aria-pressed={pinned}
          aria-label={pinned ? 'Unpin navigation' : 'Pin navigation open'}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-avatar bg-glass-strong text-accent-indigo shadow-soft transition-transform duration-150 ease-out-soft hover:-translate-y-px"
        >
          <Sparkles size={17} strokeWidth={1.9} aria-hidden />
        </button>
        {expanded ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-body-sm font-semibold">AI Coach</p>
            <p className="truncate text-tiny text-text-tertiary">企業訓練工作區</p>
          </div>
        ) : null}
        {expanded ? (
          <span className="text-text-tertiary" aria-hidden>
            {pinned ? <ChevronsLeft size={16} strokeWidth={1.7} /> : <PanelLeftOpen size={16} strokeWidth={1.7} />}
          </span>
        ) : null}
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto scroll-area max-sm:flex-row max-sm:items-center max-sm:overflow-x-auto">
        {items.map((item) => {
          const active = isNavItemActive(item, pathname);
          const link = (
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              data-active={active}
              className={cn('rail-item relative w-full', expanded ? 'justify-start' : 'justify-center')}
            >
              {active ? <span className="rail-indicator max-sm:hidden" aria-hidden /> : null}
              <item.icon size={19} strokeWidth={1.6} aria-hidden className="shrink-0" />
              {expanded ? (
                <span className="truncate text-body-sm font-medium">{item.label}</span>
              ) : (
                <span className="sr-only-live">{item.label}</span>
              )}
            </Link>
          );

          return (
            <li key={item.id} className="max-sm:shrink-0">
              {expanded ? link : <Tooltip content={item.label} side="right">{link}</Tooltip>}
            </li>
          );
        })}
      </ul>

      {/* Footer — runtime badge, theme, help, user (§11 bottom / §93). */}
      <div className="mt-auto flex flex-col gap-2 border-t border-border-soft/70 pt-3 max-sm:hidden">
        {expanded ? (
          <div className="px-1">
            <RuntimeBadge />
          </div>
        ) : (
          <RuntimeBadge variant="compact" />
        )}

        {expanded ? <ThemeToggle className="px-1" /> : <ThemeToggle variant="compact" />}

        {expanded ? (
          <Link href="/settings" className="rail-item justify-start">
            <HelpCircle size={18} strokeWidth={1.6} aria-hidden />
            <span className="text-body-sm">說明與快速鍵</span>
          </Link>
        ) : (
          <Tooltip content="說明與快速鍵（⌘/）" side="right">
            <Link href="/settings" className="rail-item justify-center" aria-label="說明與快速鍵">
              <HelpCircle size={18} strokeWidth={1.6} aria-hidden />
            </Link>
          </Tooltip>
        )}

        <UserMenu expanded={expanded} name={user?.display_name ?? 'Signed out'} roleLabel={user ? user.roles.map((role) => ROLE_LABEL[role]).join(' · ') : ''} onSignOut={signOut} />
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
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-body-sm font-medium">{name}</span>
            <span className="block truncate text-tiny text-text-tertiary">{roleLabel}</span>
          </span>
        ) : (
          <span className="sr-only-live">{`Account menu for ${name}`}</span>
        )}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="glass-card absolute bottom-full left-0 z-30 mb-2 w-56 p-2 shadow-floating animate-card-enter"
        >
          <div className="px-2 pb-2">
            <p className="truncate text-body-sm font-semibold">{name}</p>
            <p className="truncate text-tiny text-text-tertiary">{roleLabel || 'No role assigned'}</p>
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
            className="rail-item w-full justify-start px-2 text-body-sm text-state-danger"
          >
            <LogOut size={16} strokeWidth={1.7} aria-hidden />
            登出
          </button>
        </div>
      ) : null}
    </div>
  );
}
