import fs from 'fs';
import path from 'path';
import { PaymentMethod, Prisma, Role } from '@prisma/client';
import { prisma } from '../config/db';
import { env } from '../config/env';
import { ProductService } from './product.service';
import { ShiftService } from './shift.service';
import { LoyaltyService } from './loyalty.service';

export interface OfflineOrderItemPayload {
  productId: string;
  quantity: number;
  unitPrice?: number; // Immutable local POS snapshot price at checkout time
}

export interface OfflineOrderPayload {
  clientOrderId?: string; // Client-generated UUID for idempotent deduplication
  idempotencyKey?: string;
  orderNumber: string;
  shiftId: string;
  paymentMethod: PaymentMethod;
  items: OfflineOrderItemPayload[];
  createdAt?: string;
  customerCode?: number;
  customerPhone?: string;
  customerName?: string | null;
  pointsEarned?: number;
  pointsRedeemed?: number;
  discountFromPoints?: number;
  paidAmount?: number;
  changeGiven?: number;
  changeDepositedToWallet?: number;
  walletAmountUsed?: number;
}

export interface OfflineClosedShiftPayload {
  shiftId: string;
  actualEndCash: number;
  closedAt?: string;
}

export interface OfflineCustomerPayload {
  name?: string | null;
  phone: string;
  customerCode?: number;
}

export class SyncService {
  // Bounded in-memory cache of processed batch idempotency keys to short-circuit duplicate retries
  private static processedBatchKeys = new Map<string, any>();

  /**
   * Cloud -> POS (Product, Price, Loyalty Settings & Customers Sync)
   * Supports delta sync via `?updatedSince=<ISO_TIMESTAMP>`.
   * Conflict Resolution Strategy: Cloud price adjustments are authoritative and always override local POS prices.
   */
  static async pullCatalogSnapshot(role: Role, updatedSince?: string) {
    const parsedDate =
      updatedSince && !isNaN(Date.parse(updatedSince))
        ? new Date(updatedSince)
        : undefined;

    let products = await ProductService.listProducts(role, undefined, parsedDate);

    if (parsedDate) {
      const threshold = parsedDate.getTime();
      products = products.filter(
        (p: any) => new Date(p.updatedAt).getTime() >= threshold
      );
    }

    const loyaltySettings = await LoyaltyService.getSettings().catch(() => undefined);
    const customers = await LoyaltyService.listCustomers().catch(() => []);

    return {
      syncedAt: new Date().toISOString(),
      conflictResolutionPolicy: 'CLOUD_PRICE_OVERRIDES_LOCAL',
      currency: env.CURRENCY,
      locale: env.LOCALE,
      count: products.length,
      products,
      loyaltySettings,
      customers,
    };
  }

  /**
   * Resolves a token userId (which may be an offline demo ID such as 'admin-demo-id')
   * to an actual User record in PostgreSQL when prisma.user is available.
   */
  private static async resolveCloudUserId(cashierId: string, role: Role): Promise<string> {
    const userDelegate = (prisma as any).user;
    if (!userDelegate || typeof userDelegate.findUnique !== 'function') {
      return cashierId;
    }

    const byId = await userDelegate.findUnique({ where: { id: cashierId } });
    if (byId) return byId.id;

    const preferredUsername = role === Role.ADMIN ? 'admin' : 'cashier';
    const byUsername = await userDelegate.findUnique({
      where: { username: preferredUsername },
    });
    if (byUsername) return byUsername.id;

    if (typeof userDelegate.findFirst === 'function') {
      const anyUser = await userDelegate.findFirst();
      if (anyUser) return anyUser.id;
    }

    return cashierId;
  }

