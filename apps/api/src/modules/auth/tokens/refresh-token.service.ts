import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthConfig } from '../../../config';

export type ParsedRefreshToken = {
  sessionId: string;
  secret: string;
};

/**
 * Refresh token format: `${sessionId}.${secret}`
 * Only the secret is hashed and stored. Session ID enables O(1) lookup.
 *
 * Hashing uses HMAC-SHA256 with AUTH_REFRESH_PEPPER when configured (production),
 * otherwise SHA-256(secret) for local/test compatibility with existing sessions.
 * Refresh tokens are opaque — they are not JWTs and do not use JWT_ACCESS_SECRET.
 */
@Injectable()
export class RefreshTokenService {
  constructor(private readonly configService: ConfigService) {}

  createSecret(): string {
    return randomBytes(32).toString('base64url');
  }

  formatToken(sessionId: string, secret: string): string {
    return `${sessionId}.${secret}`;
  }

  parseToken(token: string): ParsedRefreshToken | null {
    const separator = token.indexOf('.');
    if (separator <= 0 || separator === token.length - 1) {
      return null;
    }

    const sessionId = token.slice(0, separator);
    const secret = token.slice(separator + 1);

    if (!this.isUuid(sessionId) || secret.length < 16) {
      return null;
    }

    return { sessionId, secret };
  }

  hashSecret(secret: string): string {
    const pepper = this.configService.get<AuthConfig>('auth')?.refreshPepper ?? '';
    if (pepper.length > 0) {
      return createHmac('sha256', pepper).update(secret).digest('hex');
    }
    return createHash('sha256').update(secret).digest('hex');
  }

  secretsEqual(storedHash: string, candidateSecret: string): boolean {
    const candidateHash = this.hashSecret(candidateSecret);
    const stored = Buffer.from(storedHash, 'utf8');
    const candidate = Buffer.from(candidateHash, 'utf8');

    if (stored.length !== candidate.length) {
      return false;
    }

    return timingSafeEqual(stored, candidate);
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }
}
