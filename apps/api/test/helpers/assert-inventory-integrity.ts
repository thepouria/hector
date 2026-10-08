import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Fail the calling e2e suite/process if warehouse / inventory / valuation
 * integrity reports hard violations. Read-only scripts; no rebuild.
 *
 * Prefer calling from afterAll of inventory-mutating suites and once after
 * the full e2e run (see package.json test:e2e).
 */
export function assertInventoryIntegrity(label = 'inventory integrity'): void {
  const repoRoot = resolve(__dirname, '../../../..');
  const scripts = [
    'warehouse-integrity-check.ts',
    'inventory-integrity-check.ts',
    'valuation-integrity-check.ts',
  ] as const;

  for (const script of scripts) {
    try {
      execFileSync(
        'pnpm',
        ['--filter', '@hector/database', 'exec', 'tsx', `scripts/${script}`],
        {
          cwd: repoRoot,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        },
      );
    } catch (error) {
      const err = error as { stdout?: Buffer; stderr?: Buffer; message?: string };
      const stdout = err.stdout?.toString('utf8') ?? '';
      const stderr = err.stderr?.toString('utf8') ?? '';
      throw new Error(
        `${label}: ${script} failed.\n${stdout}\n${stderr}\n${err.message ?? ''}`.trim(),
      );
    }
  }
}
