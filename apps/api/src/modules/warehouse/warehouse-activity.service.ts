import { Injectable } from '@nestjs/common';
import { Prisma } from '@hector/database';
import {
  buildPaginationMeta,
  type PaginationMeta,
} from '../../common/dto/pagination-query.dto';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AUDIT_ENTITY_TYPES, type AuditEntityType } from '../audit/audit.constants';
import type { CompanyContext } from '../companies/types/company.types';

export type WarehouseActivityEntityKind =
  | 'GOODS_RECEIPT'
  | 'STOCK_TRANSFER'
  | 'INVENTORY_ADJUSTMENT'
  | 'STOCK_COUNT'
  | 'SUPPLIER_RETURN_EXECUTION'
  | 'STOCK_ISSUE';

type ActivityRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: Date;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
  metadata: Prisma.JsonValue;
  actor: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null;
};

function warehouseActivitySummary(action: string, actorName: string): string {
  const map: Record<string, string> = {
    GOODS_RECEIPT_CREATED: `${actorName} رسید کالا را ایجاد کرد.`,
    GOODS_RECEIPT_UPDATED: `${actorName} رسید کالا را ویرایش کرد.`,
    GOODS_RECEIPT_POSTED: `${actorName} رسید کالا را ثبت نهایی کرد.`,
    GOODS_RECEIPT_CANCELLED: `${actorName} رسید کالا را لغو کرد.`,
    PUTAWAY_COMPLETED: `${actorName} جایگذاری را تکمیل کرد.`,
    STOCK_TRANSFER_CREATED: `${actorName} انتقال داخلی را ایجاد کرد.`,
    STOCK_TRANSFER_DISPATCHED: `${actorName} انتقال را به حالت در حال انتقال برد.`,
    STOCK_TRANSFER_COMPLETED: `${actorName} انتقال داخلی را تکمیل کرد.`,
    STOCK_TRANSFER_CANCELLED: `${actorName} انتقال داخلی را لغو کرد.`,
    STOCK_ISSUE_CREATED: `${actorName} خروج موجودی را ایجاد کرد.`,
    STOCK_ISSUE_POSTED: `${actorName} خروج موجودی را ثبت نهایی کرد.`,
    STOCK_ISSUE_CANCELLED: `${actorName} خروج موجودی را لغو کرد.`,
    STOCK_CLASSIFICATION_CHANGED: `${actorName} طبقه‌بندی موجودی را تغییر داد.`,
    INVENTORY_ADJUSTMENT_CREATED: `${actorName} اصلاح موجودی را ایجاد کرد.`,
    INVENTORY_ADJUSTMENT_APPROVED: `${actorName} اصلاح موجودی را تأیید کرد.`,
    INVENTORY_ADJUSTMENT_POSTED: `${actorName} اصلاح موجودی را ثبت نهایی کرد.`,
    INVENTORY_ADJUSTMENT_CANCELLED: `${actorName} اصلاح موجودی را لغو کرد.`,
    STOCK_COUNT_CREATED: `${actorName} شمارش موجودی را ایجاد کرد.`,
    STOCK_COUNT_STARTED: `${actorName} شمارش موجودی را شروع کرد.`,
    STOCK_COUNT_SUBMITTED: `${actorName} شمارش موجودی را برای تأیید ارسال کرد.`,
    STOCK_COUNT_APPROVED: `${actorName} شمارش موجودی را تأیید کرد.`,
    STOCK_COUNT_POSTED: `${actorName} شمارش موجودی را ثبت نهایی کرد.`,
    STOCK_COUNT_CANCELLED: `${actorName} شمارش موجودی را لغو کرد.`,
    SUPPLIER_RETURN_EXECUTION_CREATED: `${actorName} اجرای برگشت تأمین‌کننده را ایجاد کرد.`,
    SUPPLIER_RETURN_DISPATCHED: `${actorName} برگشت تأمین‌کننده را ارسال فیزیکی کرد.`,
    SUPPLIER_RETURN_EXECUTION_CANCELLED: `${actorName} اجرای برگشت تأمین‌کننده را لغو کرد.`,
    INVENTORY_RESERVED: `${actorName} رزرو موجودی ایجاد کرد.`,
    INVENTORY_RESERVATION_RELEASED: `${actorName} رزرو موجودی را آزاد کرد.`,
    INVENTORY_RESERVATION_CONSUMED: `${actorName} رزرو موجودی را مصرف کرد.`,
    INVENTORY_RESERVATION_EXPIRED: `${actorName} رزرو موجودی را منقضی کرد.`,
  };
  return map[action] ?? `${actorName}: ${action}`;
}

/**
 * Business activity timelines for warehouse operational documents (Phase 3.17).
 * Projects company-scoped Audit rows — does not replace InventoryMovement ledger.
 */
@Injectable()
export class WarehouseActivityService {
  constructor(private readonly database: DatabaseService) {}

