import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 4.12 — Direct balance mutation scan.
 * Account balance is ledger-derived; no PATCH .../balance route; DTO cannot assign balance.
 */
describe('Finance balance mutation architecture (Phase 4.12)', () => {
  const financeDir = join(process.cwd(), 'src/modules/finance');
  const repoRoot = join(process.cwd(), '../..');

  function walkTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        out.push(...walkTsFiles(full));
      } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  it('has no PATCH/PUT route that mutates account balance directly', () => {
    const controller = readFileSync(join(financeDir, 'accounts.controller.ts'), 'utf8');
    expect(controller).toMatch(/@Get\(':accountId\/balance'\)/);
    expect(controller).not.toMatch(/@(Patch|Put|Post)\(['`]:accountId\/balance['`]\)/);
    expect(controller).not.toMatch(/@(Patch|Put)\([^)]*balance/);

    const allControllers = walkTsFiles(financeDir).filter((p) => p.endsWith('.controller.ts'));
    for (const path of allControllers) {
      const body = readFileSync(path, 'utf8');
      expect(body).not.toMatch(/@(Patch|Put)\(\s*['`][^'`]*\/balance['`]/);
    }
  });

  it('accounts.service never assigns balance from DTO', () => {
    const service = readFileSync(join(financeDir, 'accounts.service.ts'), 'utf8');
    expect(service).toMatch(/dto\.balance !== undefined/);
    expect(service).toMatch(/BALANCE_NOT_ACCEPTABLE|FINANCIAL_ACCOUNT_BALANCE_NOT_ACCEPTABLE/);
    expect(service).not.toMatch(/data:\s*\{[^}]*balance:\s*dto\.balance/);
    expect(service).not.toMatch(/balance:\s*dto\.balance/);
    expect(service).not.toMatch(/update\(\{[\s\S]*balance:\s*dto/);
  });

  it('UpdateFinancialAccountDto documents balance as forbidden (service rejects)', () => {
    const dto = readFileSync(join(financeDir, 'dto/financial-account.dto.ts'), 'utf8');
    expect(dto).toMatch(/Forbidden — balance is never patchable/);
    expect(dto).toMatch(/balance\?:/);
    const service = readFileSync(join(financeDir, 'accounts.service.ts'), 'utf8');
    expect(service).toContain('dto.balance !== undefined');
    expect(service).not.toMatch(/data:\s*\{[^}]*\bbalance:\s*dto\.balance/);
  });

  it('documents FIN-CASH-001 / FIN-004 in invariants', () => {
    const invariants = readFileSync(join(repoRoot, 'docs/finance-invariants.md'), 'utf8');
    expect(invariants).toMatch(/FIN-CASH-001|FIN-004/);
    expect(invariants).toMatch(/balance is not freely editable|cannot be arbitrarily overwritten/i);
  });
});
