import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthConfig } from '../../../config';
import type { AccessTokenClaims } from '../types/auth.types';

@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async sign(
    userId: string,
    sessionId: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const auth = this.configService.getOrThrow<AuthConfig>('auth');
    const payload: AccessTokenClaims = {
      sub: userId,
      sid: sessionId,
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: auth.jwtAccessSecret,
      algorithm: 'HS256',
      expiresIn: auth.jwtAccessTtlSeconds,
    });

    return {
      accessToken,
      expiresIn: auth.jwtAccessTtlSeconds,
    };
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    const auth = this.configService.getOrThrow<AuthConfig>('auth');
    const payload = await this.jwtService.verifyAsync<AccessTokenClaims>(token, {
      secret: auth.jwtAccessSecret,
      algorithms: ['HS256'],
    });

    if (!payload.sub || !payload.sid) {
      throw new Error('Access token payload is incomplete');
    }

    return payload;
  }
}
