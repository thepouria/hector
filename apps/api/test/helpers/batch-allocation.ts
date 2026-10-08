import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

type AuthHeaders = Record<string, string>;

/**
 * Fully allocate every DRAFT GRN item to a (new or existing) batch so POST can succeed.
 * Phase 3.7 posting invariant: SUM(allocations) === item.quantity.
 */
export async function allocateAllItemsToBatches(
  app: INestApplication,
  headers: AuthHeaders,
  goodsReceiptId: string,
  options?: {
    supplierBatchPrefix?: string;
    expiresAt?: string | null;
  },
): Promise<void> {
  const detail = await request(app.getHttpServer())
    .get(`/api/v1/goods-receipts/${goodsReceiptId}`)
    .set(headers)
    .expect(200);

  const items = detail.body.data.items as Array<{
    id: string;
    quantity: number;
    allocatedQuantity?: number;
    batchAllocations?: Array<{ id: string; batchId: string; quantity: number }>;
  }>;

  // UUID prefix avoids Date.now() collisions under dense e2e traffic.
  const prefix = options?.supplierBatchPrefix ?? `E2E-LOT-${randomUUID().slice(0, 12)}`;

  for (const [index, item] of items.entries()) {
    const allocated = item.allocatedQuantity ?? 0;
    if (allocated === item.quantity) continue;
    if (allocated > 0) {
      for (const allocation of item.batchAllocations ?? []) {
        await request(app.getHttpServer())
          .delete(
            `/api/v1/goods-receipts/${goodsReceiptId}/items/${item.id}/batches/${allocation.id}`,
          )
          .set(headers)
          .expect(200);
      }
    }

    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${goodsReceiptId}/items/${item.id}/batches`)
      .set(headers)
      .send({
        supplierBatchNumber: `${prefix}-${index + 1}`,
        expiresAt: options?.expiresAt ?? null,
        quantity: item.quantity,
      })
      .expect(201);
  }
}
