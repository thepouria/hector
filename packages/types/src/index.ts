/**
 * Shared TypeScript types for Hector.
 * Domain models will be added in later phases.
 */

export type HealthStatus = 'ok' | 'degraded' | 'error';

export interface HealthResponse {
  status: HealthStatus;
  service: string;
}
