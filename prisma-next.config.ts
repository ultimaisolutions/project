import { config as loadEnv } from 'dotenv';
import { defineConfig } from '@prisma-next/postgres/config';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

export default defineConfig({
  contract: './src/prisma/contract.prisma',
  db: { connection: (process.env['DATABASE_URL'] ?? process.env['DB_STRING'])! },
  migrations: { directory: './migrations' },
});
