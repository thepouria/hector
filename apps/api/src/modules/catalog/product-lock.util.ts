import type { Prisma } from '@hector/database';

/**
 * Serializes SKU / variant-structure mutations for one product (row lock held until the
 * enclosing transaction ends). Prevents concurrent option creation vs SKU creation races.
 * Company scope is enforced by the caller loading the product with companyId first.
 */
export async function lockProductRow(
  tx: Prisma.TransactionClient,
  productId: string,
  companyId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "products" WHERE "id" = ${productId}::uuid AND "company_id" = ${companyId}::uuid FOR UPDATE`;
}
