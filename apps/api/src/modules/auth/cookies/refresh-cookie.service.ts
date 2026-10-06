import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { AuthConfig } from '../../../config';

@Injectable()
export class RefreshCookieService {
  constructor(private readonly configService: ConfigService) {}

  set(res: Response, refreshToken: string): void {
    const auth = this.configService.getOrThrow<AuthConfig>('auth');

    res.cookie(auth.refreshCookieName, refreshToken, {
      httpOnly: true,
      secure: auth.refreshCookieSecure,
      sameSite: auth.refreshCookieSameSite,
      path: auth.refreshCookiePath,
      maxAge: auth.sessionTtlMs,
    });
  }

  clear(res: Response): void {
    const auth = this.configService.getOrThrow<AuthConfig>('auth');

    res.clearCookie(auth.refreshCookieName, {
      httpOnly: true,
      secure: auth.refreshCookieSecure,
      sameSite: auth.refreshCookieSameSite,
      path: auth.refreshCookiePath,
    });
  }

  read(req: { cookies?: Record<string, string | undefined> }): string | undefined {
    const auth = this.configService.getOrThrow<AuthConfig>('auth');
    return req.cookies?.[auth.refreshCookieName];
  }
}
