import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Optional Catalog mutation context (Phase Audit+Events).
 * Used so Bulk Operations can stamp entity Audits/Events with bulkOperationId
 * without changing every Catalog service method signature.
 */
export type CatalogMutationContextStore = {
  bulkOperationId?: string;
};

export const catalogMutationContext = new AsyncLocalStorage<CatalogMutationContextStore>();

export function getCatalogMutationContext(): CatalogMutationContextStore | undefined {
  return catalogMutationContext.getStore();
}

export function runWithCatalogBulkContext<T>(
  bulkOperationId: string,
  work: () => Promise<T>,
): Promise<T> {
  return catalogMutationContext.run({ bulkOperationId }, work);
}
