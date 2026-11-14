import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const adminName = process.env.ADMIN_NAME || 'أحمد الأمير (المدير)';

  const hashedAdmin = await bcrypt.hash(adminPassword, 10);
  const admin = await prisma.user.upsert({
    where: { username: adminUsername },
    update: { password: hashedAdmin, role: Role.ADMIN, name: adminName },
    create: { username: adminUsername, password: hashedAdmin, role: Role.ADMIN, name: adminName },
  });
  console.log(`ADMIN ready: ${admin.username} (${admin.id})`);

  const hashedCashier = await bcrypt.hash('cashier123', 10);
  const cashier = await prisma.user.upsert({
    where: { username: 'cashier' },
    update: { password: hashedCashier, role: Role.CASHIER, name: 'محمد كاشير' },
    create: { username: 'cashier', password: hashedCashier, role: Role.CASHIER, name: 'محمد كاشير' },
  });
  console.log(`CASHIER ready: ${cashier.username} (${cashier.id})`);

  // Ensure default POS local shift exists in cloud
  const defaultShift = await prisma.shift.upsert({
    where: { id: 'SHIFT-2026-01' },
    update: {},
    create: {
      id: 'SHIFT-2026-01',
      cashierId: cashier.id,
      startingCash: new Prisma.Decimal('500.00'),
    },
  });
  console.log(`DEFAULT SHIFT ready: ${defaultShift.id}`);

  // Seed default LoyaltySetting (10 EGP = 1 Point, 100 Points = 10 EGP discount, min 50 points to redeem)
  const loyaltySetting = await prisma.loyaltySetting.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      isEnabled: true,
      spendAmountPerPoint: new Prisma.Decimal('10.00'),
      redemptionPointsBlock: 100,
      redemptionDiscountAmount: new Prisma.Decimal('10.00'),
      minPointsToRedeem: 50,
      maxDiscountCapPercent: 50,
    },
  });
  console.log(
    `LOYALTY SETTINGS ready: enabled=${loyaltySetting.isEnabled}, ${loyaltySetting.spendAmountPerPoint} EGP = 1 pt, ${loyaltySetting.redemptionPointsBlock} pts = ${loyaltySetting.redemptionDiscountAmount} EGP`
  );

  // Seed sample customers for quick POS lookup (with initial loyalty points, smart change wallet, and sequential customerCode starting at 1001)
  const defaultCustomers = [
    {
      id: 'cust-1',
      customerCode: 1001,
      name: 'محمد علي (عميل مميز)',
      phone: '01000000001',
      pointsBalance: 120,
      walletBalance: '15.50',
      totalSpent: '1200.00',
    },
    {
      id: 'cust-2',
      customerCode: 1002,
      name: 'سارة محمود',
      phone: '01000000002',
      pointsBalance: 60,
      walletBalance: '7.00',
      totalSpent: '600.00',
    },
    {
      id: 'cust-3',
      customerCode: 1003,
      name: null,
      phone: '01000000003',
      pointsBalance: 80,
      walletBalance: '12.00',
      totalSpent: '800.00',
    },
  ];

  for (const c of defaultCustomers) {
    await prisma.customer.upsert({
      where: { phone: c.phone },
      update: { customerCode: c.customerCode },
      create: {
        id: c.id,
        customerCode: c.customerCode,
        name: c.name,
        phone: c.phone,
        pointsBalance: c.pointsBalance,
        walletBalance: new Prisma.Decimal(c.walletBalance),
        totalSpent: new Prisma.Decimal(c.totalSpent),
      },
    });
  }
  console.log('DEFAULT CUSTOMERS (1001..1003) ready.');

  // Enable Row-Level Security (RLS) on all public tables in Supabase
  const rlsTables = [
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
  ];
  for (const table of rlsTables) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE IF EXISTS "public"."${table}" ENABLE ROW LEVEL SECURITY;`
    );
  }
  await prisma.$executeRawUnsafe(`
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
$$;`);
  console.log('SUPABASE RLS ENABLED on all 10 public tables.');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
