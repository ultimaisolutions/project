#!/usr/bin/env -S node
import type { Contract as End } from './end-contract';
import endContract from './end-contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma-next/postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'sheetConnection',
        columns: [
          col('apiKeyEncrypted', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('apiKeyLastFour', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('clerkUserId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz@1' },
          }),
          col('lastErrorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('lastSyncAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz@1' } }),
          col('lastTestedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz@1' } }),
          col('spreadsheetId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('DISCONNECTED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz@1' },
          }),
          col('worksheetName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['clerkUserId'])],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'sheetConnection',
        constraint: 'sheetConnection_status_check',
        column: 'status',
        values: ['CONNECTED', 'DISCONNECTED', 'FAILED'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
