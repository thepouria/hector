/**
 * Post-E2E integrity gate (P.1.1 / P.1.2).
 * Runs AFTER Jest e2e without resetting the DB.
 * Prefer full integrity:all in CI; this file keeps a focused inventory gate
 * for local inventory-only iteration.
 */
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

const repoRoot = resolve(__dirname, '../../..');

console.log('\n=== post-e2e integrity:all ===');
execFileSync('pnpm', ['integrity:all'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});
console.log('\nPost-E2E integrity: OK');
