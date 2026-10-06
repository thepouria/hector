import type { BarcodeType, CatalogLifecycleStatus, Prisma } from '@hector/database';
import type { SkuPrimaryBarcodeRef, SkuView } from './types/catalog.types';

/** Standard include for SKU reads: product ref + selected variant values (option → value). */
export const skuInclude = {
  product: { select: { id: true, name: true, code: true, status: true } },
  optionValues: {
    include: {
      option: { select: { id: true, name: true, position: true } },
      optionValue: { select: { id: true, value: true, position: true, isActive: true } },
    },
  },
} satisfies Prisma.SkuInclude;

/** Active barcodes for primaryBarcode projection (list/detail). */
export const skuListBarcodeInclude = {
  barcodes: {
    where: { archivedAt: null },
    select: { id: true, value: true, type: true, isPrimary: true, createdAt: true },
    orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }],
  },
} satisfies Prisma.SkuInclude;

export type SkuRow = {
  id: string;
  companyId: string;
  productId: string;
  code: string;
  normalizedCode: string;
  name: string | null;
  variantSignature: string;
  status: CatalogLifecycleStatus;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  product: { id: string; name: string; code: string | null; status: CatalogLifecycleStatus };
  optionValues: Array<{
    option: { id: string; name: string; position: number };
    optionValue: { id: string; value: string; position: number; isActive: boolean };
  }>;
};

type SkuListBarcode = {
  id: string;
  value: string;
  type: BarcodeType;
  isPrimary: boolean;
};

export function pickPrimaryBarcode(barcodes: SkuListBarcode[]): SkuPrimaryBarcodeRef | null {
  if (barcodes.length === 0) return null;
  const primary = barcodes.find((b) => b.isPrimary) ?? barcodes[0];
  return { id: primary.id, value: primary.value, type: primary.type };
}

export function toSkuView(row: SkuRow, listBarcodes?: SkuListBarcode[]): SkuView {
  const variantValues = row.optionValues
    .map((link) => ({
      optionId: link.option.id,
      optionName: link.option.name,
      optionPosition: link.option.position,
      optionValueId: link.optionValue.id,
      value: link.optionValue.value,
      valuePosition: link.optionValue.position,
      isActive: link.optionValue.isActive,
    }))
    .sort(
      (a, b) =>
        a.optionPosition - b.optionPosition ||
        a.optionName.localeCompare(b.optionName) ||
        a.optionId.localeCompare(b.optionId),
    );

  return {
    id: row.id,
    companyId: row.companyId,
    productId: row.productId,
    code: row.code,
    normalizedCode: row.normalizedCode,
    name: row.name,
    variantSignature: row.variantSignature,
    status: row.status,
    product: {
      id: row.product.id,
      name: row.product.name,
      code: row.product.code,
      status: row.product.status,
    },
    variantValues,
    ...(listBarcodes !== undefined ? { hasBarcode: listBarcodes.length > 0 } : {}),
    primaryBarcode:
      listBarcodes !== undefined ? pickPrimaryBarcode(listBarcodes) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}
