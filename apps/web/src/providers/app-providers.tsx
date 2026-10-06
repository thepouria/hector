'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import {
  fetchCurrentUser,
  loginRequest,
  logoutRequest,
  refreshSession,
} from '@/lib/api/auth';
import { fetchAuthorization, fetchCompanies } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { persistCompanyId, readPersistedCompanyId } from '@/lib/auth/company-persistence';
import { tokenStore } from '@/lib/auth/token-store';
import { can, canAll, canAny } from '@/lib/permissions/can';
import type { PermissionKey } from '@/lib/permissions/keys';
import { ROUTES } from '@/lib/utils/routes';
import type { AuthorizationSnapshot, Company, User } from '@/types/api';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

type SessionContextValue = {
  status: AuthStatus;
  user: User | null;
  companies: Company[];
  activeCompany: Company | null;
  permissions: string[];
  roles: AuthorizationSnapshot['roles'];
  companyMemberId: string | null;
  bootstrapError: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchCompany: (companyId: string) => Promise<void>;
  refreshPermissions: () => Promise<void>;
  refreshAuthorizationContext: () => Promise<void>;
  reloadCompanies: () => Promise<void>;
  can: (permission: PermissionKey | string) => boolean;
  canAny: (permissions: readonly (PermissionKey | string)[]) => boolean;
  canAll: (permissions: readonly (PermissionKey | string)[]) => boolean;
  handleUnauthorized: () => void;
};

const SessionContext = React.createContext<SessionContextValue | null>(null);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => {
          if (isApiClientError(error) && (error.status === 401 || error.status === 403)) {
            return false;
          }
          return failureCount < 1;
        },
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>{children}</SessionProvider>
      <Toaster richColors position="top-center" dir="rtl" />
    </QueryClientProvider>
  );
}

function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<AuthStatus>('loading');
  const [user, setUser] = React.useState<User | null>(null);
  const [companies, setCompanies] = React.useState<Company[]>([]);
  const [activeCompany, setActiveCompany] = React.useState<Company | null>(null);
  const [permissions, setPermissions] = React.useState<string[]>([]);
  const [roles, setRoles] = React.useState<AuthorizationSnapshot['roles']>([]);
  const [companyMemberId, setCompanyMemberId] = React.useState<string | null>(null);
  const [bootstrapError, setBootstrapError] = React.useState<string | null>(null);

  const resetCompanyState = React.useCallback(() => {
    setActiveCompany(null);
    setPermissions([]);
    setRoles([]);
    setCompanyMemberId(null);
    persistCompanyId(null);
  }, []);

  const handleUnauthorized = React.useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setCompanies([]);
    resetCompanyState();
    setStatus('unauthenticated');
    queryClient.clear();
    if (!pathname.startsWith(ROUTES.login)) {
      router.replace(ROUTES.login);
    }
  }, [pathname, queryClient, resetCompanyState, router]);

  const loadAuthorization = React.useCallback(async (companyId: string) => {
    const auth = await fetchAuthorization(companyId);
    setPermissions(auth.permissions);
    setRoles(auth.roles);
    setCompanyMemberId(auth.companyMemberId);
  }, []);

  const resolveActiveCompany = React.useCallback(
    async (list: Company[]) => {
      if (list.length === 0) {
        resetCompanyState();
        return;
      }

      const persisted = readPersistedCompanyId();
      const selected =
        list.find((company) => company.id === persisted) ?? (list.length === 1 ? list[0] : null);

      if (!selected) {
        setActiveCompany(null);
        setPermissions([]);
        setRoles([]);
        setCompanyMemberId(null);
        return;
      }

      setActiveCompany(selected);
      persistCompanyId(selected.id);
      await loadAuthorization(selected.id);
    },
    [loadAuthorization, resetCompanyState],
  );

  const bootstrap = React.useCallback(async () => {
    setBootstrapError(null);
    setStatus('loading');
    try {
      const token = tokenStore.get() ?? (await refreshSession());
      if (!token) {
        setStatus('unauthenticated');
        setUser(null);
        setCompanies([]);
        resetCompanyState();
        return;
      }

      const currentUser = await fetchCurrentUser();
      const companyList = await fetchCompanies();
      setUser(currentUser);
      setCompanies(companyList);
      await resolveActiveCompany(companyList);
      setStatus('authenticated');
    } catch (error) {
      if (isApiClientError(error) && error.status === 401) {
        handleUnauthorized();
        return;
      }
      setBootstrapError(
        isApiClientError(error) ? error.message : 'بارگذاری نشست با خطا مواجه شد.',
      );
      setStatus(tokenStore.get() ? 'authenticated' : 'unauthenticated');
    }
  }, [handleUnauthorized, resetCompanyState, resolveActiveCompany]);

  React.useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const login = React.useCallback(
    async (email: string, password: string) => {
      const result = await loginRequest(email, password);
      setUser(result.user);
      const companyList = await fetchCompanies();
      setCompanies(companyList);
      await resolveActiveCompany(companyList);
      setStatus('authenticated');
      setBootstrapError(null);
      router.replace(ROUTES.dashboard);
    },
    [resolveActiveCompany, router],
  );

  const logout = React.useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      setUser(null);
      setCompanies([]);
      resetCompanyState();
      setStatus('unauthenticated');
      queryClient.clear();
      router.replace(ROUTES.login);
    }
  }, [queryClient, resetCompanyState, router]);

  const switchCompany = React.useCallback(
    async (companyId: string) => {
      const company = companies.find((item) => item.id === companyId);
      if (!company) {
        return;
      }
      setActiveCompany(company);
      persistCompanyId(company.id);
      await loadAuthorization(company.id);
      await queryClient.cancelQueries();
      queryClient.removeQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key.length > 1 && typeof key[1] === 'string';
        },
      });
    },
    [companies, loadAuthorization, queryClient],
  );

  const refreshPermissions = React.useCallback(async () => {
    if (!activeCompany) return;
    await loadAuthorization(activeCompany.id);
  }, [activeCompany, loadAuthorization]);

  const refreshAuthorizationContext = React.useCallback(async () => {
    const companyList = await fetchCompanies();
    setCompanies(companyList);
    const currentId = activeCompany?.id;
    const stillMember = currentId
      ? companyList.find((company) => company.id === currentId)
      : null;

    if (!stillMember) {
      await resolveActiveCompany(companyList);
      return;
    }

    setActiveCompany(stillMember);
    persistCompanyId(stillMember.id);
    await loadAuthorization(stillMember.id);
  }, [activeCompany?.id, loadAuthorization, resolveActiveCompany]);

  const reloadCompanies = React.useCallback(async () => {
    const companyList = await fetchCompanies();
    setCompanies(companyList);
    await resolveActiveCompany(companyList);
  }, [resolveActiveCompany]);

  const value = React.useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      companies,
      activeCompany,
      permissions,
      roles,
      companyMemberId,
      bootstrapError,
      login,
      logout,
      switchCompany,
      refreshPermissions,
      refreshAuthorizationContext,
      reloadCompanies,
      can: (permission) => can(permissions, permission),
      canAny: (required) => canAny(permissions, required),
      canAll: (required) => canAll(permissions, required),
      handleUnauthorized,
    }),
    [
      status,
      user,
      companies,
      activeCompany,
      permissions,
      roles,
      companyMemberId,
      bootstrapError,
      login,
      logout,
      switchCompany,
      refreshPermissions,
      refreshAuthorizationContext,
      reloadCompanies,
      handleUnauthorized,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within AppProviders');
  }
  return ctx;
}
