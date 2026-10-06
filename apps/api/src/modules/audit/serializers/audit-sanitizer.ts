import type { AuditSnapshot, JsonValue } from '../types/audit.types';

const SENSITIVE_KEY_EXACT = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'refreshtokenhash',
  'refresh_token_hash',
  'authorization',
  'cookie',
  'cookies',
  'set-cookie',
  'secret',
  'apikey',
  'api_key',
  'jwt',
  'jwtscret',
  'jwt_access_secret',
  'database_url',
  'databaseurl',
]);

/**
 * Final safety layer for audit snapshots.
 * Business services should still construct explicit safe snapshots.
 */
export function sanitizeAuditValue(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(item));
  }

  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        result[key] = '[REDACTED]';
        continue;
      }
      result[key] = sanitizeAuditValue(nested);
    }
    return result;
  }

  return String(value);
}

export function sanitizeAuditSnapshot(snapshot: unknown): AuditSnapshot {
  if (snapshot === null || snapshot === undefined) {
    return null;
  }

  const sanitized = sanitizeAuditValue(snapshot);
  if (sanitized === null || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
    return { value: sanitized };
  }

  return sanitized as Record<string, JsonValue>;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-]/g, '');
  if (SENSITIVE_KEY_EXACT.has(normalized) || SENSITIVE_KEY_EXACT.has(key.toLowerCase())) {
    return true;
  }

  // Conservative secret patterns without matching innocuous keys like tokenCount.
  if (/(^|_)(password|secret|apikey)(_|$)/i.test(key)) {
    return true;
  }
  if (/^(access|refresh)?token$/i.test(key)) {
    return true;
  }
  if (/tokenhash$/i.test(normalized)) {
    return true;
  }

  return false;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(sanitizeAuditValue(value)));
}

export function auditSnapshotsEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a ?? null) === stableStringify(b ?? null);
}

function sortDeep(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => sortDeep(item));
  }
  if (value && typeof value === 'object') {
    const sorted: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortDeep(value[key]!);
    }
    return sorted;
  }
  return value;
}
