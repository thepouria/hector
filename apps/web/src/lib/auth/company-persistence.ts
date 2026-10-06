const STORAGE_KEY = 'hector.activeCompanyId';

export function readPersistedCompanyId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function persistCompanyId(companyId: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (!companyId) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, companyId);
  } catch {
    // Ignore storage failures (private mode, etc.)
  }
}
