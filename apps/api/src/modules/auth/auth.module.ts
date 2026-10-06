import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { AuthConfig } from '../../config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshCookieService } from './cookies/refresh-cookie.service';
import { AccessTokenGuard } from './guards/access-token.guard';
import { PasswordHasher } from './password/password-hasher.service';
import { SessionService } from './session/session.service';
import { AccessTokenService } from './tokens/access-token.service';
import { RefreshTokenService } from './tokens/refresh-token.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const auth = configService.getOrThrow<AuthConfig>('auth');
        return {
          secret: auth.jwtAccessSecret,
          signOptions: {
            expiresIn: auth.jwtAccessTtlSeconds,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordHasher,
    AccessTokenService,
    RefreshTokenService,
    RefreshCookieService,
    SessionService,
    AccessTokenGuard,
    {
      provide: APP_GUARD,
      useClass: AccessTokenGuard,
    },
  ],
  exports: [AuthService, AccessTokenGuard, PasswordHasher, AccessTokenService],
})
export class AuthModule {}
