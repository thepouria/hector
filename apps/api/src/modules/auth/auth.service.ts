import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserStatus, type User } from '@hector/database';
import { PinoLogger } from 'nestjs-pino';
import type { AuthConfig } from '../../config';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AUTH_ERROR_MESSAGES } from './auth.constants';
import { PasswordHasher } from './password/password-hasher.service';
import { AccessTokenService } from './tokens/access-token.service';
import { RefreshTokenService } from './tokens/refresh-token.service';
import { SessionService } from './session/session.service';
import type { AuthPrincipal, AuthSessionView, AuthenticatedUserView } from './types/auth.types';

export type LoginResult = {
  user: AuthenticatedUserView;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  sessionId: string;
};

export type RefreshResult = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  sessionId: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwordHasher: PasswordHasher,
    private readonly accessTokenService: AccessTokenService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AuthService.name);
  }

  async login(input: {
    email: string;
    password: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<LoginResult> {
    const email = this.normalizeEmail(input.email);
    const user = await this.database.client.user.findUnique({
      where: { email },
    });

    if (!user || user.deletedAt) {
      await this.passwordHasher.verifyDummy(input.password);
      this.logger.warn({ email }, 'Login failed: unknown user');
      throw this.invalidCredentials();
    }

    const passwordValid = await this.passwordHasher.verify(user.passwordHash, input.password);
    if (!passwordValid) {
      this.logger.warn({ userId: user.id }, 'Login failed: invalid password');
      throw this.invalidCredentials();
    }

    if (user.status !== UserStatus.ACTIVE) {
      this.logger.warn({ userId: user.id, status: user.status }, 'Login failed: inactive user');
      throw this.invalidCredentials();
    }

    const auth = this.configService.getOrThrow<AuthConfig>('auth');
    const secret = this.refreshTokenService.createSecret();
    const refreshTokenHash = this.refreshTokenService.hashSecret(secret);
    const expiresAt = new Date(Date.now() + auth.sessionTtlMs);

    const session = await this.sessionService.create({
      userId: user.id,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      expiresAt,
      refreshTokenHash,
    });

    const refreshToken = this.refreshTokenService.formatToken(session.id, secret);
    const tokens = await this.accessTokenService.sign(user.id, session.id);

    this.logger.info(
      { userId: user.id, sessionId: session.id },
      'Login succeeded; session created',
    );

    return {
      user: this.toUserView(user),
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      refreshToken,
      sessionId: session.id,
    };
  }

  async refresh(rawRefreshToken: string | undefined): Promise<RefreshResult> {
    if (!rawRefreshToken) {
      throw this.invalidRefreshToken();
    }

    const parsed = this.refreshTokenService.parseToken(rawRefreshToken);
    if (!parsed) {
      throw this.invalidRefreshToken();
    }

    const session = await this.sessionService.findById(parsed.sessionId);
    if (!session) {
      throw this.invalidRefreshToken();
    }

    if (session.revokedAt) {
      throw new AppError({
        code: ERROR_CODES.SESSION_REVOKED,
        message: AUTH_ERROR_MESSAGES.SESSION_REVOKED,
        statusCode: 401,
      });
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new AppError({
        code: ERROR_CODES.SESSION_EXPIRED,
        message: AUTH_ERROR_MESSAGES.SESSION_EXPIRED,
        statusCode: 401,
      });
    }

    if (!this.sessionService.verifyRefreshSecret(session, parsed.secret)) {
      // Possible stolen/rotated token reuse. Revoke the session so any holder loses access.
      await this.sessionService.revoke(session.id, session.userId);
      this.logger.warn(
        { sessionId: session.id },
        'Refresh rejected: token mismatch; session revoked',
      );
      throw this.invalidRefreshToken();
    }

    if (session.user.deletedAt || session.user.status !== UserStatus.ACTIVE) {
      this.logger.warn(
        { userId: session.userId, status: session.user.status },
        'Refresh rejected: inactive user',
      );
      throw this.invalidRefreshToken();
    }

    const nextSecret = this.refreshTokenService.createSecret();
    const nextHash = this.refreshTokenService.hashSecret(nextSecret);
    const rotated = await this.sessionService.rotateRefreshToken({
      sessionId: session.id,
      expectedHash: session.refreshTokenHash,
      nextHash,
    });

    if (!rotated) {
      this.logger.warn({ sessionId: session.id }, 'Refresh rejected: concurrent rotation lost');
      throw this.invalidRefreshToken();
    }

    const refreshToken = this.refreshTokenService.formatToken(session.id, nextSecret);
    const tokens = await this.accessTokenService.sign(session.userId, session.id);

    this.logger.info({ userId: session.userId, sessionId: session.id }, 'Refresh succeeded');

    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      refreshToken,
      sessionId: session.id,
    };
  }

  async logout(principal: AuthPrincipal): Promise<void> {
    await this.sessionService.revoke(principal.sessionId, principal.userId);
    this.logger.info(
      { userId: principal.userId, sessionId: principal.sessionId },
      'Logout revoked current session',
    );
  }

  async logoutAll(principal: AuthPrincipal): Promise<number> {
    const count = await this.sessionService.revokeAllForUser(principal.userId);
    this.logger.info({ userId: principal.userId, count }, 'Logout-all revoked sessions');
    return count;
  }

  async me(principal: AuthPrincipal): Promise<AuthenticatedUserView> {
    const user = await this.requireActiveUser(principal.userId);
    return this.toUserView(user);
  }

  async listSessions(principal: AuthPrincipal): Promise<AuthSessionView[]> {
    await this.requireActiveUser(principal.userId);
    const sessions = await this.sessionService.listForUser(principal.userId);

    return sessions.map((session) => ({
      id: session.id,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      expiresAt: session.expiresAt,
      current: session.id === principal.sessionId,
      revoked: session.revokedAt !== null,
    }));
  }

  async revokeSession(principal: AuthPrincipal, sessionId: string): Promise<void> {
    await this.requireActiveUser(principal.userId);
    const revoked = await this.sessionService.revoke(sessionId, principal.userId);

    if (!revoked) {
      // Avoid leaking whether the session exists for another user.
      throw new AppError({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Session not found',
        statusCode: 404,
      });
    }

    this.logger.info({ userId: principal.userId, sessionId }, 'Session revoked by user');
  }

  async assertPrincipalActive(principal: AuthPrincipal): Promise<void> {
    const session = await this.sessionService.findById(principal.sessionId);

    if (!session || session.userId !== principal.userId) {
      throw new AppError({
        code: ERROR_CODES.INVALID_ACCESS_TOKEN,
        message: AUTH_ERROR_MESSAGES.INVALID_ACCESS_TOKEN,
        statusCode: 401,
      });
    }

    if (session.revokedAt) {
      throw new AppError({
        code: ERROR_CODES.SESSION_REVOKED,
        message: AUTH_ERROR_MESSAGES.SESSION_REVOKED,
        statusCode: 401,
      });
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new AppError({
        code: ERROR_CODES.SESSION_EXPIRED,
        message: AUTH_ERROR_MESSAGES.SESSION_EXPIRED,
        statusCode: 401,
      });
    }

    if (session.user.deletedAt || session.user.status !== UserStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: AUTH_ERROR_MESSAGES.UNAUTHENTICATED,
        statusCode: 401,
      });
    }
  }

  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private async requireActiveUser(userId: string): Promise<User> {
    const user = await this.database.client.user.findUnique({ where: { id: userId } });

    if (!user || user.deletedAt || user.status !== UserStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: AUTH_ERROR_MESSAGES.UNAUTHENTICATED,
        statusCode: 401,
      });
    }

    return user;
  }

  private toUserView(user: User): AuthenticatedUserView {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
    };
  }

  private invalidCredentials(): AppError {
    return new AppError({
      code: ERROR_CODES.INVALID_CREDENTIALS,
      message: AUTH_ERROR_MESSAGES.INVALID_CREDENTIALS,
      statusCode: 401,
    });
  }

  private invalidRefreshToken(): AppError {
    return new AppError({
      code: ERROR_CODES.INVALID_REFRESH_TOKEN,
      message: AUTH_ERROR_MESSAGES.INVALID_REFRESH_TOKEN,
      statusCode: 401,
    });
  }
}
