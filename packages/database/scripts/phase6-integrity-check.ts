/**
 * Aggregate Phase 6 integrity runner (read-only).
 *
 * Runs settlement + reconciliation integrity scripts sequentially.
 * Exit non-zero if any hard violations.
 *
 * Usage: pnpm phase6:integrity
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const scripts = [
  'scripts/settlement-integrity-check.ts',
  'scripts/reconciliation-integrity-check.ts',
];

let failed = false;
for (const script of scripts) {
  console.log(`\n=== Running ${script} ===`);
  const result = spawnSync('pnpm', ['exec', 'tsx', script], {
    cwd: resolve(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) failed = true;
}

if (failed) {
  console.error('\nPhase 6 integrity: FAILED');
  process.exit(1);
}
console.log('\nPhase 6 integrity: OK (0 hard violations across settlement + reconciliation)');
process.exit(0);
