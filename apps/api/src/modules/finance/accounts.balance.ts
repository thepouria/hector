import { Prisma } from '@hector/database';

type Tx = Prisma.TransactionClient;

/**
 * Canonical ledger balance for one account:
 * SUM(IN amounts) − SUM(OUT amounts). Opening balance participates as IN.
 */
export async function computeAccountBalance(
  tx: Tx,
  companyId: string,
  accountId: string,
): Promise<Prisma.Decimal> {
  const rows = await tx.$queryRaw<Array<{ balance: Prisma.Decimal | null }>>(Prisma.sql`
    SELECT COALESCE(
      SUM(
        CASE
          WHEN direction = 'IN' THEN amount
          WHEN direction = 'OUT' THEN -amount
          ELSE 0
        END
      ),
      0
    ) AS balance
    FROM financial_account_movements
    WHERE company_id = ${companyId}::uuid
      AND account_id = ${accountId}::uuid
  `);
  return new Prisma.Decimal(rows[0]?.balance ?? 0);
}

/**
 * Lock financial account rows FOR UPDATE in deterministic id order
 * to prevent concurrent overspend / default races.
 */
export async function lockAccountsForUpdate(
  tx: Tx,
  companyId: string,
  accountIds: string[],
): Promise<void> {
  const unique = [...new Set(accountIds)].sort();
  if (unique.length === 0) {
    return;
  }
  await tx.$queryRaw(Prisma.sql`
    SELECT id
    FROM financial_accounts
    WHERE company_id = ${companyId}::uuid
      AND id IN (${Prisma.join(unique.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY id
    FOR UPDATE
  `);
}

export async function lockAccountForUpdate(
  tx: Tx,
  companyId: string,
  accountId: string,
): Promise<void> {
  await lockAccountsForUpdate(tx, companyId, [accountId]);
}
