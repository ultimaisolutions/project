import postgresServerless from '@prisma-next/postgres/serverless';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgresServerless<Contract>({ contractJson });
