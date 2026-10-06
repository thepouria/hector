/**
 * Prisma nested User payloads can collapse to `never` under TypeScript when the
 * User model has a very large relation graph (Phase 4 Finance). Narrow at the
 * boundary so call sites stay type-safe for display fields.
 */
export type PrismaUserDisplay = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
};

export function asPrismaUserDisplay(user: unknown): PrismaUserDisplay {
  return user as PrismaUserDisplay;
}

export function prismaUserDisplayName(user: unknown): string {
  const u = asPrismaUserDisplay(user);
  return `${u.firstName} ${u.lastName}`.trim() || u.email;
}
