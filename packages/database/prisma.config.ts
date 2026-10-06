import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, env } from 'prisma/config';

function loadEnv(): void {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];

  try {
    const configDir = dirname(fileURLToPath(import.meta.url));
    candidates.push(resolve(configDir, '../../.env'));
  } catch {
    // import.meta.url unavailable in some loaders; cwd candidates still apply.
  }

  for (const path of candidates) {
    if (existsSync(path)) {
      config({ path, quiet: true });
      return;
    }
  }
}

loadEnv();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
