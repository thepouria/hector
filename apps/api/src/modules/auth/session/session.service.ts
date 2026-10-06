import { Injectable } from '@nestjs/common';
import type { Session, User } from '@hector/database';
import { DatabaseService } from '../../../infrastructure/database/database.service';
import { RefreshTokenService } from '../tokens/refresh-token.service';

export type CreateSessionInput = {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  expiresAt: Date;
  refreshTokenHash: string;
};

@Injectable()
export class SessionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  create(input: CreateSessionInput): Promise<Session> {
    return this.database.client.session.create({
      data: {
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        expiresAt: input.expiresAt,
        lastUsedAt: new Date(),
      },
    });
  }

  findById(sessionId: string): Promise<(Session & { user: User }) | null> {
    return this.database.client.session.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });
  }

  listForUser(userId: string): Promise<Session[]> {
    return this.database.client.session.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  /**
   * Atomically rotates the refresh token hash only if the current hash still matches.
   * Concurrent refresh attempts: only one updateMany count === 1 succeeds.
   */
  async rotateRefreshToken(params: {
    sessionId: string;
    expectedHash: string;
    nextHash: string;
  }): Promise<boolean> {
    const result = await this.database.client.session.updateMany({
      where: {
        id: params.sessionId,
        refreshTokenHash: params.expectedHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        refreshTokenHash: params.nextHash,
        lastUsedAt: new Date(),
      },
    });

    return result.count === 1;
  }

  async touch(sessionId: string): Promise<void> {
    await this.database.client.session.update({
      where: { id: sessionId },
      data: { lastUsedAt: new Date() },
    });
  }

  async revoke(sessionId: string, userId: string): Promise<Session | null> {
    const existing = await this.database.client.session.findFirst({
      where: { id: sessionId, userId },
    });

    if (!existing) {
      return null;
    }

    if (existing.revokedAt) {
      return existing;
    }

    return this.database.client.session.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.database.client.session.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return result.count;
  }

  isActive(session: Session): boolean {
    if (session.revokedAt) {
      return false;
    }

    return session.expiresAt.getTime() > Date.now();
  }

  verifyRefreshSecret(session: Session, secret: string): boolean {
    return this.refreshTokenService.secretsEqual(session.refreshTokenHash, secret);
  }
}