  /**
   * POS -> Cloud (Sales, Loyalty Points, Smart Change Wallet & Shift Sync)
   * Conflict Resolution Strategy:
   * - Local sales transactions are immutable and pushed to the cloud preserving their recorded unitPrice snapshot.
   * - Offline customers, loyalty points, and wallet transactions are reconciled atomically.
   * - Closed shifts enqueued offline are reconciled idempotently in the cloud database.
   */
  static async pushOfflineBatch(
    cashierId: string,
    role: Role,
    orders: OfflineOrderPayload[],
    closedShifts: OfflineClosedShiftPayload[] = [],
    offlineCustomers: OfflineCustomerPayload[] = [],
    batchIdempotencyKey?: string
  ) {
    const cleanBatchKey = batchIdempotencyKey?.trim();
    if (cleanBatchKey && this.processedBatchKeys.has(cleanBatchKey)) {
      const cached = this.processedBatchKeys.get(cleanBatchKey);
      return {
        ...cached,
        idempotencyKey: cleanBatchKey,
        deduplicatedBatch: true,
        syncedCount: 0,
        skippedCount: orders.length,
        skippedOrderNumbers: orders.map((o) => o.orderNumber),
      };
    }

    const effectiveCashierId = await this.resolveCloudUserId(cashierId, role);
    const syncedOrders: any[] = [];
    const skippedOrderNumbers: string[] = [];
    const syncedShifts: any[] = [];
    const seenOrderKeysInBatch = new Set<string>();

    // Upsert any newly registered offline customers first
    if (offlineCustomers.length > 0 && (prisma as any).customer?.upsert) {
      for (const c of offlineCustomers) {
        if (!c.phone) continue;
        await LoyaltyService.createOrGetCustomer({
          name: c.name ?? null,
          phone: c.phone,
          customerCode: c.customerCode,
        });
      }
    }

    for (const offlineOrder of orders) {
      const orderDedupKey =
        offlineOrder.idempotencyKey ||
        offlineOrder.clientOrderId ||
        offlineOrder.orderNumber;

      if (
        seenOrderKeysInBatch.has(orderDedupKey) ||
        seenOrderKeysInBatch.has(offlineOrder.orderNumber)
      ) {
        skippedOrderNumbers.push(offlineOrder.orderNumber);
        continue;
      }
      seenOrderKeysInBatch.add(orderDedupKey);
      seenOrderKeysInBatch.add(offlineOrder.orderNumber);

      let existing = await prisma.order.findUnique({
        where: { orderNumber: offlineOrder.orderNumber },
      });

      if (
        !existing &&
        offlineOrder.clientOrderId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          offlineOrder.clientOrderId
        )
      ) {
        existing = await prisma.order.findUnique({
          where: { id: offlineOrder.clientOrderId },
        });
      }

      if (existing) {
        skippedOrderNumbers.push(offlineOrder.orderNumber);
        continue;
      }

      let created: any;
      try {
        // Preserve immutable local unitPrice if provided; deduct FIFO stock inside transaction
        created = await prisma.$transaction(async (tx) => {
        let shift = await tx.shift.findUnique({
          where: { id: offlineOrder.shiftId },
        });

        if (!shift) {
          if (typeof (tx.shift as any).create === 'function') {
            shift = await (tx.shift as any).create({
              data: {
                id: offlineOrder.shiftId,
                cashierId: effectiveCashierId,
                startingCash: new Prisma.Decimal('500.00'),
              },
            });
          } else {
            throw new Error('SHIFT_CLOSED_OR_INVALID');
          }
        }

        let orderSubtotal = 0;
        const orderItemsToCreate: Array<{
          productId: string;
          quantity: number;
          unitPrice: Prisma.Decimal;
          costPrice: Prisma.Decimal;
        }> = [];

        for (const reqItem of offlineOrder.items) {
          const product = await tx.product.findUnique({
            where: { id: reqItem.productId },
          });

          if (!product) {
            throw new Error(`PRODUCT_NOT_FOUND:${reqItem.productId}`);
          }

          // Immutable local transaction price takes precedence if recorded at POS checkout time
          const lockedUnitPrice =
            reqItem.unitPrice !== undefined
              ? reqItem.unitPrice
              : Number(product.retailPrice);

          try {
            const fifoResult = await ProductService.deductProductStockFIFO(
              reqItem.productId,
              reqItem.quantity,
              tx
            );

            for (const allocation of fifoResult.allocations) {
              orderSubtotal += allocation.deductedQuantity * lockedUnitPrice;
              orderItemsToCreate.push({
                productId: product.id,
                quantity: allocation.deductedQuantity,
                unitPrice: new Prisma.Decimal(lockedUnitPrice.toFixed(2)),
                costPrice: allocation.costPrice,
              });
            }
          } catch (fifoErr: unknown) {
            if (
              fifoErr instanceof Error &&
              fifoErr.message.startsWith('INSUFFICIENT_STOCK')
            ) {
              const availableBatches = await tx.productBatch.findMany({
                where: { productId: reqItem.productId, quantity: { gt: 0 } },
                orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
              });
              let fallbackCost = new Prisma.Decimal((lockedUnitPrice * 0.8).toFixed(2));
              for (const b of availableBatches) {
                fallbackCost = b.costPrice;
                await tx.productBatch.update({
                  where: { id: b.id },
                  data: { quantity: 0 },
                });
              }
              orderSubtotal += reqItem.quantity * lockedUnitPrice;
              orderItemsToCreate.push({
                productId: product.id,
                quantity: reqItem.quantity,
                unitPrice: new Prisma.Decimal(lockedUnitPrice.toFixed(2)),
                costPrice: fallbackCost,
              });
            } else {
              throw fifoErr;
            }
          }
        }

        const discountFromPoints = Number(offlineOrder.discountFromPoints ?? 0);
        const pointsEarned = Number(offlineOrder.pointsEarned ?? 0);
        const pointsRedeemed = Number(offlineOrder.pointsRedeemed ?? 0);
        const netTotal = Math.max(0, Number((orderSubtotal - discountFromPoints).toFixed(2)));
        const walletAmountUsed = Number(offlineOrder.walletAmountUsed ?? 0);
        const changeDepositedToWallet = Number(
          offlineOrder.changeDepositedToWallet ?? 0
        );
        const remainingCashDue = Math.max(
          0,
          Number((netTotal - walletAmountUsed).toFixed(2))
        );
        const paidAmount =
          offlineOrder.paidAmount !== undefined
            ? Number(offlineOrder.paidAmount)
            : remainingCashDue;
        const changeGiven =
          offlineOrder.changeGiven !== undefined
            ? Number(offlineOrder.changeGiven)
            : Math.max(
                0,
                Number((paidAmount - remainingCashDue - changeDepositedToWallet).toFixed(2))
              );

        let resolvedCustomer: any = null;
        const customerDelegate = (tx as any).customer;
        if (
          offlineOrder.customerPhone &&
          customerDelegate &&
          typeof customerDelegate.findUnique === 'function'
        ) {
          const cleanPhone = offlineOrder.customerPhone.trim();
          resolvedCustomer = await customerDelegate.findUnique({
            where: { phone: cleanPhone },
          });
          if (!resolvedCustomer && typeof customerDelegate.create === 'function') {
            let nextCode =
              offlineOrder.customerCode ?? (await LoyaltyService.getNextCustomerCode(tx));
            const cleanName =
              typeof offlineOrder.customerName === 'string' &&
              offlineOrder.customerName.trim().length > 0 &&
              !offlineOrder.customerName.trim().startsWith('عميل #')
                ? offlineOrder.customerName.trim()
                : null;
            try {
              resolvedCustomer = await customerDelegate.create({
                data: {
                  customerCode: nextCode,
                  name: cleanName,
                  phone: cleanPhone,
                  pointsBalance: 0,
                  walletBalance: new Prisma.Decimal('0.00'),
                  totalSpent: new Prisma.Decimal('0.00'),
                },
              });
            } catch (custErr: any) {
              if (custErr?.code === 'P2002') {
                nextCode = await LoyaltyService.getNextCustomerCode(tx);
                resolvedCustomer = await customerDelegate.create({
                  data: {
                    customerCode: nextCode,
                    name: cleanName,
                    phone: cleanPhone,
                    pointsBalance: 0,
                    walletBalance: new Prisma.Decimal('0.00'),
                    totalSpent: new Prisma.Decimal('0.00'),
                  },
                });
              } else {
                throw custErr;
              }
            }
          }
        }

        const hasWalletOrCashFields =
          resolvedCustomer !== null ||
          offlineOrder.paidAmount !== undefined ||
          offlineOrder.changeGiven !== undefined ||
          offlineOrder.changeDepositedToWallet !== undefined ||
          offlineOrder.walletAmountUsed !== undefined;

        const orderData: any = {
          orderNumber: offlineOrder.orderNumber,
          shiftId: offlineOrder.shiftId,
          cashierId: effectiveCashierId,
          totalAmount: new Prisma.Decimal(netTotal.toFixed(2)),
          paymentMethod: offlineOrder.paymentMethod,
          items: {
            create: orderItemsToCreate,
          },
        };

        if (
          offlineOrder.clientOrderId &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            offlineOrder.clientOrderId
          )
        ) {
          orderData.id = offlineOrder.clientOrderId;
        }

        if (resolvedCustomer) {
          orderData.customerId = resolvedCustomer.id;
          orderData.pointsEarned = pointsEarned;
          orderData.pointsRedeemed = pointsRedeemed;
          orderData.discountFromPoints = new Prisma.Decimal(discountFromPoints.toFixed(2));
        }

        if (hasWalletOrCashFields) {
          orderData.paidAmount = new Prisma.Decimal(paidAmount.toFixed(2));
          orderData.changeGiven = new Prisma.Decimal(changeGiven.toFixed(2));
          orderData.changeDepositedToWallet = new Prisma.Decimal(
            changeDepositedToWallet.toFixed(2)
          );
          orderData.walletAmountUsed = new Prisma.Decimal(walletAmountUsed.toFixed(2));
        }

        const createdOrder = await tx.order.create({
          data: orderData,
          include: {
            items: {
              include: {
                product: {
                  select: { id: true, name: true, barcode: true },
                },
              },
            },
          },
        });

        if (resolvedCustomer) {
          const safeRedeemPoints = Math.min(
            pointsRedeemed,
            Math.max(0, Number(resolvedCustomer.pointsBalance ?? 0))
          );
          const safeWalletUsed = Math.min(
            walletAmountUsed,
            Math.max(0, Number(resolvedCustomer.walletBalance ?? 0))
          );
          await LoyaltyService.recordOrderLoyaltyInTx(tx, {
            customerId: resolvedCustomer.id,
            orderId: createdOrder.id,
            orderNumber: createdOrder.orderNumber,
            netPayable: netTotal,
            pointsEarned,
            pointsRedeemed: safeRedeemPoints,
            discountFromPoints,
            walletAmountUsed: safeWalletUsed,
            changeDepositedToWallet,
          });
        }

        return createdOrder;
      });
      } catch (orderErr: any) {
        // Handle concurrent push race condition idempotently (Prisma unique constraint P2002)
        if (orderErr?.code === 'P2002') {
          skippedOrderNumbers.push(offlineOrder.orderNumber);
          continue;
        }
        throw orderErr;
      }