  async listForEntity(
    company: CompanyContext,
    kind: WarehouseActivityEntityKind,
    entityId: string,
    query: { page?: number; pageSize?: number },
  ): Promise<{ data: ReturnType<WarehouseActivityService['toActivityItem']>[]; meta: PaginationMeta }> {
    await this.assertEntity(company.companyId, kind, entityId);

    const entityType = this.toAuditEntityType(kind);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.AuditLogWhereInput = {
      companyId: company.companyId,
      entityType,
      entityId,
    };

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.auditLog.count({ where }),
      this.database.client.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          before: true,
          after: true,
          metadata: true,
          actor: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      }),
    ]);

    return {
      data: rows.map((row) => this.toActivityItem(row)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  private toAuditEntityType(kind: WarehouseActivityEntityKind): AuditEntityType {
    switch (kind) {
      case 'GOODS_RECEIPT':
        return AUDIT_ENTITY_TYPES.GOODS_RECEIPT;
      case 'STOCK_TRANSFER':
        return AUDIT_ENTITY_TYPES.STOCK_TRANSFER;
      case 'INVENTORY_ADJUSTMENT':
        return AUDIT_ENTITY_TYPES.INVENTORY_ADJUSTMENT;
      case 'STOCK_COUNT':
        return AUDIT_ENTITY_TYPES.STOCK_COUNT;
      case 'SUPPLIER_RETURN_EXECUTION':
        return AUDIT_ENTITY_TYPES.SUPPLIER_RETURN_EXECUTION;
      case 'STOCK_ISSUE':
        return AUDIT_ENTITY_TYPES.STOCK_ISSUE;
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
  }

  private async assertEntity(
    companyId: string,
    kind: WarehouseActivityEntityKind,
    entityId: string,
  ): Promise<void> {
    let found: { id: string } | null = null;
    switch (kind) {
      case 'GOODS_RECEIPT':
        found = await this.database.client.goodsReceipt.findFirst({
          where: { id: entityId, companyId },
          select: { id: true },
        });
        break;
      case 'STOCK_TRANSFER':
        found = await this.database.client.stockTransfer.findFirst({
          where: { id: entityId, companyId },
          select: { id: true },
        });
        break;
      case 'INVENTORY_ADJUSTMENT':
        found = await this.database.client.inventoryAdjustment.findFirst({
          where: { id: entityId, companyId },
          select: { id: true },
        });
        break;
      case 'STOCK_COUNT':
        found = await this.database.client.stockCount.findFirst({
          where: { id: entityId, companyId },
          select: { id: true },
        });
        break;
      case 'SUPPLIER_RETURN_EXECUTION':
        found = await this.database.client.supplierReturnExecution.findFirst({
          where: { id: entityId, companyId },
          select: { id: true },
        });
        break;
      case 'STOCK_ISSUE':
        found = await this.database.client.stockIssue.findFirst({
          where: { id: entityId, companyId },
          select: { id: true },
        });
        break;
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }

    if (!found) {
      throw new AppError({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Entity not found in active company.',
        statusCode: 404,
      });
    }
  }

  private toActivityItem(row: ActivityRow) {
    const before =
      row.before && typeof row.before === 'object' && !Array.isArray(row.before)
        ? (row.before as Record<string, unknown>)
        : null;
    const after =
      row.after && typeof row.after === 'object' && !Array.isArray(row.after)
        ? (row.after as Record<string, unknown>)
        : null;
    const metadata =
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null;

    const changes: Array<{ field: string; before: string | null; after: string | null }> = [];
    if (before || after) {
      const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
      for (const key of keys) {
        if (
          key === 'id' ||
          key === 'updatedAt' ||
          key === 'createdAt' ||
          key === 'version' ||
          key === 'items'
        ) {
          continue;
        }
        const from = before?.[key];
        const to = after?.[key];
        if (JSON.stringify(from) === JSON.stringify(to)) continue;
        changes.push({
          field: key,
          before: from === undefined || from === null ? null : String(from),
          after: to === undefined || to === null ? null : String(to),
        });
      }
    }

    let reason: string | null = null;
    if (typeof after?.reason === 'string' && after.reason) reason = after.reason;
    else if (typeof after?.notes === 'string' && after.notes) reason = after.notes;
    else if (typeof metadata?.reason === 'string' && metadata.reason) reason = metadata.reason;
    else if (typeof after?.cancellationReason === 'string' && after.cancellationReason) {
      reason = after.cancellationReason;
    }

    const actorName = row.actor
      ? `${row.actor.firstName ?? ''} ${row.actor.lastName ?? ''}`.trim() || row.actor.email
      : 'سیستم';

    return {
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      createdAt: row.createdAt.toISOString(),
      actor: row.actor
        ? { id: row.actor.id, displayName: actorName }
        : { id: null as string | null, displayName: 'سیستم' },
      summary: warehouseActivitySummary(row.action, actorName),
      reason,
      changes: changes.slice(0, 12),
      reference:
        typeof metadata?.countNumber === 'string'
          ? metadata.countNumber
          : typeof metadata?.number === 'string'
            ? metadata.number
            : typeof metadata?.transferNumber === 'string'
              ? metadata.transferNumber
              : null,
    };
  }
}
