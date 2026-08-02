import { orm, type RuntimeQueryable } from '@prisma-next/sql-orm-client';
import { db } from '../prisma/db';
import type { Contract } from '../prisma/contract.d';
import { getServerEnv } from './env';

export type ConnectionInput = {
  clerkUserId: string;
  apiKeyEncrypted: string;
  apiKeyLastFour: string;
  spreadsheetId: string;
  worksheetName: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'FAILED';
  lastErrorCode?: string | null;
  lastTestedAt?: Date | null;
  lastSyncAt?: Date | null;
};

/** Binds a database runtime to the generated, typed Prisma Next contract. */
function createOrm(runtime: RuntimeQueryable) {
  return orm<Contract>({ context: db.context, runtime });
}

/** Opens a configured database runtime, executes an operation, and always disposes it. */
async function withOrm<T>(
  operation: (client: ReturnType<typeof createOrm>) => Promise<T>,
) {
  const url = getServerEnv('DATABASE_URL') ?? getServerEnv('DB_STRING');
  if (!url) {
    throw Object.assign(new Error('SERVER_CONFIGURATION'), {
      code: 'SERVER_CONFIGURATION',
    });
  }

  const runtime = await db.connect({ url });
  try {
    return await operation(createOrm(runtime));
  } finally {
    await runtime[Symbol.asyncDispose]();
  }
}

/** Returns the sheet connection owned by the supplied Clerk user, if one exists. */
export async function getConnection(userId: string) {
  return withOrm((client) => client.public.SheetConnection
    .where({ clerkUserId: userId })
    .first());
}

/** Creates or updates a user's encrypted sheet connection and its audit timestamps. */
export async function saveConnection(input: ConnectionInput) {
  const now = new Date();
  return withOrm((client) => client.public.SheetConnection.upsert({
    create: { ...input, createdAt: now, updatedAt: now },
    update: { ...input, updatedAt: now },
  }));
}

/** Deletes the sheet connection owned by the supplied Clerk user. */
export async function removeConnection(userId: string) {
  return withOrm((client) => client.public.SheetConnection
    .where({ clerkUserId: userId })
    .delete());
}

/** Marks a user's connection as successfully synchronized and clears its last error. */
export async function markSynced(userId: string) {
  return withOrm((client) => client.public.SheetConnection
    .where({ clerkUserId: userId })
    .update({
      lastSyncAt: new Date(),
      status: 'CONNECTED',
      lastErrorCode: null,
    }));
}
