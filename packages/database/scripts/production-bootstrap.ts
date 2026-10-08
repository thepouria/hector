/**
 * Production-only first-admin bootstrap (PR-003).
 *
 * Creates:
 * - Company (slug from env, default pishteh)
 * - Permission catalog + OWNER / WAREHOUSE_OPERATOR system roles
 * - Exactly one intended OWNER admin (email from env)
 * - System transit warehouse/location
 *
 * Does NOT:
 * - Run demo seed data
 * - Create fake products / POs / stock / finance rows
 * - Print passwords
 *
 * Required env:
 *   DATABASE_URL
 *   HECTOR_BOOTSTRAP_ADMIN_EMAIL
 *   HECTOR_BOOTSTRAP_ADMIN_PASSWORD  (min 16 chars; read from env — never argv)
 * Optional:
 *   HECTOR_BOOTSTRAP_COMPANY_NAME=Pishteh
 *   HECTOR_BOOTSTRAP_COMPANY_SLUG=pishteh
 *   HECTOR_BOOTSTRAP_ADMIN_FIRST_NAME
 *   HECTOR_BOOTSTRAP_ADMIN_LAST_NAME
 *   HECTOR_BOOTSTRAP_ALLOW_PASSWORD_RESET=1  (only if admin already exists)
 *
 * Safety:
 *   Refuses NODE_ENV!=production unless HECTOR_BOOTSTRAP_ALLOW_NONPROD=1
 *   Idempotent: re-run syncs roles/permissions; does not recreate admin password
 *     unless ALLOW_PASSWORD_RESET is set.
 */

import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  CompanyMemberStatus,
  CompanyStatus,
  CurrencyCode,
  UserStatus,
} from '../src/generated/prisma/enums';
import {
  OWNER_ROLE_KEY,
  PERMISSIONS,
  PERMISSION_DEFINITIONS,
  WAREHOUSE_OPERATOR_ROLE_KEY,
  syncOwnerRolePermissions,
  syncPermissions,
} from '../src/permissions';
import { ensureSystemTransitPosition } from '../src/system-transit';

function loadRootEnv(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(__dirname, '../../../.env'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      config({ path, quiet: true });
      return;
    }
  }
}

loadRootEnv();

/** Align with apps/api PasswordHasher / prisma seed (argon2id). */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

const WAREHOUSE_OPERATOR_KEYS = [
  PERMISSIONS.WAREHOUSE_READ,
  PERMISSIONS.WAREHOUSE_RECEIPT_READ,
  PERMISSIONS.WAREHOUSE_RECEIPT_MANAGE,
  PERMISSIONS.WAREHOUSE_RECEIPT_POST,
  PERMISSIONS.WAREHOUSE_BATCH_READ,
  PERMISSIONS.WAREHOUSE_BATCH_MANAGE,
  PERMISSIONS.WAREHOUSE_PUTAWAY_READ,
  PERMISSIONS.WAREHOUSE_PUTAWAY_MANAGE,
  PERMISSIONS.WAREHOUSE_PUTAWAY_COMPLETE,
  PERMISSIONS.WAREHOUSE_STOCK_READ,
  PERMISSIONS.WAREHOUSE_TRANSFER_READ,
  PERMISSIONS.WAREHOUSE_TRANSFER_MANAGE,
  PERMISSIONS.WAREHOUSE_TRANSFER_DISPATCH,
  PERMISSIONS.WAREHOUSE_TRANSFER_COMPLETE,
  PERMISSIONS.WAREHOUSE_TRANSFER_CANCEL,
  PERMISSIONS.WAREHOUSE_CLASSIFICATION_CHANGE,
  PERMISSIONS.WAREHOUSE_ISSUE_READ,
  PERMISSIONS.WAREHOUSE_ISSUE_CREATE,
  PERMISSIONS.WAREHOUSE_ISSUE_UPDATE,
  PERMISSIONS.WAREHOUSE_ISSUE_POST,
  PERMISSIONS.WAREHOUSE_ISSUE_CANCEL,
  PERMISSIONS.WAREHOUSE_ADJUSTMENT_READ,
  PERMISSIONS.WAREHOUSE_ADJUSTMENT_CREATE,
  PERMISSIONS.WAREHOUSE_ADJUSTMENT_UPDATE,
  PERMISSIONS.WAREHOUSE_ADJUSTMENT_POST,
  PERMISSIONS.WAREHOUSE_COUNT_READ,
  PERMISSIONS.WAREHOUSE_COUNT_CREATE,
  PERMISSIONS.WAREHOUSE_COUNT_PERFORM,
  PERMISSIONS.WAREHOUSE_COUNT_SUBMIT,
  PERMISSIONS.WAREHOUSE_COUNT_POST,
  PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_READ,
  PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_CREATE_EXECUTION,
  PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_UPDATE_EXECUTION,
  PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_DISPATCH,
  PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_CANCEL_EXECUTION,
  PERMISSIONS.WAREHOUSE_RESERVATION_READ,
  PERMISSIONS.WAREHOUSE_RESERVATION_MANAGE,
  PERMISSIONS.WAREHOUSE_SCANNER_USE,
] as const;

