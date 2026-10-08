/**
 * Orchestrate all production-critical integrity checkers (read-only).
 *
 * Usage (repo root):
 *   pnpm integrity:all
 *
 * Exit 0 only when every domain reports no hard violations.
 * Continues after failures so CI logs show the full matrix.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const DOMAINS: Array<{ name: string; script: string }> = [
  { name: 'Catalog', script: 'catalog-integrity-check.ts' },
  { name: 'Party', script: 'party-integrity-check.ts' },
  { name: 'Purchasing', script: 'purchasing-integrity-check.ts' },
  { name: 'Warehouse', script: 'warehouse-integrity-check.ts' },
  { name: 'Inventory', script: 'inventory-integrity-check.ts' },
  { name: 'Valuation', script: 'valuation-integrity-check.ts' },
  { name: 'Finance', script: 'finance-integrity-check.ts' },
  { name: 'Sales', script: 'sales-integrity-check.ts' },
  { name: 'Settlement', script: 'settlement-integrity-check.ts' },
  { name: 'Reconciliation', script: 'reconciliation-integrity-check.ts' },
  { name: 'Phase6', script: 'phase6-integrity-check.ts' },
];

const scriptsDir = resolve(__dirname);

function runOne(domain: string, script: string): boolean {
  console.log(`\n=== ${domain} (${script}) ===`);
  const result = spawnSync(
    'pnpm',
    ['exec', 'tsx', resolve(scriptsDir, script)],
    {
      cwd: resolve(scriptsDir, '..'),
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32',
    },
  );
  const ok = result.status === 0;
  console.log(ok ? `[PASS] ${domain}` : `[FAIL] ${domain}`);
  return ok;
}

let failed = 0;
for (const d of DOMAINS) {
  if (!runOne(d.name, d.script)) failed += 1;
}

console.log('\n=== integrity:all summary ===');
if (failed === 0) {
  console.log(`All ${DOMAINS.length} integrity domains PASS`);
  process.exit(0);
}
console.log(`${failed} domain(s) FAILED`);
process.exit(1);
