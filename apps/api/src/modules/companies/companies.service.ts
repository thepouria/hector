import { Injectable } from '@nestjs/common';
import { CompanyMemberStatus, CompanyStatus } from '@hector/database';
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
import { auditSnapshotsEqual } from '../audit/serializers/audit-sanitizer';
import { buildCompanyEditableSnapshot } from '../audit/serializers/audit-snapshots';
import { COMPANY_ERROR_MESSAGES } from './companies.constants';
import { CompanyContextService } from './company-context.service';
import type { UpdateCompanyDto } from './dto/update-company.dto';
import type { CompanyContext, CompanyView } from './types/company.types';

const VALID_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

@Injectable()
export class CompaniesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly companyContextService: CompanyContextService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async listForUser(userId: string): Promise<CompanyView[]> {
    const memberships = await this.database.client.companyMember.findMany({
      where: {
        userId,
        status: CompanyMemberStatus.ACTIVE,
        company: {
          status: CompanyStatus.ACTIVE,
          deletedAt: null,
        },
      },
      include: {
        company: true,
      },
      orderBy: {
        company: {
          name: 'asc',
        },
      },
    });

    return memberships.map((membership) => this.toCompanyView(membership.company));
  }

  async getInContext(company: CompanyContext, pathCompanyId: string): Promise<CompanyView> {
    this.assertPathMatchesContext(company.companyId, pathCompanyId);

    const record = await this.database.client.company.findFirst({
      where: {
        id: company.companyId,
        status: CompanyStatus.ACTIVE,
        deletedAt: null,
      },
    });

    if (!record) {
      throw new AppError({
        code: ERROR_CODES.COMPANY_NOT_FOUND,
        message: COMPANY_ERROR_MESSAGES.COMPANY_NOT_FOUND,
        statusCode: 404,
      });
    }

    return this.toCompanyView(record);
  }

  async updateInContext(
    company: CompanyContext,
    pathCompanyId: string,
    dto: UpdateCompanyDto,
  ): Promise<CompanyView> {
    this.assertPathMatchesContext(company.companyId, pathCompanyId);

    if (dto.name === undefined && dto.timezone === undefined) {
      throw AppError.validation('At least one field is required to update the company.');
    }

    if (dto.timezone !== undefined && !VALID_TIMEZONES.has(dto.timezone)) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: COMPANY_ERROR_MESSAGES.INVALID_TIMEZONE,
        statusCode: 400,
      });
    }

    return commitThenPublish(this.eventBus, async (events) =>
      this.companyContextService.withCompanyLock(company.companyId, async (tx) => {
        const current = await tx.company.findUniqueOrThrow({
          where: { id: company.companyId },
        });

        const before = buildCompanyEditableSnapshot(current);
        const nextName = dto.name !== undefined ? dto.name.trim() : current.name;
        const nextTimezone = dto.timezone !== undefined ? dto.timezone : current.timezone;
        const after = buildCompanyEditableSnapshot({
          name: nextName,
          timezone: nextTimezone,
        });

        const updated = await tx.company.update({
          where: { id: company.companyId },
          data: {
            ...(dto.name !== undefined ? { name: nextName } : {}),
            ...(dto.timezone !== undefined ? { timezone: nextTimezone } : {}),
          },
        });

        const audited = await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.COMPANY_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.COMPANY,
          entityId: updated.id,
          before,
          after,
        });

        if (audited) {
          const beforeRecord = before as Record<string, unknown>;
          const afterRecord = after as Record<string, unknown>;
          const changedFields = Object.keys(beforeRecord).filter(
            (key) => !auditSnapshotsEqual(beforeRecord[key], afterRecord[key]),
          );
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.COMPANY_UPDATED,
              payload: {
                companyId: updated.id,
                changedFields,
              },
            }),
          );
        }

        return this.toCompanyView(updated);
      }),
    );
  }

  private assertPathMatchesContext(contextCompanyId: string, pathCompanyId: string): void {
    if (contextCompanyId !== pathCompanyId) {
      throw new AppError({
        code: ERROR_CODES.COMPANY_NOT_FOUND,
        message: COMPANY_ERROR_MESSAGES.COMPANY_NOT_FOUND,
        statusCode: 404,
      });
    }
  }

  private toCompanyView(company: {
    id: string;
    name: string;
    slug: string;
    baseCurrency: string;
    timezone: string;
    status: string;
  }): CompanyView {
    return {
      id: company.id,
      name: company.name,
      slug: company.slug,
      baseCurrency: company.baseCurrency,
      timezone: company.timezone,
      status: company.status,
    };
  }
}