async function syncWarehouseOperatorPermissions(prisma: PrismaClient): Promise<void> {
  const permissions = await prisma.permission.findMany({
    where: { key: { in: [...WAREHOUSE_OPERATOR_KEYS] } },
  });
  const roles = await prisma.role.findMany({
    where: { key: WAREHOUSE_OPERATOR_ROLE_KEY, deletedAt: null },
    select: { id: true },
  });
  for (const role of roles) {
    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
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

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main(): Promise<void> {
  const nodeEnv = process.env.NODE_ENV ?? '';
  if (nodeEnv !== 'production' && process.env.HECTOR_BOOTSTRAP_ALLOW_NONPROD !== '1') {
    throw new Error(
      'Refusing bootstrap: set NODE_ENV=production (or HECTOR_BOOTSTRAP_ALLOW_NONPROD=1 for isolated tests)',
    );
  }

  if (process.env.DEV_SEED_PASSWORD) {
    throw new Error('Refusing bootstrap while DEV_SEED_PASSWORD is set (demo seed must not run in prod)');
  }

  const connectionString = requireEnv('DATABASE_URL');
  const email = requireEnv('HECTOR_BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  const password = requireEnv('HECTOR_BOOTSTRAP_ADMIN_PASSWORD');
  if (password.length < 16) {
    throw new Error('HECTOR_BOOTSTRAP_ADMIN_PASSWORD must be at least 16 characters');
  }

  const companyName = process.env.HECTOR_BOOTSTRAP_COMPANY_NAME?.trim() || 'Pishteh';
  const companySlug = process.env.HECTOR_BOOTSTRAP_COMPANY_SLUG?.trim() || 'pishteh';
  const firstName = process.env.HECTOR_BOOTSTRAP_ADMIN_FIRST_NAME?.trim() || 'Admin';
  const lastName = process.env.HECTOR_BOOTSTRAP_ADMIN_LAST_NAME?.trim() || 'Owner';
  const allowPasswordReset = process.env.HECTOR_BOOTSTRAP_ALLOW_PASSWORD_RESET === '1';

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    await syncPermissions(prisma);

    const company = await prisma.company.upsert({
      where: { slug: companySlug },
      update: {
        name: companyName,
        baseCurrency: CurrencyCode.IRR,
        timezone: 'Asia/Tehran',
        status: CompanyStatus.ACTIVE,
        deletedAt: null,
      },
      create: {
        name: companyName,
        slug: companySlug,
        baseCurrency: CurrencyCode.IRR,
        timezone: 'Asia/Tehran',
        status: CompanyStatus.ACTIVE,
      },
    });

    await prisma.role.upsert({
      where: {
        companyId_key: { companyId: company.id, key: OWNER_ROLE_KEY },
      },
      update: {
        name: 'Owner',
        description: 'Full access to company capabilities. Permission set is code-managed.',
        isSystem: true,
        deletedAt: null,
      },
      create: {
        companyId: company.id,
        key: OWNER_ROLE_KEY,
        name: 'Owner',
        description: 'Full access to company capabilities. Permission set is code-managed.',
        isSystem: true,
      },
    });

    await prisma.role.upsert({
      where: {
        companyId_key: { companyId: company.id, key: WAREHOUSE_OPERATOR_ROLE_KEY },
      },
      update: {
        name: 'Warehouse Operator',
        description: 'Warehouse operations role (no finance/valuation by default).',
        isSystem: true,
        deletedAt: null,
      },
      create: {
        companyId: company.id,
        key: WAREHOUSE_OPERATOR_ROLE_KEY,
        name: 'Warehouse Operator',
        description: 'Warehouse operations role (no finance/valuation by default).',
        isSystem: true,
      },
    });

    await syncOwnerRolePermissions(prisma);
    await syncWarehouseOperatorPermissions(prisma);
    await ensureSystemTransitPosition(prisma, company.id);

    const ownerRole = await prisma.role.findUniqueOrThrow({
      where: {
        companyId_key: { companyId: company.id, key: OWNER_ROLE_KEY },
      },
    });

    const existing = await prisma.user.findUnique({ where: { email } });
    let userId: string;
    let created = false;

    if (existing && !existing.deletedAt) {
      if (allowPasswordReset) {
        const passwordHash = await hashPassword(password);
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash,
            firstName,
            lastName,
            status: UserStatus.ACTIVE,
            deletedAt: null,
          },
        });
        console.log('Admin user password rotated (HECTOR_BOOTSTRAP_ALLOW_PASSWORD_RESET=1).');
      } else {
        console.log('Admin user already exists — leaving password unchanged (idempotent).');
      }
      userId = existing.id;
    } else if (existing?.deletedAt) {
      const passwordHash = await hashPassword(password);
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          firstName,
          lastName,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        },
      });
      userId = existing.id;
      created = true;
    } else {
      const passwordHash = await hashPassword(password);
      const user = await prisma.user.create({
        data: {
          email,
          firstName,
          lastName,
          passwordHash,
          status: UserStatus.ACTIVE,
        },
      });
      userId = user.id;
      created = true;
    }

    const membership = await prisma.companyMember.upsert({
      where: {
        companyId_userId: { companyId: company.id, userId },
      },
      update: { status: CompanyMemberStatus.ACTIVE },
      create: {
        companyId: company.id,
        userId,
        status: CompanyMemberStatus.ACTIVE,
      },
    });

    await prisma.companyMemberRole.upsert({
      where: {
        companyMemberId_roleId: {
          companyMemberId: membership.id,
          roleId: ownerRole.id,
        },
      },
      update: {},
      create: {
        companyMemberId: membership.id,
        roleId: ownerRole.id,
      },
    });

    console.log('Production bootstrap completed.');
    console.log(`Company: ${company.name} (${company.slug})`);
    console.log(`Admin email: ${email}`);
    console.log(`Admin created: ${created}`);
    console.log(`Roles: ${OWNER_ROLE_KEY}, ${WAREHOUSE_OPERATOR_ROLE_KEY}`);
    console.log(`Permissions catalog: ${PERMISSION_DEFINITIONS.length}`);
    console.log(
      'Rotate the temporary admin password after first login (no forced-change field in schema).',
    );
    console.log('Password was not written to logs.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
