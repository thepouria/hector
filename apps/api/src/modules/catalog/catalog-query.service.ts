import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { CompanyContext } from '../companies/types/company.types';
import {
  CATALOG_ERROR_MESSAGES,
  CATALOG_LOOKUP_DEFAULT_LIMIT,
  CATALOG_LOOKUP_MAX_LIMIT,
  CATALOG_SEARCH_MAX_LENGTH,
} from './catalog.constants';
import { normalizeSearchNameKey, normalizeSearchQuery } from './catalog.normalization';
import { normalizeScannedValue } from './barcode-normalize.util';
import type { CatalogLookupQueryDto } from './dto/catalog-lookup.query.dto';
import { pickPrimaryBarcode } from './sku.mapper';
import type {
  CatalogLookupHit,
  CatalogLookupType,
  CatalogStatsView,
  SkuIdentityView,
} from './types/catalog.types';

/**
 * Lookup rank (deterministic, operational — not Google relevance):
 * 0 exact barcode
 * 1 exact SKU / product code
 * 2 exact product name
 * 3 prefix
 * 4 contains
 */
type LookupRank = 0 | 1 | 2 | 3 | 4;

type ScoredHit = CatalogLookupHit & { rank: LookupRank; typeOrder: number };

const TYPE_ORDER: Record<CatalogLookupType, number> = {
  BARCODE: 0,
  SKU: 1,
  PRODUCT: 2,
};

/**
 * Catalog search / lookup boundary (Phase 1.9).
 * PostgreSQL is the current provider; consumers should depend on this service
 * (or list endpoints) rather than inventing ad-hoc search so a future search
 * engine can slot in behind the same API shapes.
 */
@Injectable()
export class CatalogQueryService {
  constructor(private readonly database: DatabaseService) {}

  async getSkuIdentity(companyId: string, skuId: string): Promise<SkuIdentityView> {
    const row = await this.database.client.sku.findFirst({
      where: { id: skuId, companyId },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        product: { select: { id: true, name: true, code: true, status: true } },
        barcodes: {
          where: { archivedAt: null },
          select: { id: true, value: true, type: true, isPrimary: true, createdAt: true },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.SKU_NOT_FOUND,
        message: CATALOG_ERROR_MESSAGES.SKU_NOT_FOUND,
        statusCode: 404,
      });
    }

    return {
      skuId: row.id,
      skuCode: row.code,
      skuName: row.name,
      skuStatus: row.status,
      productId: row.product.id,
      productName: row.product.name,
      productCode: row.product.code,
      productStatus: row.product.status,
      primaryBarcode: pickPrimaryBarcode(row.barcodes),
    };
  }

