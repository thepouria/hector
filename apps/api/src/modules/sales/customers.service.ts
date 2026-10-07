import { Injectable } from '@nestjs/common';
import {
  CustomerStatus,
  CustomerType,
  PartyRoleType,
  PartyType,
  Prisma,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import {
  buildPaginationMeta,
  type PaginationMeta,
} from '../../common/dto/pagination-query.dto';
import { AppError } from '../../common/exceptions/app.error';
import { getRequestContext } from '../../common/context/request-context';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  DOMAIN_EVENTS,
  DomainEventBus,
  DomainEventFactory,
  commitThenPublish,
} from '../../infrastructure/events';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { auditSnapshotsEqual } from '../audit/serializers/audit-sanitizer';
import type { CompanyContext } from '../companies/types/company.types';
import { PartyIdentityLookupService } from '../party/party-identity-lookup.service';
import type { CreateCustomerAddressDto } from './dto/create-customer-address.dto';
import type { CreateCustomerAddressNestedDto, CreateCustomerDto } from './dto/create-customer.dto';
import type { ListCustomersQueryDto } from './dto/list-customers.query.dto';
import type { UpdateCustomerAddressDto } from './dto/update-customer-address.dto';
import type { UpdateCustomerDto } from './dto/update-customer.dto';
import { SALES_ERROR_MESSAGES } from './sales.constants';
import {
  assertAddressCity,
  assertAddressLabel,
  assertAddressLine,
  assertAddressNotes,
  assertAddressPostal,
  assertAddressProvince,
  assertAddressRecipient,
  assertBusinessName,
  assertCustomerCode,
  assertCustomerDisplayName,
  assertCustomerNotes,
  assertIdField,
  assertOptionalEmail,
  assertOptionalPhone,
  assertPersonName,
  mapSalesUniqueViolation,
  normalizeCustomerSearchQuery,
  setDefaultCustomerAddressInTx,
} from './sales.normalization';

type CustomerRow = {
  id: string;
  companyId: string;
  code: string | null;
  type: CustomerType;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  businessName: string | null;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  nationalId: string | null;
  taxId: string | null;
  registrationNumber: string | null;
  status: CustomerStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  archivedAt: Date | null;
};

