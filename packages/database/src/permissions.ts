/**
 * Hector permission registry — single source of truth for Phase 0.6+.
 * Permissions are platform-defined capabilities (not company-specific).
 * Keys are stable machine identifiers; do not rename casually.
 */

export const PERMISSIONS = {
  COMPANY_READ: 'company.read',
  COMPANY_UPDATE: 'company.update',

  MEMBER_READ: 'member.read',
  MEMBER_CREATE: 'member.create',
  MEMBER_UPDATE: 'member.update',
  MEMBER_REMOVE: 'member.remove',

  ROLE_READ: 'role.read',
  ROLE_CREATE: 'role.create',
  ROLE_UPDATE: 'role.update',
  ROLE_DELETE: 'role.delete',
  ROLE_ASSIGN: 'role.assign',
  ROLE_PERMISSIONS_UPDATE: 'role.permissions.update',

  PERMISSION_READ: 'permission.read',
  AUDIT_READ: 'audit.read',

  CATALOG_READ: 'catalog.read',
  CATALOG_MANAGE: 'catalog.manage',

  PURCHASING_READ: 'purchasing.read',
  PURCHASING_CREATE: 'purchasing.create',
  PURCHASING_MANAGE: 'purchasing.manage',
  PURCHASING_APPROVE: 'purchasing.approve',
  PURCHASING_CANCEL: 'purchasing.cancel',
  PURCHASING_PO_CORRECT: 'purchasing.po.correct',
  PURCHASING_PO_SHORT_CLOSE: 'purchasing.po.short_close',
  PURCHASING_DISCREPANCY_MANAGE: 'purchasing.discrepancy.manage',
  PURCHASING_RETURN_CREATE: 'purchasing.return.create',
  PURCHASING_RETURN_APPROVE: 'purchasing.return.approve',
  PURCHASING_RETURN_CANCEL: 'purchasing.return.cancel',

  WAREHOUSE_READ: 'warehouse.read',
  WAREHOUSE_MANAGE: 'warehouse.manage',

  WAREHOUSE_RECEIPT_READ: 'warehouse.receipt.read',
  WAREHOUSE_RECEIPT_MANAGE: 'warehouse.receipt.manage',
  WAREHOUSE_RECEIPT_POST: 'warehouse.receipt.post',

  WAREHOUSE_BATCH_READ: 'warehouse.batch.read',
  WAREHOUSE_BATCH_MANAGE: 'warehouse.batch.manage',

  WAREHOUSE_PUTAWAY_READ: 'warehouse.putaway.read',
  WAREHOUSE_PUTAWAY_MANAGE: 'warehouse.putaway.manage',
  WAREHOUSE_PUTAWAY_COMPLETE: 'warehouse.putaway.complete',

  WAREHOUSE_STOCK_READ: 'warehouse.stock.read',

  WAREHOUSE_TRANSFER_READ: 'warehouse.transfer.read',
  WAREHOUSE_TRANSFER_MANAGE: 'warehouse.transfer.manage',
  WAREHOUSE_TRANSFER_DISPATCH: 'warehouse.transfer.dispatch',
  WAREHOUSE_TRANSFER_COMPLETE: 'warehouse.transfer.complete',
  WAREHOUSE_TRANSFER_CANCEL: 'warehouse.transfer.cancel',

  WAREHOUSE_CLASSIFICATION_CHANGE: 'warehouse.classification.change',

  WAREHOUSE_ISSUE_READ: 'warehouse.issue.read',
  WAREHOUSE_ISSUE_CREATE: 'warehouse.issue.create',
  WAREHOUSE_ISSUE_UPDATE: 'warehouse.issue.update',
  WAREHOUSE_ISSUE_POST: 'warehouse.issue.post',
  WAREHOUSE_ISSUE_CANCEL: 'warehouse.issue.cancel',

  WAREHOUSE_ADJUSTMENT_READ: 'warehouse.adjustment.read',
  WAREHOUSE_ADJUSTMENT_CREATE: 'warehouse.adjustment.create',
  WAREHOUSE_ADJUSTMENT_UPDATE: 'warehouse.adjustment.update',
  WAREHOUSE_ADJUSTMENT_APPROVE: 'warehouse.adjustment.approve',
  WAREHOUSE_ADJUSTMENT_POST: 'warehouse.adjustment.post',
  WAREHOUSE_ADJUSTMENT_CANCEL: 'warehouse.adjustment.cancel',

  WAREHOUSE_COUNT_READ: 'warehouse.count.read',
  WAREHOUSE_COUNT_CREATE: 'warehouse.count.create',
  WAREHOUSE_COUNT_PERFORM: 'warehouse.count.perform',
  WAREHOUSE_COUNT_SUBMIT: 'warehouse.count.submit',
  WAREHOUSE_COUNT_APPROVE: 'warehouse.count.approve',
  WAREHOUSE_COUNT_POST: 'warehouse.count.post',
  WAREHOUSE_COUNT_CANCEL: 'warehouse.count.cancel',

  WAREHOUSE_SUPPLIER_RETURN_READ: 'warehouse.supplier_return.read',
  WAREHOUSE_SUPPLIER_RETURN_CREATE_EXECUTION: 'warehouse.supplier_return.create_execution',
  WAREHOUSE_SUPPLIER_RETURN_UPDATE_EXECUTION: 'warehouse.supplier_return.update_execution',
  WAREHOUSE_SUPPLIER_RETURN_DISPATCH: 'warehouse.supplier_return.dispatch',
  WAREHOUSE_SUPPLIER_RETURN_CANCEL_EXECUTION: 'warehouse.supplier_return.cancel_execution',

  WAREHOUSE_RESERVATION_READ: 'warehouse.reservation.read',
  WAREHOUSE_RESERVATION_MANAGE: 'warehouse.reservation.manage',
  WAREHOUSE_VALUATION_READ: 'warehouse.valuation.read',
  WAREHOUSE_COST_LAYER_READ: 'warehouse.cost_layer.read',

  /** Floor scanner workspace access (resolvers + navigation). Mutations still need flow permissions. */
  WAREHOUSE_SCANNER_USE: 'warehouse.scanner.use',

  // Phase 4.1 — Finance Core permission namespace (workflows land in 4.2+)
  FINANCE_ACCOUNTS_READ: 'finance.accounts.read',
  FINANCE_ACCOUNTS_MANAGE: 'finance.accounts.manage',
  FINANCE_TRANSACTIONS_READ: 'finance.transactions.read',
  FINANCE_TRANSACTIONS_CREATE: 'finance.transactions.create',
  FINANCE_TRANSFERS_READ: 'finance.transfers.read',
  FINANCE_TRANSFERS_CREATE: 'finance.transfers.create',
  FINANCE_CAPITAL_READ: 'finance.capital.read',
  FINANCE_CAPITAL_MANAGE: 'finance.capital.manage',
  FINANCE_LOANS_READ: 'finance.loans.read',
  FINANCE_LOANS_MANAGE: 'finance.loans.manage',
  FINANCE_PAYABLES_READ: 'finance.payables.read',
  FINANCE_PAYABLES_MANAGE: 'finance.payables.manage',
  FINANCE_PAYMENTS_READ: 'finance.payments.read',
  FINANCE_PAYMENTS_CREATE: 'finance.payments.create',
  FINANCE_RECEIPTS_READ: 'finance.receipts.read',
  FINANCE_RECEIPTS_CREATE: 'finance.receipts.create',
  FINANCE_EXPENSES_READ: 'finance.expenses.read',
  FINANCE_EXPENSES_MANAGE: 'finance.expenses.manage',
  FINANCE_FX_READ: 'finance.fx.read',
  FINANCE_FX_MANAGE: 'finance.fx.manage',
  FINANCE_JOURNALS_READ: 'finance.journals.read',
  FINANCE_JOURNALS_POST: 'finance.journals.post',
  FINANCE_AUDIT_READ: 'finance.audit.read',
  FINANCE_DASHBOARD_READ: 'finance.dashboard.read',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_DEFINITIONS: ReadonlyArray<{
  key: PermissionKey;
  description: string;
}> = [
  { key: PERMISSIONS.COMPANY_READ, description: 'Read company profile and settings' },
  { key: PERMISSIONS.COMPANY_UPDATE, description: 'Update company profile and settings' },
  { key: PERMISSIONS.MEMBER_READ, description: 'List and view company members' },
  { key: PERMISSIONS.MEMBER_CREATE, description: 'Add existing users as company members' },
  { key: PERMISSIONS.MEMBER_UPDATE, description: 'Update company member status' },
  { key: PERMISSIONS.MEMBER_REMOVE, description: 'Remove company members' },
  { key: PERMISSIONS.ROLE_READ, description: 'List and view company roles' },
  { key: PERMISSIONS.ROLE_CREATE, description: 'Create company roles' },
  { key: PERMISSIONS.ROLE_UPDATE, description: 'Update company role metadata' },
  { key: PERMISSIONS.ROLE_DELETE, description: 'Delete custom company roles' },
  { key: PERMISSIONS.ROLE_ASSIGN, description: 'Assign roles to company members' },
  {
    key: PERMISSIONS.ROLE_PERMISSIONS_UPDATE,
    description: 'Replace the permission set of a custom company role',
  },
  { key: PERMISSIONS.PERMISSION_READ, description: 'Read the Hector permission catalog' },
  { key: PERMISSIONS.AUDIT_READ, description: 'Read company audit logs' },
  { key: PERMISSIONS.CATALOG_READ, description: 'Read company catalog (brands, categories, products, SKUs, barcodes)' },
  {
    key: PERMISSIONS.CATALOG_MANAGE,
    description: 'Create and update company catalog (brands, categories, products, SKUs, barcodes)',
  },
  { key: PERMISSIONS.PURCHASING_READ, description: 'Read suppliers and purchasing master data' },
  { key: PERMISSIONS.PURCHASING_CREATE, description: 'Create suppliers, supplier offers, and draft purchase orders' },
  {
    key: PERMISSIONS.PURCHASING_MANAGE,
    description:
      'Update suppliers, contacts, notes, supplier lifecycle; edit draft purchase orders and mark them ordered',
  },
  { key: PERMISSIONS.PURCHASING_APPROVE, description: 'Approve draft purchase orders' },
  { key: PERMISSIONS.PURCHASING_CANCEL, description: 'Cancel purchase orders' },
  {
    key: PERMISSIONS.PURCHASING_PO_CORRECT,
    description: 'Apply explicit commercial corrections to committed purchase orders',
  },
  {
    key: PERMISSIONS.PURCHASING_PO_SHORT_CLOSE,
    description: 'Short-close remaining unfulfilled purchase order quantities',
  },
  {
    key: PERMISSIONS.PURCHASING_DISCREPANCY_MANAGE,
    description: 'Record and resolve purchasing quantity discrepancies',
  },
  {
    key: PERMISSIONS.PURCHASING_RETURN_CREATE,
    description: 'Create draft purchase returns to supplier',
  },
  {
    key: PERMISSIONS.PURCHASING_RETURN_APPROVE,
    description: 'Approve purchase returns (commercial intent; not stock movement)',
  },
  {
    key: PERMISSIONS.PURCHASING_RETURN_CANCEL,
    description: 'Cancel purchase return plans',
  },
  {
    key: PERMISSIONS.WAREHOUSE_READ,
    description: 'Read warehouses (master data; later stock/receipt reads)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_MANAGE,
    description: 'Create and update warehouses, lifecycle, and company default warehouse',
  },
  {
    key: PERMISSIONS.WAREHOUSE_RECEIPT_READ,
    description: 'Read goods receipts and purchase receiving progress',
  },
  {
    key: PERMISSIONS.WAREHOUSE_RECEIPT_MANAGE,
    description: 'Create and edit draft goods receipts (items, notes, cancel draft)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_RECEIPT_POST,
    description: 'Post goods receipts as physical receipt facts (irreversible in Phase 3.4)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_BATCH_READ,
    description: 'Read warehouse batches / lots (identity; not current stock)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_BATCH_MANAGE,
    description: 'Create and update batch metadata (supplier batch, expiry); not inventory',
  },
  {
    key: PERMISSIONS.WAREHOUSE_PUTAWAY_READ,
    description: 'Read putaways and pending putaway queue (not current stock)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_PUTAWAY_MANAGE,
    description: 'Create and edit draft/in-progress putaways (placement allocations)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_PUTAWAY_COMPLETE,
    description:
      'Complete putaways as historical placement facts and post RECEIVE inventory movements',
  },
  {
    key: PERMISSIONS.WAREHOUSE_STOCK_READ,
    description: 'Read inventory On Hand balances and movement ledger history',
  },
  {
    key: PERMISSIONS.WAREHOUSE_TRANSFER_READ,
    description: 'Read internal stock transfers',
  },
  {
    key: PERMISSIONS.WAREHOUSE_TRANSFER_MANAGE,
    description: 'Create and edit draft internal stock transfers (no inventory movement)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_TRANSFER_DISPATCH,
    description: 'Dispatch transfers (source → transit ledger pairs)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_TRANSFER_COMPLETE,
    description: 'Complete transfers (transit → destination ledger pairs)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_TRANSFER_CANCEL,
    description: 'Cancel draft transfers or return in-transit stock to source',
  },
  {
    key: PERMISSIONS.WAREHOUSE_CLASSIFICATION_CHANGE,
    description:
      'Change stock classification via ledger reclassification (company total conserved)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_ISSUE_READ,
    description: 'Read manual stock issues (non-sales outbound documents)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_ISSUE_CREATE,
    description: 'Create draft stock issues',
  },
  {
    key: PERMISSIONS.WAREHOUSE_ISSUE_UPDATE,
    description: 'Update draft stock issues (header and items; no inventory movement)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_ISSUE_POST,
    description: 'Post stock issues (removes stock from company inventory via Ledger)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_ISSUE_CANCEL,
    description: 'Cancel draft stock issues (no inventory effect)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_ADJUSTMENT_READ,
    description: 'Read inventory adjustments (manual corrections)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_ADJUSTMENT_CREATE,
    description: 'Create draft inventory adjustments',
  },
  {
    key: PERMISSIONS.WAREHOUSE_ADJUSTMENT_UPDATE,
    description: 'Update draft inventory adjustments and submit for approval',
  },
  {
    key: PERMISSIONS.WAREHOUSE_ADJUSTMENT_APPROVE,
    description: 'Approve or reject inventory adjustments pending approval',
  },
  {
    key: PERMISSIONS.WAREHOUSE_ADJUSTMENT_POST,
    description: 'Post approved inventory adjustments (ADJUSTMENT_IN/OUT via Ledger)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_ADJUSTMENT_CANCEL,
    description: 'Cancel draft/pending inventory adjustments (no inventory effect)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_COUNT_READ,
    description: 'Read stock counts / cycle counts',
  },
  {
    key: PERMISSIONS.WAREHOUSE_COUNT_CREATE,
    description: 'Create and configure draft stock counts',
  },
  {
    key: PERMISSIONS.WAREHOUSE_COUNT_PERFORM,
    description: 'Start counts and record physical quantities (scanner/manual)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_COUNT_SUBMIT,
    description: 'Submit completed stock counts for manager review',
  },
  {
    key: PERMISSIONS.WAREHOUSE_COUNT_APPROVE,
    description: 'Approve, reject, or request recount on submitted stock counts',
  },
  {
    key: PERMISSIONS.WAREHOUSE_COUNT_POST,
    description: 'Post approved stock counts (STOCK_COUNT_ADJUSTMENT via Ledger)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_COUNT_CANCEL,
    description: 'Cancel stock counts before posting (no inventory effect)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_READ,
    description: 'Read approved purchase returns and warehouse supplier-return executions',
  },
  {
    key: PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_CREATE_EXECUTION,
    description: 'Create draft supplier return executions from approved purchase returns',
  },
  {
    key: PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_UPDATE_EXECUTION,
    description: 'Update draft supplier return execution allocations (no inventory movement)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_DISPATCH,
    description: 'Dispatch supplier return executions (RETURN_OUT via Inventory Ledger)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_CANCEL_EXECUTION,
    description: 'Cancel draft supplier return executions (no inventory effect)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_RESERVATION_READ,
    description: 'Read inventory reservations and SELLABLE availability',
  },
  {
    key: PERMISSIONS.WAREHOUSE_RESERVATION_MANAGE,
    description: 'Create, release, adjust, and expire inventory reservations',
  },
  {
    key: PERMISSIONS.WAREHOUSE_VALUATION_READ,
    description: 'Read inventory valuation summaries (acquisition cost sensitive)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_COST_LAYER_READ,
    description: 'Read FIFO cost layers and layer consumption traces (cost sensitive)',
  },
  {
    key: PERMISSIONS.WAREHOUSE_SCANNER_USE,
    description:
      'Access Scanner Center and barcode resolvers (mutations still require flow permissions)',
  },
  { key: PERMISSIONS.FINANCE_ACCOUNTS_READ, description: 'Read financial accounts and balances' },
  {
    key: PERMISSIONS.FINANCE_ACCOUNTS_MANAGE,
    description: 'Create and manage financial accounts (cash/bank/wallet masters)',
  },
  {
    key: PERMISSIONS.FINANCE_TRANSACTIONS_READ,
    description: 'Read financial money movements and transfers',
  },
  {
    key: PERMISSIONS.FINANCE_TRANSACTIONS_CREATE,
    description: 'Create draft / post money movements within policy',
  },
  {
    key: PERMISSIONS.FINANCE_TRANSFERS_READ,
    description: 'Read same-currency financial account transfers',
  },
  {
    key: PERMISSIONS.FINANCE_TRANSFERS_CREATE,
    description: 'Create, post, cancel, and reverse financial account transfers',
  },
  { key: PERMISSIONS.FINANCE_CAPITAL_READ, description: 'Read capital / equity funding records' },
  {
    key: PERMISSIONS.FINANCE_CAPITAL_MANAGE,
    description: 'Record owner/partner capital contributions (not revenue)',
  },
  { key: PERMISSIONS.FINANCE_LOANS_READ, description: 'Read loans and borrowings' },
  {
    key: PERMISSIONS.FINANCE_LOANS_MANAGE,
    description: 'Record loans, repayments, and loan master data',
  },
  { key: PERMISSIONS.FINANCE_PAYABLES_READ, description: 'Read supplier payables and outstanding' },
  {
    key: PERMISSIONS.FINANCE_PAYABLES_MANAGE,
    description: 'Manage supplier payable recognition/adjustments within Finance policy',
  },
  { key: PERMISSIONS.FINANCE_PAYMENTS_READ, description: 'Read standalone financial payments (money-out)' },
  {
    key: PERMISSIONS.FINANCE_PAYMENTS_CREATE,
    description: 'Create / post / reverse standalone financial payments',
  },
  { key: PERMISSIONS.FINANCE_RECEIPTS_READ, description: 'Read standalone financial receipts (money-in)' },
  {
    key: PERMISSIONS.FINANCE_RECEIPTS_CREATE,
    description: 'Create / post / reverse standalone financial receipts',
  },
  { key: PERMISSIONS.FINANCE_EXPENSES_READ, description: 'Read expense records' },
  { key: PERMISSIONS.FINANCE_EXPENSES_MANAGE, description: 'Create and manage expense records' },
  { key: PERMISSIONS.FINANCE_FX_READ, description: 'Read FX rates, conversions, positions, and valuation' },
  { key: PERMISSIONS.FINANCE_FX_MANAGE, description: 'Create FX rates, convert currency, post/reverse FX conversions' },
  { key: PERMISSIONS.FINANCE_JOURNALS_READ, description: 'Read accounting journals and lines' },
  { key: PERMISSIONS.FINANCE_JOURNALS_POST, description: 'Post / reverse accounting journals' },
  { key: PERMISSIONS.FINANCE_AUDIT_READ, description: 'Read Finance-domain audit trail' },
  { key: PERMISSIONS.FINANCE_DASHBOARD_READ, description: 'Read Finance dashboard summaries' },
];

export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = PERMISSION_DEFINITIONS.map(
  (definition) => definition.key,
);

/** Obsolete Phase 0.2 development keys superseded by later phases. */
export const OBSOLETE_PERMISSION_KEYS = ['member.invite'] as const;

export const OWNER_ROLE_KEY = 'OWNER';
export const WAREHOUSE_OPERATOR_ROLE_KEY = 'WAREHOUSE_OPERATOR';

/** Minimal Prisma-shaped client used by seed/sync helpers. */
export type PermissionSyncClient = {
  permission: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    upsert: (args: any) => Promise<{ id: string; key: string }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany: (args: any) => Promise<Array<{ id: string; key: string }>>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deleteMany: (args: any) => Promise<unknown>;
  };
  role: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany: (args: any) => Promise<Array<{ id: string; companyId: string }>>;
  };
  rolePermission: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    upsert: (args: any) => Promise<unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deleteMany: (args: any) => Promise<unknown>;
  };
};