  async lookup(
    company: CompanyContext,
    query: CatalogLookupQueryDto,
  ): Promise<{ data: CatalogLookupHit[] }> {
    const search = normalizeSearchQuery(query.search, CATALOG_SEARCH_MAX_LENGTH);
    const limit = Math.min(query.limit ?? CATALOG_LOOKUP_DEFAULT_LIMIT, CATALOG_LOOKUP_MAX_LIMIT);
    if (!search) {
      return { data: [] };
    }

    const allowedTypes = parseLookupTypes(query.types);
    const upper = search.toUpperCase();
    const nameKey = normalizeSearchNameKey(search);
    const candidateTake = Math.max(limit * 3, 30);

    let scannedNormalized: string | null = null;
    try {
      scannedNormalized = normalizeScannedValue(search);
    } catch {
      scannedNormalized = null;
    }

    const hits: ScoredHit[] = [];
    const seen = new Set<string>();

    // 1) Exact barcode — indexed equality on normalizedValue (never primary LIKE path).
    if (allowedTypes.has('BARCODE') && scannedNormalized) {
      const exactBarcodes = await this.database.client.barcode.findMany({
        where: {
          companyId: company.companyId,
          archivedAt: null,
          OR: [
            { normalizedValue: scannedNormalized },
            { normalizedValue: upper },
            { value: search },
          ],
        },
        select: {
          id: true,
          value: true,
          skuId: true,
          sku: {
            select: {
              id: true,
              code: true,
              status: true,
              productId: true,
              product: { select: { name: true } },
            },
          },
        },
        take: limit,
      });

      for (const barcode of exactBarcodes) {
        const key = `BARCODE:${barcode.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({
          type: 'BARCODE',
          id: barcode.id,
          label: barcode.value,
          sublabel: `${barcode.sku.code} — ${barcode.sku.product.name}`,
          productId: barcode.sku.productId,
          skuId: barcode.sku.id,
          status: barcode.sku.status,
          rank: 0,
          typeOrder: TYPE_ORDER.BARCODE,
        });
      }
    }

    // 2) Exact SKU code
    if (allowedTypes.has('SKU')) {
      const exactSkus = await this.database.client.sku.findMany({
        where: {
          companyId: company.companyId,
          OR: [{ normalizedCode: upper }, { code: { equals: search, mode: 'insensitive' } }],
        },
        select: {
          id: true,
          code: true,
          status: true,
          productId: true,
          product: { select: { name: true, code: true } },
          optionValues: {
            select: {
              option: { select: { name: true, position: true } },
              optionValue: { select: { value: true } },
            },
            orderBy: { option: { position: 'asc' } },
            take: 4,
          },
        },
        take: limit,
      });
      for (const sku of exactSkus) {
        const key = `SKU:${sku.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const variant = sku.optionValues
          .map((ov) => `${ov.option.name}: ${ov.optionValue.value}`)
          .join(' · ');
        hits.push({
          type: 'SKU',
          id: sku.id,
          label: sku.code,
          sublabel: variant
            ? `${sku.product.name} — ${variant}`
            : sku.product.name,
          productId: sku.productId,
          skuId: sku.id,
          status: sku.status,
          rank: 1,
          typeOrder: TYPE_ORDER.SKU,
        });
      }
    }

    // 3) Exact product code / name
    if (allowedTypes.has('PRODUCT')) {
      const exactProducts = await this.database.client.product.findMany({
        where: {
          companyId: company.companyId,
          OR: [
            { normalizedCode: upper },
            { code: { equals: search, mode: 'insensitive' } },
            { normalizedName: nameKey },
          ],
        },
        select: {
          id: true,
          name: true,
          code: true,
          status: true,
          brand: { select: { name: true } },
          category: { select: { name: true } },
        },
        take: limit,
      });
      for (const product of exactProducts) {
        const key = `PRODUCT:${product.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const isExactCode =
          (product.code?.toUpperCase() ?? '') === upper ||
          (product.code?.toLocaleLowerCase('en-US') ?? '') ===
            search.toLocaleLowerCase('en-US');
        const context = [product.brand?.name, product.category?.name].filter(Boolean).join(' • ');
        hits.push({
          type: 'PRODUCT',
          id: product.id,
          label: product.name,
          sublabel: [product.code, context].filter(Boolean).join(' · ') || null,
          productId: product.id,
          skuId: null,
          status: product.status,
          rank: isExactCode ? 1 : 2,
          typeOrder: TYPE_ORDER.PRODUCT,
        });
      }
    }

    // 4) Broader contains / prefix candidates
    const needMore = hits.length < limit;
    if (needMore) {
      const products = allowedTypes.has('PRODUCT')
        ? await this.database.client.product.findMany({
            where: {
              companyId: company.companyId,
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } },
                { normalizedName: { contains: nameKey } },
                { normalizedCode: { contains: upper } },
                { brand: { name: { contains: search, mode: 'insensitive' } } },
                { category: { name: { contains: search, mode: 'insensitive' } } },
              ],
            },
            select: {
              id: true,
              name: true,
              code: true,
              status: true,
              brand: { select: { name: true } },
              category: { select: { name: true } },
            },
            take: candidateTake,
          })
        : [];
      const skus = allowedTypes.has('SKU')
        ? await this.database.client.sku.findMany({
            where: {
              companyId: company.companyId,
              OR: [
                { code: { contains: search, mode: 'insensitive' } },
                { normalizedCode: { contains: upper } },
                { name: { contains: search, mode: 'insensitive' } },
                {
                  product: {
                    OR: [
                      { name: { contains: search, mode: 'insensitive' } },
                      { code: { contains: search, mode: 'insensitive' } },
                    ],
                  },
                },
                {
                  optionValues: {
                    some: {
                      optionValue: {
                        OR: [
                          { value: { contains: search, mode: 'insensitive' } },
                          { normalizedValue: { contains: nameKey } },
                        ],
                      },
                    },
                  },
                },
              ],
            },
            select: {
              id: true,
              code: true,
              status: true,
              productId: true,
              product: { select: { name: true, code: true } },
              optionValues: {
                select: {
                  option: { select: { name: true, position: true } },
                  optionValue: { select: { value: true } },
                },
                orderBy: { option: { position: 'asc' } },
                take: 4,
              },
            },
            take: candidateTake,
          })
        : [];
      const barcodes = allowedTypes.has('BARCODE')
        ? await this.database.client.barcode.findMany({
            where: {
              companyId: company.companyId,
              archivedAt: null,
              OR: [
                { value: { contains: search, mode: 'insensitive' } },
                { normalizedValue: { contains: upper } },
              ],
            },
            select: {
              id: true,
              value: true,
              skuId: true,
              sku: {
                select: {
                  id: true,
                  code: true,
                  status: true,
                  productId: true,
                  product: { select: { name: true } },
                },
              },
            },
            take: candidateTake,
          })
        : [];

      for (const product of products) {
        const key = `PRODUCT:${product.id}`;
        if (seen.has(key)) continue;
        const rank = this.bestRank(
          [product.name, product.code, product.brand?.name, product.category?.name],
          search,
          upper,
          nameKey,
        );
        if (rank === null) continue;
        seen.add(key);
        const context = [product.brand?.name, product.category?.name].filter(Boolean).join(' • ');
        hits.push({
          type: 'PRODUCT',
          id: product.id,
          label: product.name,
          sublabel: [product.code, context].filter(Boolean).join(' · ') || null,
          productId: product.id,
          skuId: null,
          status: product.status,
          rank,
          typeOrder: TYPE_ORDER.PRODUCT,
        });
      }

      for (const sku of skus) {
        const key = `SKU:${sku.id}`;
        if (seen.has(key)) continue;
        const variantBits = sku.optionValues.map((ov) => ov.optionValue.value);
        const rank = this.bestRank(
          [sku.code, sku.product.name, sku.product.code ?? undefined, ...variantBits],
          search,
          upper,
          nameKey,
        );
        if (rank === null) continue;
        seen.add(key);
        const variant = sku.optionValues
          .map((ov) => `${ov.option.name}: ${ov.optionValue.value}`)
          .join(' · ');
        hits.push({
          type: 'SKU',
          id: sku.id,
          label: sku.code,
          sublabel: variant ? `${sku.product.name} — ${variant}` : sku.product.name,
          productId: sku.productId,
          skuId: sku.id,
          status: sku.status,
          rank,
          typeOrder: TYPE_ORDER.SKU,
        });
      }

      for (const barcode of barcodes) {
        const key = `BARCODE:${barcode.id}`;
        if (seen.has(key)) continue;
        const rank = this.bestRank([barcode.value], search, upper, nameKey);
        if (rank === null) continue;
        // Contains-only barcode matches stay behind exact identifiers.
        const adjusted: LookupRank = rank === 0 ? 0 : rank < 4 ? ((rank + 1) as LookupRank) : 4;
        seen.add(key);
        hits.push({
          type: 'BARCODE',
          id: barcode.id,
          label: barcode.value,
          sublabel: `${barcode.sku.code} — ${barcode.sku.product.name}`,
          productId: barcode.sku.productId,
          skuId: barcode.sku.id,
          status: barcode.sku.status,
          rank: adjusted,
          typeOrder: TYPE_ORDER.BARCODE,
        });
      }
    }

    hits.sort(
      (a, b) =>
        a.rank - b.rank ||
        a.typeOrder - b.typeOrder ||
        a.label.localeCompare(b.label) ||
        a.id.localeCompare(b.id),
    );

    const data = hits.slice(0, limit).map(({ rank: _r, typeOrder: _t, ...hit }) => hit);
    return { data };
  }

  async stats(company: CompanyContext): Promise<{ data: CatalogStatsView }> {
    const companyId = company.companyId;
    const [brands, categories, products, skus, barcodes, attributes] =
      await this.database.client.$transaction([
        this.database.client.brand.count({ where: { companyId } }),
        this.database.client.category.count({ where: { companyId } }),
        this.database.client.product.count({ where: { companyId } }),
        this.database.client.sku.count({ where: { companyId } }),
        this.database.client.barcode.count({ where: { companyId } }),
        this.database.client.attributeDefinition.count({ where: { companyId } }),
      ]);

    return { data: { brands, categories, products, skus, barcodes, attributes } };
  }

  private bestRank(
    fields: Array<string | null | undefined>,
    search: string,
    normalizedUpper: string,
    nameKey: string,
  ): LookupRank | null {
    let best: LookupRank | null = null;
    for (const field of fields) {
      const rank = this.rankField(field, search, normalizedUpper, nameKey);
      if (rank !== null && (best === null || rank < best)) {
        best = rank;
      }
    }
    return best;
  }

  private rankField(
    value: string | null | undefined,
    search: string,
    normalizedUpper: string,
    nameKey: string,
  ): LookupRank | null {
    if (!value) return null;
    const needle = search.toLocaleLowerCase('en-US');
    const haystack = value.toLocaleLowerCase('en-US');
    const folded = normalizeSearchNameKey(value);
    if (haystack === needle || value.toUpperCase() === normalizedUpper || folded === nameKey) {
      // Exact code-like → rank 1; otherwise exact name → 2. Callers that already
      // did exact-code queries use rank 1 explicitly.
      return value.toUpperCase() === normalizedUpper && /^[A-Z0-9._-]+$/i.test(value) ? 1 : 2;
    }
    if (haystack.startsWith(needle) || folded.startsWith(nameKey)) return 3;
    if (haystack.includes(needle) || folded.includes(nameKey)) return 4;
    return null;
  }
}

function parseLookupTypes(raw: string | undefined): Set<CatalogLookupType> {
  const all = new Set<CatalogLookupType>(['PRODUCT', 'SKU', 'BARCODE']);
  if (!raw?.trim()) return all;
  const parts = raw
    .split(',')
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
  const selected = new Set<CatalogLookupType>();
  for (const part of parts) {
    if (part === 'PRODUCT' || part === 'SKU' || part === 'BARCODE') {
      selected.add(part);
    }
  }
  return selected.size > 0 ? selected : all;
}
