const SENSITIVE = new Set([
  'password',
  'passwordhash',
  'accesstoken',
  'refreshtoken',
  'refreshtokenhash',
  'authorization',
  'cookie',
  'cookies',
  'secret',
  'apikey',
]);

export function redactSensitive(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.toLowerCase().replace(/[-_]/g, '');
      if (SENSITIVE.has(normalized) || /tokenhash$/i.test(normalized)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactSensitive(nested);
      }
    }
    return result;
  }
  return value;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(date);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function displayName(user: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string {
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return name || user.email || '—';
}
