import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { disconnectPrismaClient, getPrismaClient, type PrismaClient } from '@hector/database';
import type { DatabaseConfig } from '../../config';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly prisma: PrismaClient;

  constructor(private readonly configService: ConfigService) {
    const database = this.configService.getOrThrow<DatabaseConfig>('database');
    this.prisma = getPrismaClient(database.url);
  }

  get client(): PrismaClient {
    return this.prisma;
  }

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await disconnectPrismaClient();
  }

  async ping(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }
}
