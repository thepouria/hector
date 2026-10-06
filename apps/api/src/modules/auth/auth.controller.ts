import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshCookieService } from './cookies/refresh-cookie.service';
import type { AuthPrincipal } from './types/auth.types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly refreshCookieService: RefreshCookieService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: process.env.NODE_ENV === 'test' ? 1_000 : 10,
      ttl: 60_000,
    },
  })
  @ApiOperation({ summary: 'Authenticate with email and password' })
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login({
      email: body.email,
      password: body.password,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    this.refreshCookieService.set(res, result.refreshToken);

    return {
      data: {
        user: result.user,
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
      },
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiCookieAuth('hector_refresh')
  @ApiOperation({
    summary: 'Rotate refresh cookie and issue a new access token',
  })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.refresh(this.refreshCookieService.read(req));
    this.refreshCookieService.set(res, result.refreshToken);

    return {
      data: {
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
      },
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current session and clear refresh cookie' })
  async logout(@CurrentUser() principal: AuthPrincipal, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(principal);
    this.refreshCookieService.clear(res);

    return {
      data: {
        success: true,
      },
    };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke all sessions for the authenticated user' })
  async logoutAll(
    @CurrentUser() principal: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ) {
    const revokedCount = await this.authService.logoutAll(principal);
    this.refreshCookieService.clear(res);

    return {
      data: {
        success: true,
        revokedCount,
      },
    };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated user profile' })
  async me(@CurrentUser() principal: AuthPrincipal) {
    const user = await this.authService.me(principal);
    return { data: user };
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List sessions for the authenticated user' })
  async sessions(@CurrentUser() principal: AuthPrincipal) {
    const sessions = await this.authService.listSessions(principal);
    return { data: sessions };
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a specific session owned by the authenticated user' })
  async revokeSession(
    @CurrentUser() principal: AuthPrincipal,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.revokeSession(principal, sessionId);

    if (sessionId === principal.sessionId) {
      this.refreshCookieService.clear(res);
    }

    return {
      data: {
        success: true,
      },
    };
  }
}
