import { Prisma } from '@prisma/client';
import { prisma } from '../config/db';

export interface FullDatabaseBackupPayload {
  format: 'alamir-pos-full-backup';
  version: number;
  exportedAt: string;
  exportedBy?: string;
  counts: Record<string, number>;
  tables: {
    users: any[];
    loyaltySettings: any[];
    customers: any[];
    products: any[];
    productBatches: any[];
    shifts: any[];
    orders: any[];
    orderItems: any[];
    loyaltyTransactions: any[];
    walletTransactions: any[];
    creditTransactions: any[];
    cashMovements: any[];
    auditLogs: any[];
  };
}

function toDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return toDate(value) ?? null;
}

export class BackupService {
  static async exportFullBackup(exportedBy?: string): Promise<FullDatabaseBackupPayload> {
    const [
      users,
      loyaltySettings,
      customers,
      products,
      productBatches,
      shifts,
      orders,
      orderItems,
      loyaltyTransactions,
      walletTransactions,
      creditTransactions,
      cashMovements,
      auditLogs,
    ] = await prisma.$transaction([
      prisma.user.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.loyaltySetting.findMany(),
      prisma.customer.findMany({ orderBy: { customerCode: 'asc' } }),
      prisma.product.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.productBatch.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.shift.findMany({ orderBy: { openedAt: 'asc' } }),
      prisma.order.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.orderItem.findMany(),
      prisma.loyaltyTransaction.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.walletTransaction.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.creditTransaction.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.cashMovement.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } }),
    ]);

    const tables = {
      users,
      loyaltySettings,
      customers,
      products,
      productBatches,
      shifts,
      orders,
      orderItems,
      loyaltyTransactions,
      walletTransactions,
      creditTransactions,
      cashMovements,
      auditLogs,
    };

    const counts: Record<string, number> = {
      users: users.length,
      loyaltySettings: loyaltySettings.length,
      customers: customers.length,
      products: products.length,
      productBatches: productBatches.length,
      shifts: shifts.length,
      orders: orders.length,
      orderItems: orderItems.length,
      loyaltyTransactions: loyaltyTransactions.length,
      walletTransactions: walletTransactions.length,
      creditTransactions: creditTransactions.length,
      cashMovements: cashMovements.length,
      auditLogs: auditLogs.length,
    };

    return {
      format: 'alamir-pos-full-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedBy,
      counts,
      tables,
    };
  }

  static async restoreFullBackup(
    payload: FullDatabaseBackupPayload,
    restoredBy?: string
  ): Promise<Record<string, number>> {
    if (!payload || payload.format !== 'alamir-pos-full-backup' || !payload.tables) {
      throw new Error('ملف النسخة الاحتياطية غير صالح أو لا يطابق صيغة النظام');
    }

    const t = payload.tables;
    const users = Array.isArray(t.users) ? t.users : [];
    const loyaltySettings = Array.isArray(t.loyaltySettings) ? t.loyaltySettings : [];
    const customers = Array.isArray(t.customers) ? t.customers : [];
    const products = Array.isArray(t.products) ? t.products : [];
    const productBatches = Array.isArray(t.productBatches) ? t.productBatches : [];
    const shifts = Array.isArray(t.shifts) ? t.shifts : [];
    const orders = Array.isArray(t.orders) ? t.orders : [];
    const orderItems = Array.isArray(t.orderItems) ? t.orderItems : [];
    const loyaltyTransactions = Array.isArray(t.loyaltyTransactions) ? t.loyaltyTransactions : [];
    const walletTransactions = Array.isArray(t.walletTransactions) ? t.walletTransactions : [];
    const creditTransactions = Array.isArray(t.creditTransactions) ? t.creditTransactions : [];
    const cashMovements = Array.isArray(t.cashMovements) ? t.cashMovements : [];
    const auditLogs = Array.isArray(t.auditLogs) ? t.auditLogs : [];

    await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // 1. Delete in child-to-parent order to satisfy foreign keys
        await tx.auditLog.deleteMany();
        await tx.cashMovement.deleteMany();
        await tx.creditTransaction.deleteMany();
        await tx.walletTransaction.deleteMany();
        await tx.loyaltyTransaction.deleteMany();
        await tx.orderItem.deleteMany();
        await tx.order.deleteMany();
        await tx.shift.deleteMany();
        await tx.productBatch.deleteMany();
        await tx.product.deleteMany();
        await tx.customer.deleteMany();
        await tx.loyaltySetting.deleteMany();
        if (users.length > 0) {
          await tx.user.deleteMany();
        }

        // 2. Insert in parent-to-child order
        if (users.length > 0) {
          await tx.user.createMany({
            data: users.map((u) => ({
              id: u.id,
              name: u.name,
              username: u.username,
              password: u.password,
              role: u.role,
              createdAt: toDate(u.createdAt),
            })),
          });
        }

        if (loyaltySettings.length > 0) {
          await tx.loyaltySetting.createMany({
            data: loyaltySettings.map((s) => ({
              id: s.id,
              isEnabled: Boolean(s.isEnabled),
              spendAmountPerPoint: s.spendAmountPerPoint,
              redemptionPointsBlock: Number(s.redemptionPointsBlock),
              redemptionDiscountAmount: s.redemptionDiscountAmount,
              minPointsToRedeem: Number(s.minPointsToRedeem),
              maxDiscountCapPercent: Number(s.maxDiscountCapPercent),
              updatedAt: toDate(s.updatedAt),
            })),
          });
        }

        if (customers.length > 0) {
          await tx.customer.createMany({
            data: customers.map((c) => ({
              id: c.id,
              customerCode: Number(c.customerCode),
              name: c.name ?? null,
              phone: c.phone,
              pointsBalance: Number(c.pointsBalance ?? 0),
              walletBalance: c.walletBalance ?? 0,
              creditLimit: c.creditLimit ?? 0,
              creditBalance: c.creditBalance ?? 0,
              totalSpent: c.totalSpent ?? 0,
              createdAt: toDate(c.createdAt),
              updatedAt: toDate(c.updatedAt),
            })),
          });

          // Sync PostgreSQL autoincrement sequence for Customer.customerCode
          await tx.$executeRawUnsafe(
            `SELECT setval(pg_get_serial_sequence('"Customer"', 'customerCode'), COALESCE((SELECT MAX("customerCode") FROM "Customer"), 1), true);`
          );
        }

        if (products.length > 0) {
          await tx.product.createMany({
            data: products.map((p) => ({
              id: p.id,
              barcode: p.barcode,
              name: p.name,
              category: p.category ?? 'عام',
              description: p.description ?? null,
              weightUnit: p.weightUnit ?? 'قطعة',
              retailPrice: p.retailPrice,
              isAvailableOnline: Boolean(p.isAvailableOnline),
              imageUrls: p.imageUrls ?? null,
              minStockAlert: Number(p.minStockAlert ?? 5),
              createdAt: toDate(p.createdAt),
              updatedAt: toDate(p.updatedAt),
            })),
          });
        }

        if (productBatches.length > 0) {
          await tx.productBatch.createMany({
            data: productBatches.map((b) => ({
              id: b.id,
              productId: b.productId,
              batchNumber: b.batchNumber,
              costPrice: b.costPrice,
              quantity: Number(b.quantity),
              expiryDate: toDate(b.expiryDate) ?? new Date(),
              createdAt: toDate(b.createdAt),
            })),
          });
        }

        if (shifts.length > 0) {
          await tx.shift.createMany({
            data: shifts.map((s) => ({
              id: s.id,
              cashierId: s.cashierId,
              startingCash: s.startingCash,
              actualEndCash: s.actualEndCash ?? null,
              expectedCash: s.expectedCash ?? null,
              discrepancy: s.discrepancy ?? null,
              openedAt: toDate(s.openedAt),
              closedAt: toNullableDate(s.closedAt),
            })),
          });
        }

        if (orders.length > 0) {
          await tx.order.createMany({
            data: orders.map((o) => ({
              id: o.id,
              orderNumber: o.orderNumber,
              shiftId: o.shiftId,
              cashierId: o.cashierId,
              customerId: o.customerId ?? null,
              totalAmount: o.totalAmount,
              paidAmount: o.paidAmount ?? 0,
              changeGiven: o.changeGiven ?? 0,
              changeDepositedToWallet: o.changeDepositedToWallet ?? 0,
              walletAmountUsed: o.walletAmountUsed ?? 0,
              pointsEarned: Number(o.pointsEarned ?? 0),
              pointsRedeemed: Number(o.pointsRedeemed ?? 0),
              discountFromPoints: o.discountFromPoints ?? 0,
              paymentMethod: o.paymentMethod,
              isReturned: Boolean(o.isReturned),
              createdAt: toDate(o.createdAt),
            })),
          });
        }

        if (orderItems.length > 0) {
          await tx.orderItem.createMany({
            data: orderItems.map((i) => ({
              id: i.id,
              orderId: i.orderId,
              productId: i.productId,
              quantity: Number(i.quantity),
              returnedQuantity: Number(i.returnedQuantity ?? 0),
              unitPrice: i.unitPrice,
              costPrice: i.costPrice,
            })),
          });
        }

        if (loyaltyTransactions.length > 0) {
          await tx.loyaltyTransaction.createMany({
            data: loyaltyTransactions.map((l) => ({
              id: l.id,
              customerId: l.customerId,
              orderId: l.orderId ?? null,
              type: l.type,
              points: Number(l.points),
              amountValue: l.amountValue ?? 0,
              description: l.description ?? null,
              createdAt: toDate(l.createdAt),
            })),
          });
        }

        if (walletTransactions.length > 0) {
          await tx.walletTransaction.createMany({
            data: walletTransactions.map((w) => ({
              id: w.id,
              customerId: w.customerId,
              orderId: w.orderId ?? null,
              amount: w.amount,
              balanceAfter: w.balanceAfter,
              type: w.type,
              description: w.description ?? null,
              createdAt: toDate(w.createdAt),
            })),
          });
        }

        if (creditTransactions.length > 0) {
          await tx.creditTransaction.createMany({
            data: creditTransactions.map((c) => ({
              id: c.id,
              customerId: c.customerId,
              orderId: c.orderId ?? null,
              amount: c.amount,
              balanceAfter: c.balanceAfter,
              type: c.type,
              notes: c.notes ?? null,
              createdAt: toDate(c.createdAt),
            })),
          });
        }

        if (cashMovements.length > 0) {
          await tx.cashMovement.createMany({
            data: cashMovements.map((m) => ({
              id: m.id,
              shiftId: m.shiftId,
              type: m.type,
              amount: m.amount,
              reason: m.reason,
              cashierId: m.cashierId,
              createdAt: toDate(m.createdAt),
            })),
          });
        }

        if (auditLogs.length > 0) {
          await tx.auditLog.createMany({
            data: auditLogs.map((a) => ({
              id: a.id,
              action: a.action,
              cashierId: a.cashierId ?? null,
              authorizedBy: a.authorizedBy ?? null,
              details: a.details ?? null,
              createdAt: toDate(a.createdAt),
            })),
          });
        }

        await tx.auditLog.create({
          data: {
            action: 'DATABASE_RESTORE',
            authorizedBy: restoredBy || 'ADMIN',
            details: `Restored backup exported at ${payload.exportedAt || 'unknown'} (${orders.length} orders, ${products.length} products, ${customers.length} customers)`,
          },
        });
      },
      { timeout: 60000 }
    );

    return {
      users: users.length,
      loyaltySettings: loyaltySettings.length,
      customers: customers.length,
      products: products.length,
      productBatches: productBatches.length,
      shifts: shifts.length,
      orders: orders.length,
      orderItems: orderItems.length,
      loyaltyTransactions: loyaltyTransactions.length,
      walletTransactions: walletTransactions.length,
      creditTransactions: creditTransactions.length,
      cashMovements: cashMovements.length,
      auditLogs: auditLogs.length,
    };
  }
}