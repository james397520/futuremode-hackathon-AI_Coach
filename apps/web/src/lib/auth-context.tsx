'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Role, User, Workspace } from '@ai-coach/shared';
import { MOCK_CURRENT_USER, MOCK_WORKSPACES } from '@/lib/fixtures/identity';
import { permissionsForRoles, type Permission } from '@/lib/rbac';
import { API_BASE_URL, endpoints, type AuthSession } from '@/lib/api-client';

/**
 * Local-development convenience: sign in as the seeded demo trainee when the API
 * is reachable but no session exists yet. There is no sign-in screen wired to the
 * real API yet, and without this the app silently falls back to fixtures — which
 * is exactly what made the simulation replay a script instead of talking to the
 * model. These are the seed's own credentials, never a real secret; leave them
 * unset in any deployment that has a login screen.
 */
const DEV_AUTOLOGIN_EMAIL = process.env.NEXT_PUBLIC_DEV_LOGIN_EMAIL ?? '';
const DEV_AUTOLOGIN_PASSWORD = process.env.NEXT_PUBLIC_DEV_LOGIN_PASSWORD ?? '';
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

  const [apiWorkspaces, setApiWorkspaces] = useState<Workspace[] | null>(null);
  const [isReal, setIsReal] = useState(false);

  useEffect(() => {
    let cancelled = false;

    /** Adopt a real API session. Returns false when there is none to adopt. */
    async function adoptApiSession(): Promise<boolean> {
      if (!API_BASE_URL) return false;
      try {
        // `me()` succeeds only with a live cookie; a 401 here is the normal
        // "not signed in yet" path and must not surface as an error.
        const session = await endpoints.me();
        if (cancelled) return false;
        applySession(session);
        return true;
      } catch {
        // No session. In local development the demo account is seeded and there
        // is no sign-in screen wired yet, so sign in with it rather than falling
        // back to fixtures — that fallback is what made the persona replay a
        // script instead of talking to the model.
        if (!DEV_AUTOLOGIN_EMAIL) return false;
        try {
          const session = await endpoints.login(DEV_AUTOLOGIN_EMAIL, DEV_AUTOLOGIN_PASSWORD);
          if (cancelled) return false;
          applySession(session);
          return true;
        } catch {
          return false;
        }
      }
    }

    function applySession(session: AuthSession): void {
      const roles = (session.user.roles.filter((r) => VALID_ROLES.includes(r as Role)) as Role[]);
      const now = new Date().toISOString();
      setUser({
        id: session.user.id,
        tenant_id: session.user.tenant_id,
        workspace_id: session.user.workspace_id ?? '',
        email: session.user.email,
        display_name: session.user.display_name,
        roles: roles.length ? roles : (['trainee'] as Role[]),
        team_ids: session.user.team_ids,
        // The API's auth payload does not carry row timestamps; nothing in the
        // UI reads them, so they are filled rather than widening the contract.
        created_at: now,
        updated_at: now,
      });
      setApiWorkspaces(
        session.workspaces.map((w) => ({ id: w.id, name: w.name })) as unknown as Workspace[],
      );
      const target = session.user.workspace_id ?? session.workspaces[0]?.id ?? '';
      if (target) setWorkspaceId(target);
      setActiveRole(roles[0] ?? 'trainee');
      setIsReal(true);
    }

    void (async () => {
      if (await adoptApiSession()) {
        if (!cancelled) setLoading(false);
        return;
      }
      if (cancelled) return;
      // MOCK: fixtures, so every page is reviewable with no backend running.
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
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const allWorkspaces = apiWorkspaces ?? MOCK_WORKSPACES;
  const workspace = useMemo(
    () => allWorkspaces.find((w) => w.id === workspaceId) ?? allWorkspaces[0] ?? null,
    [allWorkspaces, workspaceId],
  );

  const permissions = useMemo(
    () => permissionsForRoles(activeRole ? [activeRole] : []),
    [activeRole],
  );

  return {
    user,
    workspace,
    workspaces: allWorkspaces,
    activeRole,
    permissions,
    isLoading,
    isMock: !isReal,
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
