import { Prisma, PaymentMethod } from '@prisma/client';
import { prisma } from '../config/db';
import { env } from '../config/env';

export interface OpenShiftInput {
  cashierId: string;
  startingCash: number;
}

export interface CloseShiftInput {
  shiftId?: string;
  cashierId: string;
  actualEndCash: number;
}

export class ShiftService {
  static async openShift(input: OpenShiftInput) {
    return prisma.$transaction(async (tx) => {
      const activeShift = await tx.shift.findFirst({
        where: {
          cashierId: input.cashierId,
          closedAt: null,
        },
      });

      if (activeShift) {
        throw new Error('ACTIVE_SHIFT_EXISTS');
      }

      const created = await tx.shift.create({
        data: {
          cashierId: input.cashierId,
          startingCash: new Prisma.Decimal(input.startingCash),
        },
      });

      return {
        ...created,
        startingCash: Number(created.startingCash),
      };
    });
  }

  static async getActiveShift(cashierId: string) {
    const shift = await prisma.shift.findFirst({
      where: {
        cashierId,
        closedAt: null,
      },
      include: {
        orders: true,
      },
    });

    if (!shift) {
      return null;
    }

    return {
      ...shift,
      startingCash: Number(shift.startingCash),
    };
  }

  static async closeShift(input: CloseShiftInput) {
    return prisma.$transaction(async (tx) => {
      const shift = input.shiftId
        ? await tx.shift.findUnique({
            where: { id: input.shiftId },
            include: {
              cashier: {
                select: { id: true, name: true, username: true },
              },
              orders: {
                include: { items: true },
              },
              cashMovements: true,
            },
          })
        : await tx.shift.findFirst({
            where: {
              cashierId: input.cashierId,
              closedAt: null,
            },
            include: {
              cashier: {
                select: { id: true, name: true, username: true },
              },
              orders: {
                include: { items: true },
              },
              cashMovements: true,
            },
          });

      if (!shift) {
        throw new Error('SHIFT_NOT_FOUND');
      }

      if (shift.closedAt !== null) {
        throw new Error('SHIFT_ALREADY_CLOSED');
      }

      let totalCashSales = 0;
      let totalCardSales = 0;
      let totalSplitSales = 0;
      let totalReturns = 0;
      let cashReturns = 0;
      let totalChangeCreditedToWallets = 0;
      let totalWalletRedemptions = 0;
      let validOrdersCount = 0;
      let returnedOrdersCount = 0;

      for (const order of shift.orders) {
        const amount = Number(order.totalAmount);
        const changeToWallet = Number((order as any).changeDepositedToWallet ?? 0);
        const walletUsed = Number((order as any).walletAmountUsed ?? 0);

        // Total gross sales recorded on this shift
        if (order.paymentMethod === PaymentMethod.CASH) {
          totalCashSales += amount;
        } else if (order.paymentMethod === PaymentMethod.CARD) {
          totalCardSales += amount;
        } else if (order.paymentMethod === PaymentMethod.SPLIT) {
          totalSplitSales += amount;
        }

        if (order.isReturned) {
          returnedOrdersCount++;
          totalReturns = Number((totalReturns + amount).toFixed(2));
          if (order.paymentMethod === PaymentMethod.CASH) {
            cashReturns = Number((cashReturns + amount).toFixed(2));
          }
        } else {
          validOrdersCount++;
          totalChangeCreditedToWallets += changeToWallet;
          totalWalletRedemptions += walletUsed;

          if (Array.isArray((order as any).items)) {
            const partialReturnAmount = (order as any).items.reduce(
              (sum: number, item: any) => {
                const retQty = Number(item.returnedQuantity ?? 0);
                return retQty > 0 ? sum + retQty * Number(item.unitPrice) : sum;
              },
              0
            );
            if (partialReturnAmount > 0) {
              const roundedPartial = Number(partialReturnAmount.toFixed(2));
              totalReturns = Number((totalReturns + roundedPartial).toFixed(2));
              if (order.paymentMethod === PaymentMethod.CASH) {
                cashReturns = Number((cashReturns + roundedPartial).toFixed(2));
              }
            }
          }
        }
      }

      let totalCashIn = 0;
      let totalCashOut = 0;
      for (const movement of (shift as any).cashMovements ?? []) {
        const mAmount = Number(movement.amount ?? 0);
        if (movement.type === 'CASH_IN') {
          totalCashIn += mAmount;
        } else if (movement.type === 'CASH_OUT') {
          totalCashOut += mAmount;
        }
      }

      const startingCash = Number(shift.startingCash);
      // Physical drawer cash = startingCash + cash sales - cash returns + change retained in wallets - wallet redemptions + cash in - cash out
      const expectedCash = Number(
        (
          startingCash +
          totalCashSales -
          cashReturns +
          totalChangeCreditedToWallets -
          totalWalletRedemptions +
          totalCashIn -
          totalCashOut
        ).toFixed(2)
      );
      const actualEndCash = Number(input.actualEndCash.toFixed(2));
      // discrepancy = actualEndCash - expectedCash
      const discrepancy = Number((actualEndCash - expectedCash).toFixed(2));

      const updatedShift = await tx.shift.update({
        where: { id: shift.id },
        data: {
          actualEndCash: new Prisma.Decimal(actualEndCash),
          expectedCash: new Prisma.Decimal(expectedCash),
          discrepancy: new Prisma.Decimal(discrepancy),
          closedAt: new Date(),
        },
      });

      const statusLabel =
        discrepancy === 0 ? 'مطابق' : discrepancy > 0 ? 'فائض في الدرج' : 'عجز في الدرج';

      return {
        shiftId: updatedShift.id,
        storeName: 'ماركت الأمير (Alamir Market)',
        currency: env.CURRENCY,
        cashier: shift.cashier,
        openedAt: updatedShift.openedAt,
        closedAt: updatedShift.closedAt,
        startingCash,
        totalCashSales: Number(totalCashSales.toFixed(2)),
        totalCardSales: Number(totalCardSales.toFixed(2)),
        totalSplitSales: Number(totalSplitSales.toFixed(2)),
        totalReturns: Number(totalReturns.toFixed(2)),
        cashReturns: Number(cashReturns.toFixed(2)),
        totalChangeCreditedToWallets: Number(totalChangeCreditedToWallets.toFixed(2)),
        totalWalletRedemptions: Number(totalWalletRedemptions.toFixed(2)),
        totalCashIn: Number(totalCashIn.toFixed(2)),
        totalCashOut: Number(totalCashOut.toFixed(2)),
        cashSales: Number((totalCashSales - cashReturns).toFixed(2)),
        cardSales: Number(totalCardSales.toFixed(2)),
        splitSales: Number(totalSplitSales.toFixed(2)),
        returnedCashTotal: Number(cashReturns.toFixed(2)),
        validOrdersCount,
        returnedOrdersCount,
        cashMovements: ((shift as any).cashMovements ?? []).map((m: any) => ({
          id: m.id,
          type: m.type,
          amount: Number(m.amount),
          reason: m.reason,
          createdAt: m.createdAt,
        })),
        expectedCash,
        actualEndCash,
        discrepancy,
        reconciliationStatus: statusLabel,
      };
    });
  }

