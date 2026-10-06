/**
 * Company system transit warehouse + TRANSIT location (Phase 3.11).
 * Holds inventory between transfer dispatch and completion.
 * Not a user-editable shelf; excluded from normal warehouse lists.
 */
import { Prisma, WarehouseLocationType, WarehouseStatus } from './generated/prisma/client';

export const SYSTEM_TRANSIT_WAREHOUSE_CODE = 'SYS-TRANSIT';
export const SYSTEM_TRANSIT_LOCATION_CODE = 'IN-TRANSIT';

export type SystemTransitPosition = {
  warehouseId: string;
  locationId: string;
};

function transitBarcodeForCompany(companyId: string): string {
  const compact = companyId.replace(/-/g, '').toUpperCase();
  return `LOC-SYS-TRF-${compact.slice(0, 16)}`;
}

/**
 * Idempotently ensures the company has a system transit warehouse + TRANSIT location.
 * Safe to call from seed, transfer dispatch, and company bootstrap.
 */
export async function ensureSystemTransitPosition(
  tx: Prisma.TransactionClient | { warehouse: Prisma.WarehouseDelegate; warehouseLocation: Prisma.WarehouseLocationDelegate },
  companyId: string,
): Promise<SystemTransitPosition> {
  const warehouse = await tx.warehouse.upsert({
    where: {
      companyId_code: { companyId, code: SYSTEM_TRANSIT_WAREHOUSE_CODE },
    },
    update: {
      isSystem: true,
      isDefault: false,
      status: WarehouseStatus.ACTIVE,
      name: 'System Transit',
    },
    create: {
      companyId,
      code: SYSTEM_TRANSIT_WAREHOUSE_CODE,
      name: 'System Transit',
      status: WarehouseStatus.ACTIVE,
      isDefault: false,
      isSystem: true,
      notes: 'SYSTEM: in-transit inventory for internal stock transfers (Phase 3.11)',
    },
    select: { id: true },
  });

  const barcode = transitBarcodeForCompany(companyId);
  const existing = await tx.warehouseLocation.findUnique({
    where: {
      companyId_warehouseId_code: {
        companyId,
        warehouseId: warehouse.id,
        code: SYSTEM_TRANSIT_LOCATION_CODE,
      },
    },
    select: { id: true },
  });
  if (existing) {
    return { warehouseId: warehouse.id, locationId: existing.id };
  }

  try {
    const location = await tx.warehouseLocation.create({
      data: {
        companyId,
        warehouseId: warehouse.id,
        parentId: null,
        type: WarehouseLocationType.TRANSIT,
        code: SYSTEM_TRANSIT_LOCATION_CODE,
        name: 'In Transit',
        barcode,
        status: WarehouseStatus.ACTIVE,
        sortOrder: 0,
        notes: 'SYSTEM: transfer transit position — not a physical shelf',
      },
      select: { id: true },
    });
    return { warehouseId: warehouse.id, locationId: location.id };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const again = await tx.warehouseLocation.findUniqueOrThrow({
        where: {
          companyId_warehouseId_code: {
            companyId,
            warehouseId: warehouse.id,
            code: SYSTEM_TRANSIT_LOCATION_CODE,
          },
        },
        select: { id: true },
      });
      return { warehouseId: warehouse.id, locationId: again.id };
    }
    throw error;
  }
}
