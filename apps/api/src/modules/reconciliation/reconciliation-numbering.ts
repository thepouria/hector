import type { Prisma } from '@hector/database';

type Tx = Prisma.TransactionClient;

export async function allocateReconciliationSequence(
  tx: Tx,
  companyId: string,
): Promise<number> {
  const row = await tx.reconciliationSequence.upsert({
    where: { companyId },
    create: { companyId, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return row.nextValue - 1;
}

export function formatReconciliationNumber(seq: number): string {
  return `REC-${String(seq).padStart(6, '0')}`;
}