  static async recordCashMovement(params: {
    shiftId?: string;
    cashierId: string;
    type: 'CASH_IN' | 'CASH_OUT';
    amount: number;
    reason: string;
  }) {
    const validAmount = Number(params.amount);
    if (!Number.isFinite(validAmount) || validAmount <= 0) {
      throw new Error('INVALID_CASH_MOVEMENT_AMOUNT');
    }
    const cleanReason = params.reason?.trim();
    if (!cleanReason) {
      throw new Error('REASON_REQUIRED');
    }

    return prisma.$transaction(async (tx) => {
      let shiftId = params.shiftId;
      if (!shiftId) {
        const active = await tx.shift.findFirst({
          where: { cashierId: params.cashierId, closedAt: null },
        });
        if (!active) {
          throw new Error('NO_ACTIVE_SHIFT');
        }
        shiftId = active.id;
      }

      const movement = await tx.cashMovement.create({
        data: {
          shiftId,
          cashierId: params.cashierId,
          type: params.type,
          amount: new Prisma.Decimal(validAmount.toFixed(2)),
          reason: cleanReason,
        },
      });

      return {
        ...movement,
        amount: Number(movement.amount),
      };
    });
  }

  static async getShiftCashMovements(shiftId: string) {
    const movements = await prisma.cashMovement.findMany({
      where: { shiftId },
      orderBy: { createdAt: 'desc' },
    });
    return movements.map((m) => ({
      ...m,
      amount: Number(m.amount),
    }));
  }
}
