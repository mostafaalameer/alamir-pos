import { prisma } from './db';

const PUBLIC_TABLES = [
  'LoyaltySetting',
  'Customer',
  'LoyaltyTransaction',
  'WalletTransaction',
  'User',
  'Product',
  'ProductBatch',
  'Shift',
  'Order',
  'OrderItem',
  'CreditTransaction',
  'CashMovement',
  'AuditLog',
] as const;

/**
 * Ensures Row-Level Security (RLS) is enabled on all public tables in Supabase/PostgreSQL
 * so that the PostgREST Data API cannot expose rows to `anon` or `authenticated` roles.
 * Prisma connects as `postgres` (table owner / bypassrls) and is unaffected.
 */
export async function ensureSupabaseRlsEnabled(): Promise<{
  securedTables: string[];
}> {
  const executeRaw = (prisma as any).$executeRawUnsafe;
  if (typeof executeRaw !== 'function') {
    return { securedTables: [] };
  }

  const securedTables: string[] = [];
  for (const table of PUBLIC_TABLES) {
    await executeRaw.call(
      prisma,
      `ALTER TABLE IF EXISTS "public"."${table}" ENABLE ROW LEVEL SECURITY;`
    );
    securedTables.push(table);
  }

  await executeRaw.call(
    prisma,
    `DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM authenticated;
  END IF;
END
$$;`
  );

  return { securedTables };
}

