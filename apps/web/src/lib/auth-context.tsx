'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Role, User, Workspace } from '@ai-coach/shared';
import { MOCK_CURRENT_USER, MOCK_WORKSPACES } from '@/lib/fixtures/identity';
import { permissionsForRoles, type Permission } from '@/lib/rbac';
import { useTheme, type ThemeMode } from '@/components/theme/theme-provider';

export interface AuthState {
  user: User | null;
  workspace: Workspace | null;
  workspaces: Workspace[];
  /** The authorised role the user chose as their current work context. */
  activeRole: Role | null;
  permissions: Set<Permission>;
  isLoading: boolean;
  /** True when the session is a demo/mock session rather than a real API session. */
  isMock: boolean;
}

interface AuthContextValue extends AuthState {
  can: (permission: Permission) => boolean;
  hasRole: (role: Role) => boolean;
  selectWorkspace: (workspaceId: string) => void;
  /** Switches UI context only; it never grants a role the session does not hold. */
  selectRole: (role: Role) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * ───────────────────────────── MOCK SESSION ─────────────────────────────
 * The signed-in user is currently read from a local fixture so every page can
 * be built and reviewed before `POST /api/auth/login` + `GET /api/auth/me`
 * exist. Replace the body of `useSessionSource()` with a TanStack Query call to
 * `endpoints.me()` / `endpoints.workspaces()` — nothing else in the app needs
 * to change, because everything reads `useAuth()` / `useCan()`.
 *
 * The role can be overridden in the browser with
 *   localStorage['ai-coach:mock-role'] = 'trainee' | 'coach' | 'manager' | 'admin' | 'reviewer'
 * which makes the RBAC-filtered navigation and the admin-only pages reviewable
 * without a backend. This is demo scaffolding, not an auth mechanism.
 * ─────────────────────────────────────────────────────────────────────────
 */
const MOCK_ROLE_KEY = 'ai-coach:mock-role';
const MOCK_WORKSPACE_KEY = 'ai-coach:mock-workspace';
const ACTIVE_ROLE_KEY = 'ai-coach:active-role';

const VALID_ROLES: readonly Role[] = ['trainee', 'coach', 'manager', 'admin', 'reviewer'];

function readMockRole(): Role | undefined {
  try {
    const raw = window.localStorage.getItem(MOCK_ROLE_KEY);
    return VALID_ROLES.find((role) => role === raw);
  } catch {
    return undefined;
  }
}

function useSessionSource(): AuthState & {
  setWorkspaceId: (id: string) => void;
  setActiveRole: (role: Role) => void;
  clear: () => void;
} {
  const [user, setUser] = useState<User | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string>(MOCK_WORKSPACES[0]?.id ?? '');
  const [activeRole, setActiveRole] = useState<Role | null>(null);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    // MOCK: resolve immediately from the fixture. Swap for `endpoints.me()`.
    const overrideRole = readMockRole();
    const resolvedUser =
      overrideRole
        ? { ...MOCK_CURRENT_USER, roles: [overrideRole] }
        : MOCK_CURRENT_USER;
    setUser(resolvedUser);
    try {
      const stored = window.localStorage.getItem(MOCK_WORKSPACE_KEY);
      if (stored && MOCK_WORKSPACES.some((w) => w.id === stored)) setWorkspaceId(stored);
      const storedRole = window.localStorage.getItem(ACTIVE_ROLE_KEY);
      if (VALID_ROLES.includes(storedRole as Role) && resolvedUser.roles.includes(storedRole as Role)) {
        setActiveRole(storedRole as Role);
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  const workspace = useMemo(
    () => MOCK_WORKSPACES.find((w) => w.id === workspaceId) ?? MOCK_WORKSPACES[0] ?? null,
    [workspaceId],
  );

  const permissions = useMemo(
    () => permissionsForRoles(activeRole ? [activeRole] : []),
    [activeRole],
  );

  return {
    user,
    workspace,
    workspaces: MOCK_WORKSPACES,
    activeRole,
    permissions,
    isLoading,
    isMock: true,
    setWorkspaceId: (id: string) => {
      setWorkspaceId(id);
      setActiveRole(null);
      try {
        window.localStorage.setItem(MOCK_WORKSPACE_KEY, id);
        window.localStorage.removeItem(ACTIVE_ROLE_KEY);
      } catch {
        /* ignore */
      }
    },
    setActiveRole: (role: Role) => {
      if (!user?.roles.includes(role)) return;
      setActiveRole(role);
      try {
        window.localStorage.setItem(ACTIVE_ROLE_KEY, role);
      } catch {
        /* ignore */
      }
    },
    clear: () => {
      setUser(null);
      setActiveRole(null);
      try {
        window.localStorage.removeItem(ACTIVE_ROLE_KEY);
      } catch {
        /* ignore */
      }
    },
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const source = useSessionSource();
  const { user, permissions } = source;

  const can = useCallback(
    (permission: Permission) => permissions.has(permission),
    [permissions],
  );

  const hasRole = useCallback(
    (role: Role) => Boolean(user?.roles.includes(role)),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user: source.user,
      workspace: source.workspace,
      workspaces: source.workspaces,
      activeRole: source.activeRole,
      permissions,
      isLoading: source.isLoading,
      isMock: source.isMock,
      can,
      hasRole,
      selectWorkspace: source.setWorkspaceId,
      selectRole: source.setActiveRole,
      signOut: source.clear,
    }),
    [source, permissions, can, hasRole],
  );

  const themePreference = (user as (User & { theme_preference?: ThemeMode }) | null)
    ?.theme_preference;

  return (
    <AuthContext.Provider value={value}>
      <ThemeProfileSync preference={themePreference} />
      {children}
    </AuthContext.Provider>
  );
}

/**
 * §6 resolution order step 1: the profile preference outranks localStorage.
 * ThemeProvider sits *above* AuthProvider in the tree (§91), so the preference is
 * pushed upward here rather than read downward.
 */
function ThemeProfileSync({ preference }: { preference?: ThemeMode }) {
  const { applyProfilePreference } = useTheme();

  useEffect(() => {
    applyProfilePreference(preference);
  }, [applyProfilePreference, preference]);

  return null;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * RBAC-gated UI. Returns `false` while the session is still loading so we never
 * flash an affordance the user is not allowed to see.
 */
export function useCan(permission: Permission): boolean {
  const { can, isLoading } = useAuth();
  return !isLoading && can(permission);
}

/** Declarative variant for blocks of markup. */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useCan(permission) ? <>{children}</> : <>{fallback}</>;
}
