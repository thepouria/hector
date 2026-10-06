import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
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
import type { CreateSupplierContactDto } from './dto/create-supplier-contact.dto';
import type { UpdateSupplierContactDto } from './dto/update-supplier-contact.dto';
import { PURCHASING_ERROR_MESSAGES } from './purchasing.constants';
import {
  assertContactName,
  assertContactNotes,
  assertContactRole,
  assertOptionalEmail,
  assertOptionalPhone,
  mapSupplierUniqueViolation,
} from './purchasing.normalization';
import { SuppliersService } from './suppliers.service';
import type { SupplierContactView } from './types/purchasing.types';

type ContactRow = {
  id: string;
  companyId: string;
  supplierId: string;
  name: string;
  role: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

@Injectable()
export class SupplierContactsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly suppliersService: SuppliersService,
  ) {}

  async list(company: CompanyContext, supplierId: string): Promise<SupplierContactView[]> {
    await this.suppliersService.requireSupplier(company.companyId, supplierId);
    const rows = await this.database.client.supplierContact.findMany({
      where: {
        companyId: company.companyId,
        supplierId,
        archivedAt: null,
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => this.toView(row));
  }

  async create(
    company: CompanyContext,
    supplierId: string,
    dto: CreateSupplierContactDto,
  ): Promise<SupplierContactView> {
    await this.suppliersService.requireSupplier(company.companyId, supplierId);
    const name = assertContactName(dto.name);
    const role = assertContactRole(dto.role) ?? null;
    const phone = assertOptionalPhone(dto.phone) ?? null;
    const mobile = assertOptionalPhone(dto.mobile) ?? null;
    const email = assertOptionalEmail(dto.email) ?? null;
    const notes = assertContactNotes(dto.notes) ?? null;

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(async (tx) => {
          const activeCount = await tx.supplierContact.count({
            where: { companyId: company.companyId, supplierId, archivedAt: null },
          });
          const makePrimary =
            dto.isPrimary === true || (dto.isPrimary !== false && activeCount === 0);

          if (makePrimary) {
            await tx.supplierContact.updateMany({
              where: {
                companyId: company.companyId,
                supplierId,
                isPrimary: true,
                archivedAt: null,
              },
              data: { isPrimary: false },
            });
          }

          const contact = await tx.supplierContact.create({
            data: {
              companyId: company.companyId,
              supplierId,
              name,
              role,
              phone,
              mobile,
              email,
              notes,
              isPrimary: makePrimary,
            },
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.SUPPLIER_CONTACT_CREATED,
            entityType: AUDIT_ENTITY_TYPES.SUPPLIER_CONTACT,
            entityId: contact.id,
            before: null,
            after: this.snapshot(contact),
            metadata: { supplierId },
          });

          if (makePrimary) {
            await this.auditService.record(tx, {
              action: AUDIT_ACTIONS.SUPPLIER_CONTACT_PRIMARY_CHANGED,
              entityType: AUDIT_ENTITY_TYPES.SUPPLIER_CONTACT,
              entityId: contact.id,
              before: null,
              after: { supplierId, contactId: contact.id, isPrimary: true },
              metadata: { supplierId, previousContactId: null },
            });
          }

          return contact;
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PURCHASING_SUPPLIER_CONTACT_CREATED,
            payload: {
              companyId: company.companyId,
              supplierId,
              contactId: created.id,
            },
          }),
        );

        if (created.isPrimary) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.PURCHASING_SUPPLIER_PRIMARY_CONTACT_CHANGED,
              payload: {
                companyId: company.companyId,
                supplierId,
                contactId: created.id,
                previousContactId: null,
              },
            }),
          );
        }

        return this.toView(created);
      } catch (error) {
        mapSupplierUniqueViolation(error);
      }
    });
  }

  async update(
    company: CompanyContext,
    supplierId: string,
    contactId: string,
    dto: UpdateSupplierContactDto,
  ): Promise<SupplierContactView> {
    const current = await this.requireContact(company.companyId, supplierId, contactId);
    if (
      dto.name === undefined &&
      dto.role === undefined &&
      dto.phone === undefined &&
      dto.mobile === undefined &&
      dto.email === undefined &&
      dto.notes === undefined &&
      dto.isPrimary === undefined
    ) {
      throw AppError.validation('At least one field is required to update the contact.');
    }

    const next = {
      name: dto.name !== undefined ? assertContactName(dto.name) : current.name,
      role: dto.role !== undefined ? (assertContactRole(dto.role) ?? null) : current.role,
      phone: dto.phone !== undefined ? (assertOptionalPhone(dto.phone) ?? null) : current.phone,
      mobile:
        dto.mobile !== undefined ? (assertOptionalPhone(dto.mobile) ?? null) : current.mobile,
      email: dto.email !== undefined ? (assertOptionalEmail(dto.email) ?? null) : current.email,
      notes: dto.notes !== undefined ? (assertContactNotes(dto.notes) ?? null) : current.notes,
    };

    const wantPrimary = dto.isPrimary === true;

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          let previousPrimaryId: string | null = null;
          if (wantPrimary && !current.isPrimary) {
            const previous = await tx.supplierContact.findFirst({
              where: {
                companyId: company.companyId,
                supplierId,
                isPrimary: true,
                archivedAt: null,
                NOT: { id: current.id },
              },
            });
            previousPrimaryId = previous?.id ?? null;
            await tx.supplierContact.updateMany({
              where: {
                companyId: company.companyId,
                supplierId,
                isPrimary: true,
                archivedAt: null,
              },
              data: { isPrimary: false },
            });
          }

          const contact = await tx.supplierContact.update({
            where: { id: current.id },
            data: {
              ...next,
              ...(wantPrimary ? { isPrimary: true } : {}),
            },
          });

          const before = this.snapshot(current);
          const after = this.snapshot(contact);
          const audited = await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.SUPPLIER_CONTACT_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.SUPPLIER_CONTACT,
            entityId: contact.id,
            before,
            after,
            metadata: { supplierId },
          });

          if (audited) {
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.PURCHASING_SUPPLIER_CONTACT_UPDATED,
                payload: {
                  companyId: company.companyId,
                  supplierId,
                  contactId: contact.id,
                },
              }),
            );
          }

          if (wantPrimary && !current.isPrimary) {
            await this.auditService.record(tx, {
              action: AUDIT_ACTIONS.SUPPLIER_CONTACT_PRIMARY_CHANGED,
              entityType: AUDIT_ENTITY_TYPES.SUPPLIER_CONTACT,
              entityId: contact.id,
              before: { previousContactId: previousPrimaryId },
              after: { contactId: contact.id, isPrimary: true },
              metadata: { supplierId },
            });
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.PURCHASING_SUPPLIER_PRIMARY_CONTACT_CHANGED,
                payload: {
                  companyId: company.companyId,
                  supplierId,
                  contactId: contact.id,
                  previousContactId: previousPrimaryId,
                },
              }),
            );
          }

          return contact;
        });

        return this.toView(updated);
      } catch (error) {
        mapSupplierUniqueViolation(error);
      }
    });
  }

  async setPrimary(
    company: CompanyContext,
    supplierId: string,
    contactId: string,
  ): Promise<SupplierContactView> {
    const current = await this.requireContact(company.companyId, supplierId, contactId);
    if (current.isPrimary) {
      return this.toView(current);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          const previous = await tx.supplierContact.findFirst({
            where: {
              companyId: company.companyId,
              supplierId,
              isPrimary: true,
              archivedAt: null,
            },
          });

          await tx.supplierContact.updateMany({
            where: {
              companyId: company.companyId,
              supplierId,
              isPrimary: true,
              archivedAt: null,
            },
            data: { isPrimary: false },
          });

          const contact = await tx.supplierContact.update({
            where: { id: current.id },
            data: { isPrimary: true },
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.SUPPLIER_CONTACT_PRIMARY_CHANGED,
            entityType: AUDIT_ENTITY_TYPES.SUPPLIER_CONTACT,
            entityId: contact.id,
            before: { previousContactId: previous?.id ?? null },
            after: { contactId: contact.id, isPrimary: true },
            metadata: { supplierId },
          });

          return { contact, previousContactId: previous?.id ?? null };
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PURCHASING_SUPPLIER_PRIMARY_CONTACT_CHANGED,
            payload: {
              companyId: company.companyId,
              supplierId,
              contactId: updated.contact.id,
              previousContactId: updated.previousContactId,
            },
          }),
        );

        return this.toView(updated.contact);
      } catch (error) {
        mapSupplierUniqueViolation(error);
      }
    });
  }

  async archive(
    company: CompanyContext,
    supplierId: string,
    contactId: string,
  ): Promise<SupplierContactView> {
    const current = await this.requireContact(company.companyId, supplierId, contactId);
    if (current.archivedAt) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_CONTACT_ALREADY_ARCHIVED,
        message: PURCHASING_ERROR_MESSAGES.SUPPLIER_CONTACT_ALREADY_ARCHIVED,
        statusCode: 409,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const archived = await this.database.client.$transaction(async (tx) => {
        const contact = await tx.supplierContact.update({
          where: { id: current.id },
          data: {
            archivedAt: new Date(),
            isPrimary: false,
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SUPPLIER_CONTACT_ARCHIVED,
          entityType: AUDIT_ENTITY_TYPES.SUPPLIER_CONTACT,
          entityId: contact.id,
          before: this.snapshot(current),
          after: this.snapshot(contact),
          metadata: { supplierId },
        });

        return contact;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.PURCHASING_SUPPLIER_CONTACT_ARCHIVED,
          payload: {
            companyId: company.companyId,
            supplierId,
            contactId: archived.id,
          },
        }),
      );

      return this.toView(archived);
    });
  }

  private async requireContact(
    companyId: string,
    supplierId: string,
    contactId: string,
  ): Promise<ContactRow> {
    await this.suppliersService.requireSupplier(companyId, supplierId);
    const row = await this.database.client.supplierContact.findFirst({
      where: { id: contactId, companyId, supplierId, archivedAt: null },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_CONTACT_NOT_FOUND,
        message: PURCHASING_ERROR_MESSAGES.SUPPLIER_CONTACT_NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private snapshot(contact: ContactRow) {
    return {
      id: contact.id,
      supplierId: contact.supplierId,
      name: contact.name,
      role: contact.role,
      phone: contact.phone,
      mobile: contact.mobile,
      email: contact.email,
      isPrimary: contact.isPrimary,
      notes: contact.notes,
      archivedAt: contact.archivedAt?.toISOString() ?? null,
    };
  }

  private toView(row: ContactRow): SupplierContactView {
    return {
      id: row.id,
      companyId: row.companyId,
      supplierId: row.supplierId,
      name: row.name,
      role: row.role,
      phone: row.phone,
      mobile: row.mobile,
      email: row.email,
      isPrimary: row.isPrimary,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
    };
  }
}
