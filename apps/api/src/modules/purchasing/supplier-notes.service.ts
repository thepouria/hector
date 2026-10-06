import { Injectable } from '@nestjs/common';
import {
  buildPaginationMeta,
  type PaginationMeta,
} from '../../common/dto/pagination-query.dto';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  DOMAIN_EVENTS,
  DomainEventBus,
  DomainEventFactory,
  commitThenPublish,
} from '../../infrastructure/events';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import type { CompanyContext } from '../companies/types/company.types';
import type { CreateSupplierNoteDto } from './dto/create-supplier-note.dto';
import type { ListSupplierNotesQueryDto } from './dto/list-supplier-notes.query.dto';
import { assertNoteBody } from './purchasing.normalization';
import { SuppliersService } from './suppliers.service';
import type { SupplierNoteView } from './types/purchasing.types';

@Injectable()
export class SupplierNotesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly suppliersService: SuppliersService,
  ) {}

  async list(
    company: CompanyContext,
    supplierId: string,
    query: ListSupplierNotesQueryDto,
  ): Promise<{ data: SupplierNoteView[]; meta: PaginationMeta }> {
    await this.suppliersService.requireSupplier(company.companyId, supplierId);
    const where = { companyId: company.companyId, supplierId };
    const skip = (query.page - 1) * query.pageSize;

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.supplierNote.count({ where }),
      this.database.client.supplierNote.findMany({
        where,
        orderBy: { createdAt: query.sortOrder },
        skip,
        take: query.pageSize,
        include: {
          createdBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
    ]);

    return {
      data: rows.map((row) => this.toView(row)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async create(
    company: CompanyContext,
    supplierId: string,
    dto: CreateSupplierNoteDto,
  ): Promise<SupplierNoteView> {
    await this.suppliersService.requireSupplier(company.companyId, supplierId);
    const body = assertNoteBody(dto.body);
    const actorUserId = this.suppliersService.requireActorUserId();

    return commitThenPublish(this.eventBus, async (events) => {
      const created = await this.database.client.$transaction(async (tx) => {
        const note = await tx.supplierNote.create({
          data: {
            companyId: company.companyId,
            supplierId,
            body,
            createdById: actorUserId,
          },
          include: {
            createdBy: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SUPPLIER_NOTE_CREATED,
          entityType: AUDIT_ENTITY_TYPES.SUPPLIER_NOTE,
          entityId: note.id,
          before: null,
          after: {
            id: note.id,
            supplierId,
            bodyPreview: body.slice(0, 120),
          },
          metadata: { supplierId },
        });

        return note;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.PURCHASING_SUPPLIER_NOTE_CREATED,
          payload: {
            companyId: company.companyId,
            supplierId,
            noteId: created.id,
          },
        }),
      );

      return this.toView(created);
    });
  }

  private toView(row: {
    id: string;
    companyId: string;
    supplierId: string;
    body: string;
    createdAt: Date;
    updatedAt: Date;
    createdBy: { id: string; firstName: string; lastName: string };
  }): SupplierNoteView {
    return {
      id: row.id,
      companyId: row.companyId,
      supplierId: row.supplierId,
      body: row.body,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      author: {
        id: row.createdBy.id,
        displayName: `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim(),
      },
    };
  }
}
