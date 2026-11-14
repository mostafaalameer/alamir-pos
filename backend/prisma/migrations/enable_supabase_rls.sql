-- ============================================================================
-- Alamir Market POS - Supabase Row-Level Security (RLS) Hardening Migration
-- Enables RLS on all tables in the `public` schema and revokes direct PostgREST
-- access for `anon` and `authenticated` roles.
-- Note: Prisma connects via the `postgres` role (which has BYPASSRLS), so
-- backend operations continue to work seamlessly.
-- ============================================================================

ALTER TABLE IF EXISTS "public"."LoyaltySetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."LoyaltyTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."WalletTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."ProductBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."Shift" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "public"."OrderItem" ENABLE ROW LEVEL SECURITY;

DO $$
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
$$;