/**
 * Upserts registered permissions and removes obsolete development keys.
 */
export async function syncPermissions(client: PermissionSyncClient): Promise<void> {
  for (const definition of PERMISSION_DEFINITIONS) {
    await client.permission.upsert({
      where: { key: definition.key },
      update: { description: definition.description },
      create: {
        key: definition.key,
        description: definition.description,
      },
    });
  }

  await client.rolePermission.deleteMany({
    where: {
      permission: {
        key: { in: [...OBSOLETE_PERMISSION_KEYS] },
      },
    },
  });

  await client.permission.deleteMany({
    where: {
      key: { in: [...OBSOLETE_PERMISSION_KEYS] },
    },
  });
}

/**
 * Ensures every non-deleted OWNER system role has every registered permission.
 * Safe across multiple companies.
 */
export async function syncOwnerRolePermissions(client: PermissionSyncClient): Promise<void> {
  const permissions = await client.permission.findMany({
    where: {
      key: { in: [...ALL_PERMISSION_KEYS] },
    },
  });

  const ownerRoles = await client.role.findMany({
    where: {
      key: OWNER_ROLE_KEY,
      deletedAt: null,
    },
    select: {
      id: true,
      companyId: true,
    },
  });

  for (const role of ownerRoles) {
    for (const permission of permissions) {
      await client.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id,
        },
      });
    }
  }
}