type AddressRow = {
  id: string;
  companyId: string;
  customerId: string;
  label: string | null;
  recipientName: string | null;
  mobile: string | null;
  province: string | null;
  city: string | null;
  addressLine: string | null;
  postalCode: string | null;
  isDefault: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type CustomerAddressView = {
  id: string;
  companyId: string;
  customerId: string;
  label: string | null;
  recipientName: string | null;
  mobile: string | null;
  province: string | null;
  city: string | null;
  addressLine: string | null;
  postalCode: string | null;
  isDefault: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type CustomerListItemView = {
  id: string;
  companyId: string;
  code: string | null;
  type: CustomerType;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  businessName: string | null;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  nationalId: string | null;
  taxId: string | null;
  registrationNumber: string | null;
  status: CustomerStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  archivedAt: Date | null;
};

export type CustomerDetailView = CustomerListItemView & {
  addresses: CustomerAddressView[];
};

@Injectable()
export class CustomersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly partyIdentity: PartyIdentityLookupService,
  ) {}

  async list(
    company: CompanyContext,
    query: ListCustomersQueryDto,
  ): Promise<{ data: CustomerListItemView[]; meta: PaginationMeta }> {
    const search = normalizeCustomerSearchQuery(query.search);
    const where: Prisma.CustomerWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(search
        ? {
            OR: [
              { displayName: { contains: search, mode: 'insensitive' } },
              { businessName: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
              { mobile: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              {
                party: {
                  OR: [
                    { displayName: { contains: search, mode: 'insensitive' } },
                    { legalName: { contains: search, mode: 'insensitive' } },
                    { tradeName: { contains: search, mode: 'insensitive' } },
                    {
                      contactPoints: {
                        some: {
                          companyId: company.companyId,
                          status: 'ACTIVE',
                          value: { contains: search, mode: 'insensitive' },
                        },
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const orderBy: Prisma.CustomerOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder,
    };

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.customer.count({ where }),
      this.database.client.customer.findMany({
        where,
        orderBy,
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => this.toListView(row)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, customerId: string): Promise<CustomerDetailView> {
    const row = await this.database.client.customer.findFirst({
      where: { id: customerId, companyId: company.companyId },
      include: {
        addresses: {
          where: { archivedAt: null },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!row) {
      throw this.notFound();
    }
    return {
      ...this.toListView(row),
      addresses: row.addresses.map((a) => this.toAddressView(a)),
    };
  }

  async create(company: CompanyContext, dto: CreateCustomerDto): Promise<CustomerDetailView> {
    const displayName = assertCustomerDisplayName(dto.displayName);
    const code = assertCustomerCode(dto.code) ?? null;
    const firstName = assertPersonName(dto.firstName) ?? null;
    const lastName = assertPersonName(dto.lastName) ?? null;
    const businessName = assertBusinessName(dto.businessName) ?? null;
    const mobile = assertOptionalPhone(dto.mobile) ?? null;
    const phone = assertOptionalPhone(dto.phone) ?? null;
    const email = assertOptionalEmail(dto.email) ?? null;
    const nationalId = assertIdField(dto.nationalId) ?? null;
    const taxId = assertIdField(dto.taxId) ?? null;
    const registrationNumber = assertIdField(dto.registrationNumber) ?? null;
    const notes = assertCustomerNotes(dto.notes) ?? null;
    const createdById = this.optionalActorUserId();
    const nested = dto.defaultAddress;

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(async (tx) => {
          const partyType =
            dto.type === CustomerType.INDIVIDUAL
              ? PartyType.INDIVIDUAL
              : PartyType.ORGANIZATION;

          let partyId: string;
          let snap = {
            displayName,
            firstName,
            lastName,
            businessName,
            mobile,
            phone,
            email,
            nationalId,
            taxId,
            registrationNumber,
          };

          if (dto.partyId) {
            const party = await this.partyIdentity.requireCompanyParty(
              tx,
              company.companyId,
              dto.partyId,
            );
            const existingLink = await tx.customer.findFirst({
              where: { companyId: company.companyId, partyId: party.id },
            });
            if (existingLink) {
              throw new AppError({
                code: ERROR_CODES.CONFLICT,
                message: 'This Party already has a Customer relationship in this company.',
                statusCode: 409,
              });
            }
            await this.partyIdentity.ensureActiveRole(
              tx,
              company.companyId,
              party.id,
              PartyRoleType.CUSTOMER,
            );
            partyId = party.id;
            snap = {
              displayName: party.displayName,
              firstName: party.firstName,
              lastName: party.lastName,
              businessName: party.legalName ?? party.tradeName,
              mobile,
              phone,
              email,
              nationalId: party.nationalId,
              taxId: null,
              registrationNumber: null,
            };
          } else {
            const party = await this.partyIdentity.createPartyWithRole(tx, company.companyId, {
              type: partyType,
              displayName,
              firstName,
              lastName,
              legalName: businessName,
              tradeName: businessName,
              nationalId,
              registrationNumber,
              taxId,
              mobile,
              phone,
              email,
              roleType: PartyRoleType.CUSTOMER,
              createdById,
            });
            partyId = party.id;
          }

          const customer = await tx.customer.create({
            data: {
              companyId: company.companyId,
              partyId,
              type: dto.type,
              displayName: snap.displayName,
              code,
              firstName: snap.firstName,
              lastName: snap.lastName,
              businessName: snap.businessName,
              mobile: snap.mobile,
              phone: snap.phone,
              email: snap.email,
              nationalId: snap.nationalId,
              taxId: snap.taxId,
              registrationNumber: snap.registrationNumber,
              notes,
              status: CustomerStatus.ACTIVE,
              createdById,
            },
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.CUSTOMER_CREATED,
            entityType: AUDIT_ENTITY_TYPES.CUSTOMER,
            entityId: customer.id,
            before: null,
            after: { ...this.customerSnapshot(customer), partyId },
          });

          let address: AddressRow | null = null;
          if (nested) {
            address = await this.createAddressInTx(tx, {
              companyId: company.companyId,
              customerId: customer.id,
              dto: nested,
              forceDefault: true,
            });
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.SALES_CUSTOMER_ADDRESS_CREATED,
                payload: {
                  companyId: company.companyId,
                  customerId: customer.id,
                  addressId: address.id,
                },
              }),
            );
          }

          return { customer, address };
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.SALES_CUSTOMER_CREATED,
            payload: {
              companyId: company.companyId,
              customerId: created.customer.id,
              type: created.customer.type,
              status: created.customer.status,
            },
          }),
        );

        return {
          ...this.toListView(created.customer),
          addresses: created.address ? [this.toAddressView(created.address)] : [],
        };
      } catch (error) {
        mapSalesUniqueViolation(error);
      }
    });
  }

  async update(
    company: CompanyContext,
    customerId: string,
    dto: UpdateCustomerDto,
  ): Promise<CustomerListItemView> {
    const current = await this.requireCustomer(company.companyId, customerId);
    if (
      dto.type === undefined &&
      dto.displayName === undefined &&
      dto.code === undefined &&
      dto.firstName === undefined &&
      dto.lastName === undefined &&
      dto.businessName === undefined &&
      dto.mobile === undefined &&
      dto.phone === undefined &&
      dto.email === undefined &&
      dto.nationalId === undefined &&
      dto.taxId === undefined &&
      dto.registrationNumber === undefined &&
      dto.notes === undefined
    ) {
      throw AppError.validation('At least one field is required to update the customer.');
    }

    const next = {
      type: dto.type !== undefined ? dto.type : current.type,
      displayName:
        dto.displayName !== undefined
          ? assertCustomerDisplayName(dto.displayName)
          : current.displayName,
      code: dto.code !== undefined ? (assertCustomerCode(dto.code) ?? null) : current.code,
      firstName:
        dto.firstName !== undefined
          ? (assertPersonName(dto.firstName) ?? null)
          : current.firstName,
      lastName:
        dto.lastName !== undefined ? (assertPersonName(dto.lastName) ?? null) : current.lastName,
      businessName:
        dto.businessName !== undefined
          ? (assertBusinessName(dto.businessName) ?? null)
          : current.businessName,
      mobile:
        dto.mobile !== undefined ? (assertOptionalPhone(dto.mobile) ?? null) : current.mobile,
      phone: dto.phone !== undefined ? (assertOptionalPhone(dto.phone) ?? null) : current.phone,
      email: dto.email !== undefined ? (assertOptionalEmail(dto.email) ?? null) : current.email,
      nationalId:
        dto.nationalId !== undefined
          ? (assertIdField(dto.nationalId) ?? null)
          : current.nationalId,
      taxId: dto.taxId !== undefined ? (assertIdField(dto.taxId) ?? null) : current.taxId,
      registrationNumber:
        dto.registrationNumber !== undefined
          ? (assertIdField(dto.registrationNumber) ?? null)
          : current.registrationNumber,
      notes:
        dto.notes !== undefined ? (assertCustomerNotes(dto.notes) ?? null) : current.notes,
    };

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          const customer = await tx.customer.update({
            where: { id: current.id },
            data: next,
          });

          const before = this.customerSnapshot(current);
          const after = this.customerSnapshot(customer);
          const audited = await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.CUSTOMER_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.CUSTOMER,
            entityId: customer.id,
            before,
            after,
          });

          if (audited) {
            const changedFields = Object.keys(before).filter(
              (key) =>
                !auditSnapshotsEqual(
                  (before as Record<string, unknown>)[key],
                  (after as Record<string, unknown>)[key],
                ),
            );
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.SALES_CUSTOMER_UPDATED,
                payload: {
                  companyId: company.companyId,
                  customerId: customer.id,
                  type: customer.type,
                  status: customer.status,
                  changedFields,
                },
              }),
            );
          }

          return customer;
        });

        return this.toListView(updated);
      } catch (error) {
        mapSalesUniqueViolation(error);
      }
    });
  }

  async activate(company: CompanyContext, customerId: string): Promise<CustomerListItemView> {
    return this.changeStatus(
      company,
      customerId,
      CustomerStatus.ACTIVE,
      AUDIT_ACTIONS.CUSTOMER_ACTIVATED,
    );
  }

  async deactivate(company: CompanyContext, customerId: string): Promise<CustomerListItemView> {
    return this.changeStatus(
      company,
      customerId,
      CustomerStatus.INACTIVE,
      AUDIT_ACTIONS.CUSTOMER_DEACTIVATED,
    );
  }

  async createAddress(
    company: CompanyContext,
    customerId: string,
    dto: CreateCustomerAddressDto,
  ): Promise<CustomerAddressView> {
    await this.requireCustomer(company.companyId, customerId);

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(async (tx) => {
          return this.createAddressInTx(tx, {
            companyId: company.companyId,
            customerId,
            dto,
            forceDefault: false,
          });
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.SALES_CUSTOMER_ADDRESS_CREATED,
            payload: {
              companyId: company.companyId,
              customerId,
              addressId: created.id,
            },
          }),
        );

        if (created.isDefault) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.SALES_CUSTOMER_ADDRESS_DEFAULT_CHANGED,
              payload: {
                companyId: company.companyId,
                customerId,
                addressId: created.id,
                previousAddressId: null,
              },
            }),
          );
        }

        return this.toAddressView(created);
      } catch (error) {
        mapSalesUniqueViolation(error);
      }
    });
  }

  async updateAddress(
    company: CompanyContext,
    customerId: string,
    addressId: string,
    dto: UpdateCustomerAddressDto,
  ): Promise<CustomerAddressView> {
    const current = await this.requireAddress(company.companyId, customerId, addressId);
    if (
      dto.label === undefined &&
      dto.recipientName === undefined &&
      dto.mobile === undefined &&
      dto.province === undefined &&
      dto.city === undefined &&
      dto.addressLine === undefined &&
      dto.postalCode === undefined &&
      dto.notes === undefined &&
      dto.isDefault === undefined
    ) {
      throw AppError.validation('At least one field is required to update the address.');
    }

    const next = {
      label: dto.label !== undefined ? (assertAddressLabel(dto.label) ?? null) : current.label,
      recipientName:
        dto.recipientName !== undefined
          ? (assertAddressRecipient(dto.recipientName) ?? null)
          : current.recipientName,
      mobile:
        dto.mobile !== undefined ? (assertOptionalPhone(dto.mobile) ?? null) : current.mobile,
      province:
        dto.province !== undefined
          ? (assertAddressProvince(dto.province) ?? null)
          : current.province,
      city: dto.city !== undefined ? (assertAddressCity(dto.city) ?? null) : current.city,
      addressLine:
        dto.addressLine !== undefined
          ? (assertAddressLine(dto.addressLine) ?? null)
          : current.addressLine,
      postalCode:
        dto.postalCode !== undefined
          ? (assertAddressPostal(dto.postalCode) ?? null)
          : current.postalCode,
      notes: dto.notes !== undefined ? (assertAddressNotes(dto.notes) ?? null) : current.notes,
    };
    const wantDefault = dto.isDefault === true;

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          let previousDefaultId: string | null = null;
          if (wantDefault && !current.isDefault) {
            const previous = await tx.customerAddress.findFirst({
              where: {
                companyId: company.companyId,
                customerId,
                isDefault: true,
                archivedAt: null,
                NOT: { id: current.id },
              },
            });
            previousDefaultId = previous?.id ?? null;
            await setDefaultCustomerAddressInTx(tx, {
              companyId: company.companyId,
              customerId,
              addressId: current.id,
            });
          }

          const address = await tx.customerAddress.update({
            where: { id: current.id },
            data: {
              ...next,
              ...(wantDefault ? { isDefault: true } : {}),
            },
          });

          const before = this.addressSnapshot(current);
          const after = this.addressSnapshot(address);
          const audited = await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.CUSTOMER_ADDRESS_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.CUSTOMER_ADDRESS,
            entityId: address.id,
            before,
            after,
            metadata: { customerId },
          });

          if (audited) {
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.SALES_CUSTOMER_ADDRESS_UPDATED,
                payload: {
                  companyId: company.companyId,
                  customerId,
                  addressId: address.id,
                },
              }),
            );
          }

          if (wantDefault && !current.isDefault) {
            await this.auditService.record(tx, {
              action: AUDIT_ACTIONS.CUSTOMER_ADDRESS_DEFAULT_CHANGED,
              entityType: AUDIT_ENTITY_TYPES.CUSTOMER_ADDRESS,
              entityId: address.id,
              before: { previousAddressId: previousDefaultId },
              after: { addressId: address.id, isDefault: true },
              metadata: { customerId },
            });
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.SALES_CUSTOMER_ADDRESS_DEFAULT_CHANGED,
                payload: {
                  companyId: company.companyId,
                  customerId,
                  addressId: address.id,
                  previousAddressId: previousDefaultId,
                },
              }),
            );
          }

          return address;
        });

        return this.toAddressView(updated);
      } catch (error) {
        mapSalesUniqueViolation(error);
      }
    });
  }

  async setDefaultAddress(
    company: CompanyContext,
    customerId: string,
    addressId: string,
  ): Promise<CustomerAddressView> {
    const current = await this.requireAddress(company.companyId, customerId, addressId);
    if (current.isDefault) {
      return this.toAddressView(current);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          const previous = await tx.customerAddress.findFirst({
            where: {
              companyId: company.companyId,
              customerId,
              isDefault: true,
              archivedAt: null,
            },
          });

          await setDefaultCustomerAddressInTx(tx, {
            companyId: company.companyId,
            customerId,
            addressId: current.id,
          });

          const address = await tx.customerAddress.findUniqueOrThrow({
            where: { id: current.id },
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.CUSTOMER_ADDRESS_DEFAULT_CHANGED,
            entityType: AUDIT_ENTITY_TYPES.CUSTOMER_ADDRESS,
            entityId: address.id,
            before: { previousAddressId: previous?.id ?? null },
            after: { addressId: address.id, isDefault: true },
            metadata: { customerId },
          });

          return { address, previousAddressId: previous?.id ?? null };
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.SALES_CUSTOMER_ADDRESS_DEFAULT_CHANGED,
            payload: {
              companyId: company.companyId,
              customerId,
              addressId: updated.address.id,
              previousAddressId: updated.previousAddressId,
            },
          }),
        );

        return this.toAddressView(updated.address);
      } catch (error) {
        mapSalesUniqueViolation(error);
      }
    });
  }

  async archiveAddress(
    company: CompanyContext,
    customerId: string,
    addressId: string,
  ): Promise<CustomerAddressView> {
    const current = await this.requireAddress(company.companyId, customerId, addressId);
    if (current.archivedAt) {
      throw new AppError({
        code: ERROR_CODES.CUSTOMER_ADDRESS_ALREADY_ARCHIVED,
        message: SALES_ERROR_MESSAGES.CUSTOMER_ADDRESS_ALREADY_ARCHIVED,
        statusCode: 409,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const archived = await this.database.client.$transaction(async (tx) => {
        const address = await tx.customerAddress.update({
          where: { id: current.id },
          data: {
            archivedAt: new Date(),
            isDefault: false,
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.CUSTOMER_ADDRESS_ARCHIVED,
          entityType: AUDIT_ENTITY_TYPES.CUSTOMER_ADDRESS,
          entityId: address.id,
          before: this.addressSnapshot(current),
          after: this.addressSnapshot(address),
          metadata: { customerId },
        });

        return address;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.SALES_CUSTOMER_ADDRESS_ARCHIVED,
          payload: {
            companyId: company.companyId,
            customerId,
            addressId: archived.id,
          },
        }),
      );

      return this.toAddressView(archived);
    });
  }

  async requireCustomer(companyId: string, customerId: string): Promise<CustomerRow> {
    const row = await this.database.client.customer.findFirst({
      where: { id: customerId, companyId },
    });
    if (!row) {
      throw this.notFound();
    }
    return row;
  }

  private async changeStatus(
    company: CompanyContext,
    customerId: string,
    status: CustomerStatus,
    action: string,
  ): Promise<CustomerListItemView> {
    const current = await this.requireCustomer(company.companyId, customerId);
    if (current.status === status) {
      return this.toListView(current);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const customer = await tx.customer.update({
          where: { id: current.id },
          data: {
            status,
            archivedAt: status === CustomerStatus.INACTIVE ? new Date() : null,
          },
        });

        await this.auditService.record(tx, {
          action,
          entityType: AUDIT_ENTITY_TYPES.CUSTOMER,
          entityId: customer.id,
          before: this.customerSnapshot(current),
          after: this.customerSnapshot(customer),
        });

        return customer;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.SALES_CUSTOMER_STATUS_CHANGED,
          payload: {
            companyId: company.companyId,
            customerId: updated.id,
            type: updated.type,
            previousStatus: current.status,
            newStatus: updated.status,
          },
        }),
      );

      return this.toListView(updated);
    });
  }

  private async createAddressInTx(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      customerId: string;
      dto: CreateCustomerAddressDto | CreateCustomerAddressNestedDto;
      forceDefault: boolean;
    },
  ): Promise<AddressRow> {
    const label = assertAddressLabel(input.dto.label) ?? null;
    const recipientName = assertAddressRecipient(input.dto.recipientName) ?? null;
    const mobile = assertOptionalPhone(input.dto.mobile) ?? null;
    const province = assertAddressProvince(input.dto.province) ?? null;
    const city = assertAddressCity(input.dto.city) ?? null;
    const addressLine = assertAddressLine(input.dto.addressLine) ?? null;
    const postalCode = assertAddressPostal(input.dto.postalCode) ?? null;
    const notes = assertAddressNotes(input.dto.notes) ?? null;

    const activeCount = await tx.customerAddress.count({
      where: {
        companyId: input.companyId,
        customerId: input.customerId,
        archivedAt: null,
      },
    });
    const makeDefault =
      input.forceDefault ||
      input.dto.isDefault === true ||
      (input.dto.isDefault !== false && activeCount === 0);

    if (makeDefault) {
      await tx.customerAddress.updateMany({
        where: {
          companyId: input.companyId,
          customerId: input.customerId,
          isDefault: true,
          archivedAt: null,
        },
        data: { isDefault: false },
      });
    }

    const address = await tx.customerAddress.create({
      data: {
        companyId: input.companyId,
        customerId: input.customerId,
        label,
        recipientName,
        mobile,
        province,
        city,
        addressLine,
        postalCode,
        notes,
        isDefault: makeDefault,
      },
    });

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.CUSTOMER_ADDRESS_CREATED,
      entityType: AUDIT_ENTITY_TYPES.CUSTOMER_ADDRESS,
      entityId: address.id,
      before: null,
      after: this.addressSnapshot(address),
      metadata: { customerId: input.customerId },
    });

    if (makeDefault) {
      await this.auditService.record(tx, {
        action: AUDIT_ACTIONS.CUSTOMER_ADDRESS_DEFAULT_CHANGED,
        entityType: AUDIT_ENTITY_TYPES.CUSTOMER_ADDRESS,
        entityId: address.id,
        before: null,
        after: { customerId: input.customerId, addressId: address.id, isDefault: true },
        metadata: { customerId: input.customerId, previousAddressId: null },
      });
    }

    return address;
  }

  private async requireAddress(
    companyId: string,
    customerId: string,
    addressId: string,
  ): Promise<AddressRow> {
    await this.requireCustomer(companyId, customerId);
    const row = await this.database.client.customerAddress.findFirst({
      where: { id: addressId, companyId, customerId, archivedAt: null },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.CUSTOMER_ADDRESS_NOT_FOUND,
        message: SALES_ERROR_MESSAGES.CUSTOMER_ADDRESS_NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private optionalActorUserId(): string | null {
    return getRequestContext()?.userId ?? null;
  }

  private notFound(): AppError {
    return new AppError({
      code: ERROR_CODES.CUSTOMER_NOT_FOUND,
      message: SALES_ERROR_MESSAGES.CUSTOMER_NOT_FOUND,
      statusCode: 404,
    });
  }

  /** Audit snapshot — excludes phone/nationalId/notes PII from domain events (events use ids+type/status only). */
  private customerSnapshot(customer: CustomerRow) {
    return {
      id: customer.id,
      code: customer.code,
      type: customer.type,
      displayName: customer.displayName,
      firstName: customer.firstName,
      lastName: customer.lastName,
      businessName: customer.businessName,
      status: customer.status,
      archivedAt: customer.archivedAt?.toISOString() ?? null,
    };
  }

  private addressSnapshot(address: AddressRow) {
    return {
      id: address.id,
      customerId: address.customerId,
      label: address.label,
      province: address.province,
      city: address.city,
      isDefault: address.isDefault,
      archivedAt: address.archivedAt?.toISOString() ?? null,
    };
  }

  private toListView(row: CustomerRow): CustomerListItemView {
    return {
      id: row.id,
      companyId: row.companyId,
      code: row.code,
      type: row.type,
      displayName: row.displayName,
      firstName: row.firstName,
      lastName: row.lastName,
      businessName: row.businessName,
      mobile: row.mobile,
      phone: row.phone,
      email: row.email,
      nationalId: row.nationalId,
      taxId: row.taxId,
      registrationNumber: row.registrationNumber,
      status: row.status,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdById: row.createdById,
      archivedAt: row.archivedAt,
    };
  }

  private toAddressView(row: AddressRow): CustomerAddressView {
    return {
      id: row.id,
      companyId: row.companyId,
      customerId: row.customerId,
      label: row.label,
      recipientName: row.recipientName,
      mobile: row.mobile,
      province: row.province,
      city: row.city,
      addressLine: row.addressLine,
      postalCode: row.postalCode,
      isDefault: row.isDefault,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
    };
  }
}
