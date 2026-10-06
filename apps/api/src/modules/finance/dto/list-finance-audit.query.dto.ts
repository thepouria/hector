import { ListAuditLogsQueryDto } from '../../audit/dto/list-audit-logs.query.dto';

/**
 * Same filters as global audit list.
 * entityType outside the finance set is rejected by AuditService.restrictEntityTypes (400).
 */
export class ListFinanceAuditQueryDto extends ListAuditLogsQueryDto {}