      syncedOrders.push({
        id: created.id,
        orderNumber: created.orderNumber,
        totalAmount: Number(created.totalAmount),
        paymentMethod: created.paymentMethod,
        role,
      });
    }

    for (const closedShift of closedShifts) {
      try {
        if (
          typeof (prisma.shift as any).findUnique === 'function' &&
          typeof (prisma.shift as any).create === 'function'
        ) {
          const existingShift = await prisma.shift.findUnique({
            where: { id: closedShift.shiftId },
          });
          if (!existingShift) {
            await (prisma.shift as any).create({
              data: {
                id: closedShift.shiftId,
                cashierId: effectiveCashierId,
                startingCash: new Prisma.Decimal('500.00'),
              },
            });
          }
        }

        const reconciled = await ShiftService.closeShift({
          shiftId: closedShift.shiftId,
          cashierId: effectiveCashierId,
          actualEndCash: closedShift.actualEndCash,
        });
        syncedShifts.push(reconciled);
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          (err.message === 'SHIFT_ALREADY_CLOSED' || err.message === 'SHIFT_NOT_FOUND')
        ) {
          continue;
        }
        throw err;
      }
    }

    const responsePayload = {
      conflictResolutionPolicy: 'LOCAL_SALES_IMMUTABLE',
      idempotencyKey: cleanBatchKey || null,
      deduplicatedBatch: false,
      syncedCount: syncedOrders.length,
      skippedCount: skippedOrderNumbers.length,
      skippedOrderNumbers,
      syncedOrders,
      syncedShiftsCount: syncedShifts.length,
      syncedShifts,
    };

    if (cleanBatchKey) {
      if (this.processedBatchKeys.size >= 500) {
        const oldestKey = this.processedBatchKeys.keys().next().value;
        if (oldestKey) this.processedBatchKeys.delete(oldestKey);
      }
      this.processedBatchKeys.set(cleanBatchKey, responsePayload);
    }

    return responsePayload;
  }

  static async pushOfflineOrders(
    cashierId: string,
    role: Role,
    orders: OfflineOrderPayload[],
    batchIdempotencyKey?: string
  ) {
    return this.pushOfflineBatch(cashierId, role, orders, [], [], batchIdempotencyKey);
  }

  /**
   * Generates a complete point-in-time JSON backup snapshot of the supermarket catalog,
   * batches, customers, loyalty settings, and recent shifts/orders.
   * When `persistToDisk` is true, writes a rotated backup file to `backend/backups/`.
   */
  static async generateCloudBackupSnapshot(persistToDisk = true) {
    const products = await ProductService.listProducts(Role.ADMIN);
    const loyaltySettings = await LoyaltyService.getSettings().catch(() => undefined);
    const customers = await LoyaltyService.listCustomers().catch(() => []);

    const snapshot = {
      version: '1.0',
      store: 'ماركت الأمير (Alamir Market)',
      currency: env.CURRENCY,
      generatedAt: new Date().toISOString(),
      counts: {
        products: products.length,
        customers: customers.length,
      },
      loyaltySettings,
      products,
      customers,
    };

    let savedFilePath: string | null = null;
    if (persistToDisk) {
      try {
        const backupsDir = path.resolve(process.cwd(), 'backups');
        if (!fs.existsSync(backupsDir)) {
          fs.mkdirSync(backupsDir, { recursive: true });
        }
        const dateStamp = snapshot.generatedAt.replace(/[:.]/g, '-');
        const fileName = `alamir-pos-backup-${dateStamp}.json`;
        savedFilePath = path.join(backupsDir, fileName);
        fs.writeFileSync(savedFilePath, JSON.stringify(snapshot, null, 2), 'utf8');

        // Rotate: keep the 7 most recent backup snapshots
        const files = fs
          .readdirSync(backupsDir)
          .filter((f) => f.startsWith('alamir-pos-backup-') && f.endsWith('.json'))
          .sort()
          .reverse();
        for (const oldFile of files.slice(7)) {
          fs.unlinkSync(path.join(backupsDir, oldFile));
        }
      } catch {
        savedFilePath = null;
      }
    }

    return {
      ...snapshot,
      savedFilePath,
    };
  }
}
