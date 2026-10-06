/**
 * Shared validation helpers for Hector.
 * Domain schemas will be added in later phases.
 */

export { z } from 'zod';

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
