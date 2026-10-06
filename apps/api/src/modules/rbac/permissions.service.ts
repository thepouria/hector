import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../infrastructure/database/database.service';

export type PermissionView = {
  id: string;
  key: string;
  description: string | null;
};

@Injectable()
export class PermissionsService {
  constructor(private readonly database: DatabaseService) {}

  async list(): Promise<PermissionView[]> {
    const rows = await this.database.client.permission.findMany({
      orderBy: { key: 'asc' },
      select: {
        id: true,
        key: true,
        description: true,
      },
    });

    return rows;
  }
}
