import { LoyaltyTransactionType, Prisma, WalletTransactionType } from '@prisma/client';
import { prisma } from '../config/db';

export interface LoyaltySettingsDTO {
  id: string;
  isEnabled: boolean;
  spendAmountPerPoint: number;
  redemptionPointsBlock: number;
  redemptionDiscountAmount: number;
  minPointsToRedeem: number;
  maxDiscountCapPercent: number;
  updatedAt?: Date | string;
}

export interface UpdateLoyaltySettingsInput {
  isEnabled?: boolean;
  spendAmountPerPoint?: number;
  redemptionPointsBlock?: number;
  redemptionDiscountAmount?: number;
  minPointsToRedeem?: number;
  maxDiscountCapPercent?: number;
}

export interface CreateCustomerInput {
  name?: string | null;
  phone: string;
  customerCode?: number;
}

export interface LoyaltyCalculationResult {
  pointsRedeemed: number;
  discountFromPoints: number;
  netPayable: number;
  pointsEarned: number;
}

export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettingsDTO = {
  id: 'default',
  isEnabled: true,
  spendAmountPerPoint: 10,
  redemptionPointsBlock: 100,
  redemptionDiscountAmount: 10,
  minPointsToRedeem: 50,
  maxDiscountCapPercent: 50,
};

export function getCustomerDisplayName(customer: {
  name?: string | null;
  customerCode?: number | string | null;
}): string {
  const cleanName = typeof customer?.name === 'string' ? customer.name.trim() : '';
  if (cleanName.length > 0) {
    return cleanName;
  }
  const code = customer?.customerCode ?? 1001;
  return `عميل #${code}`;
}

export function parseCustomerCodeSearch(raw?: string | number | null): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const prefixedMatch = trimmed.match(/^(?:c-|#|عميل\s*#?)(\d{3,8})$/i);
  if (prefixedMatch) {
    return Number(prefixedMatch[1]);
  }
  // Plain 4-to-6 digit code (not starting with 0 like Egyptian phone numbers 010...)
  if (/^[1-9]\d{3,5}$/.test(trimmed)) {
    return Number(trimmed);
  }
  return null;
}

export class LoyaltyService {
  static getCustomerDisplayName = getCustomerDisplayName;

  private static formatSetting(raw: any): LoyaltySettingsDTO {
    if (!raw) return { ...DEFAULT_LOYALTY_SETTINGS };
    return {
      id: raw.id || 'default',
      isEnabled: Boolean(raw.isEnabled ?? true),
      spendAmountPerPoint: Number(raw.spendAmountPerPoint ?? 10),
      redemptionPointsBlock: Number(raw.redemptionPointsBlock ?? 100),
      redemptionDiscountAmount: Number(raw.redemptionDiscountAmount ?? 10),
      minPointsToRedeem: Number(raw.minPointsToRedeem ?? 50),
      maxDiscountCapPercent: Number(raw.maxDiscountCapPercent ?? 50),
      updatedAt: raw.updatedAt,
    };
  }

  static formatCustomer(raw: any) {
    const code = Number(raw.customerCode ?? 1001);
    const cleanName =
      typeof raw.name === 'string' && raw.name.trim().length > 0
        ? raw.name.trim()
        : null;
    return {
      id: raw.id,
      customerCode: code,
      formattedCode: `C-${code}`,
      name: cleanName,
      displayName: getCustomerDisplayName({ name: cleanName, customerCode: code }),
      phone: raw.phone,
      pointsBalance: Number(raw.pointsBalance ?? 0),
      walletBalance: Number(raw.walletBalance ?? 0),
      creditLimit: Number(raw.creditLimit ?? 0),
      creditBalance: Number(raw.creditBalance ?? 0),
      availableCredit: Math.max(
        0,
        Number((Number(raw.creditLimit ?? 0) - Number(raw.creditBalance ?? 0)).toFixed(2))
      ),
      totalSpent: Number(raw.totalSpent ?? 0),
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      loyaltyTransactions: Array.isArray(raw.loyaltyTransactions)
        ? raw.loyaltyTransactions.map((tx: any) => ({
            id: tx.id,
            customerId: tx.customerId,
            orderId: tx.orderId ?? null,
            type: tx.type,
            points: Number(tx.points),
            amountValue: Number(tx.amountValue ?? 0),
            description: tx.description ?? null,
            createdAt: tx.createdAt,
          }))
        : [],
      walletTransactions: Array.isArray(raw.walletTransactions)
        ? raw.walletTransactions.map((wtx: any) => ({
            id: wtx.id,
            customerId: wtx.customerId,
            orderId: wtx.orderId ?? null,
            amount: Number(wtx.amount),
            balanceAfter: Number(wtx.balanceAfter),
            type: wtx.type,
            description: wtx.description ?? null,
            createdAt: wtx.createdAt,
          }))
        : [],
      creditTransactions: Array.isArray(raw.creditTransactions)
        ? raw.creditTransactions.map((ctx: any) => ({
            id: ctx.id,
            customerId: ctx.customerId,
            orderId: ctx.orderId ?? null,
            amount: Number(ctx.amount),
            balanceAfter: Number(ctx.balanceAfter),
            type: ctx.type,
            notes: ctx.notes ?? null,
            createdAt: ctx.createdAt,
          }))
        : [],
    };
  }

  static async getNextCustomerCode(txClient?: any): Promise<number> {
    const client = txClient || prisma;
    const delegate = client?.customer;
    if (!delegate || typeof delegate.findFirst !== 'function') {
      return 1001;
    }
    try {
      const latest = await delegate.findFirst({
        orderBy: { customerCode: 'desc' },
        select: { customerCode: true },
      });
      const currentMax = Number(latest?.customerCode ?? 1000);
      return Math.max(1001, currentMax + 1);
    } catch {
      return 1001;
    }
  }

  static async getSettings(txClient?: any): Promise<LoyaltySettingsDTO> {
    const client = txClient || prisma;
    const delegate = client?.loyaltySetting;
    if (!delegate || typeof delegate.findUnique !== 'function') {
      return { ...DEFAULT_LOYALTY_SETTINGS };
    }

    let setting = await delegate.findUnique({ where: { id: 'default' } });
    if (!setting && typeof delegate.upsert === 'function') {
      setting = await delegate.upsert({
        where: { id: 'default' },
        update: {},
        create: {
          id: 'default',
          isEnabled: DEFAULT_LOYALTY_SETTINGS.isEnabled,
          spendAmountPerPoint: new Prisma.Decimal(
            DEFAULT_LOYALTY_SETTINGS.spendAmountPerPoint.toFixed(2)
          ),
          redemptionPointsBlock: DEFAULT_LOYALTY_SETTINGS.redemptionPointsBlock,
          redemptionDiscountAmount: new Prisma.Decimal(
            DEFAULT_LOYALTY_SETTINGS.redemptionDiscountAmount.toFixed(2)
          ),
          minPointsToRedeem: DEFAULT_LOYALTY_SETTINGS.minPointsToRedeem,
          maxDiscountCapPercent: DEFAULT_LOYALTY_SETTINGS.maxDiscountCapPercent,
        },
      });
    }

    return this.formatSetting(setting);
  }

  static async updateSettings(input: UpdateLoyaltySettingsInput): Promise<LoyaltySettingsDTO> {
    const current = await this.getSettings();
    const next = {
      isEnabled: input.isEnabled !== undefined ? input.isEnabled : current.isEnabled,
      spendAmountPerPoint:
        input.spendAmountPerPoint !== undefined
          ? input.spendAmountPerPoint
          : current.spendAmountPerPoint,
      redemptionPointsBlock:
        input.redemptionPointsBlock !== undefined
          ? input.redemptionPointsBlock
          : current.redemptionPointsBlock,
      redemptionDiscountAmount:
        input.redemptionDiscountAmount !== undefined
          ? input.redemptionDiscountAmount
          : current.redemptionDiscountAmount,
      minPointsToRedeem:
        input.minPointsToRedeem !== undefined
          ? input.minPointsToRedeem
          : current.minPointsToRedeem,
      maxDiscountCapPercent:
        input.maxDiscountCapPercent !== undefined
          ? input.maxDiscountCapPercent
          : current.maxDiscountCapPercent,
    };

    const updated = await prisma.loyaltySetting.upsert({
      where: { id: 'default' },
      update: {
        isEnabled: next.isEnabled,
        spendAmountPerPoint: new Prisma.Decimal(next.spendAmountPerPoint.toFixed(2)),
        redemptionPointsBlock: next.redemptionPointsBlock,
        redemptionDiscountAmount: new Prisma.Decimal(next.redemptionDiscountAmount.toFixed(2)),
        minPointsToRedeem: next.minPointsToRedeem,
        maxDiscountCapPercent: next.maxDiscountCapPercent,
      },
      create: {
        id: 'default',
        isEnabled: next.isEnabled,
        spendAmountPerPoint: new Prisma.Decimal(next.spendAmountPerPoint.toFixed(2)),
        redemptionPointsBlock: next.redemptionPointsBlock,
        redemptionDiscountAmount: new Prisma.Decimal(next.redemptionDiscountAmount.toFixed(2)),
        minPointsToRedeem: next.minPointsToRedeem,
        maxDiscountCapPercent: next.maxDiscountCapPercent,
      },
    });

    return this.formatSetting(updated);
  }

  static async listCustomers(query?: {
    phone?: string;
    customerCode?: string;
    search?: string;
  }) {
    const delegate = (prisma as any).customer;
    if (!delegate || typeof delegate.findMany !== 'function') {
      return [];
    }

    const where: Prisma.CustomerWhereInput = {};
    if (query?.customerCode) {
      const parsedCode = parseCustomerCodeSearch(query.customerCode);
      if (parsedCode !== null) {
        where.customerCode = parsedCode;
      }
    } else if (query?.phone) {
      const parsedCodeFromPhone = parseCustomerCodeSearch(query.phone);
      if (parsedCodeFromPhone !== null) {
        where.OR = [
          { customerCode: parsedCodeFromPhone },
          { phone: query.phone.trim() },
        ];
      } else {
        where.phone = query.phone.trim();
      }
    } else if (query?.search) {
      const q = query.search.trim();
      const parsedCode = parseCustomerCodeSearch(q);
      const orClauses: Prisma.CustomerWhereInput[] = [
        { phone: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ];
      if (parsedCode !== null) {
        orClauses.unshift({ customerCode: parsedCode });
      }
      where.OR = orClauses;
    }

    const customers = await delegate.findMany({
      where,
      include: {
        loyaltyTransactions: {
          orderBy: { createdAt: 'desc' },
          take: 25,
        },
        walletTransactions: {
          orderBy: { createdAt: 'desc' },
          take: 25,
        },
        creditTransactions: {
          orderBy: { createdAt: 'desc' },
          take: 25,
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return customers.map((c: any) => this.formatCustomer(c));
  }

  static async createOrGetCustomer(input: CreateCustomerInput) {
    const cleanPhone = input.phone.trim();
    const cleanName =
      typeof input.name === 'string' && input.name.trim().length > 0
        ? input.name.trim()
        : null;

    let nextCode = input.customerCode ?? (await this.getNextCustomerCode());

    const runUpsert = async (codeToUse: number) =>
      prisma.customer.upsert({
        where: { phone: cleanPhone },
        update: cleanName ? { name: cleanName } : {},
        create: {
          customerCode: codeToUse,
          name: cleanName,
          phone: cleanPhone,
          pointsBalance: 0,
          walletBalance: new Prisma.Decimal('0.00'),
          totalSpent: new Prisma.Decimal('0.00'),
        },
        include: {
          loyaltyTransactions: {
            orderBy: { createdAt: 'desc' },
            take: 25,
          },
          walletTransactions: {
            orderBy: { createdAt: 'desc' },
            take: 25,
          },
        },
      });

    let customer: any;
    try {
      customer = await runUpsert(nextCode);
    } catch (err: any) {
      if (err?.code === 'P2002') {
        nextCode = await this.getNextCustomerCode();
        customer = await runUpsert(nextCode);
      } else {
        throw err;
      }
    }

    return this.formatCustomer(customer);
  }

  /**
   * Computes allowed points redemption, discount in EGP, net payable total, and new points earned.
   */
  static calculateOrderLoyalty(params: {
    orderSubtotal: number;
    customerPointsBalance: number;
    redeemPoints?: boolean | number;
    settings: LoyaltySettingsDTO;
  }): LoyaltyCalculationResult {
    const { orderSubtotal, customerPointsBalance, redeemPoints, settings } = params;
    const cleanSubtotal = Math.max(0, Number(orderSubtotal.toFixed(2)));

    if (!settings.isEnabled || cleanSubtotal <= 0) {
      return {
        pointsRedeemed: 0,
        discountFromPoints: 0,
        netPayable: cleanSubtotal,
        pointsEarned: 0,
      };
    }

    let pointsRedeemed = 0;
    let discountFromPoints = 0;

    const wantsRedeem =
      (typeof redeemPoints === 'boolean' && redeemPoints) ||
      (typeof redeemPoints === 'number' && redeemPoints > 0);

    if (
      wantsRedeem &&
      customerPointsBalance >= settings.minPointsToRedeem &&
      settings.redemptionPointsBlock > 0 &&
      settings.redemptionDiscountAmount > 0
    ) {
      const valuePerPoint =
        settings.redemptionDiscountAmount / settings.redemptionPointsBlock;
      const maxDiscountByCap = Number(
        ((cleanSubtotal * settings.maxDiscountCapPercent) / 100).toFixed(2)
      );
      const maxPointsByCap = Math.floor(maxDiscountByCap / valuePerPoint);

      const requestedPoints =
        typeof redeemPoints === 'number'
          ? Math.min(Math.floor(redeemPoints), customerPointsBalance)
          : customerPointsBalance;

      const candidatePoints = Math.min(
        requestedPoints,
        customerPointsBalance,
        maxPointsByCap
      );

      if (candidatePoints >= settings.minPointsToRedeem) {
        pointsRedeemed = candidatePoints;
        discountFromPoints = Number((pointsRedeemed * valuePerPoint).toFixed(2));
      }
    }

    const netPayable = Number(Math.max(0, cleanSubtotal - discountFromPoints).toFixed(2));
    const pointsEarned =
      settings.spendAmountPerPoint > 0
        ? Math.floor(netPayable / settings.spendAmountPerPoint)
        : 0;

    return {
      pointsRedeemed,
      discountFromPoints,
      netPayable,
      pointsEarned,
    };
  }

  /**
   * Records REDEEM/EARN loyalty transactions AND PURCHASE_PAYMENT/CHANGE_DEPOSIT wallet transactions
   * and updates Customer pointsBalance, walletBalance, and totalSpent atomically inside `tx`.
   */
  static async recordOrderLoyaltyInTx(
    tx: any,
    params: {
      customerId: string;
      orderId: string;
      orderNumber: string;
      netPayable: number;
      pointsEarned: number;
      pointsRedeemed: number;
      discountFromPoints: number;
      walletAmountUsed?: number;
      changeDepositedToWallet?: number;
    }
  ) {
    const customerDelegate = tx?.customer;
    const loyaltyTxDelegate = tx?.loyaltyTransaction;
    const walletTxDelegate = tx?.walletTransaction;
    if (!customerDelegate || typeof customerDelegate.findUnique !== 'function') {
      return null;
    }

    const customer = await customerDelegate.findUnique({
      where: { id: params.customerId },
    });
    if (!customer) {
      throw new Error('CUSTOMER_NOT_FOUND');
    }

    if (params.pointsRedeemed > 0 && customer.pointsBalance < params.pointsRedeemed) {
      throw new Error('INSUFFICIENT_LOYALTY_POINTS');
    }

    const walletAmountUsed = Number((params.walletAmountUsed ?? 0).toFixed(2));
    const changeDepositedToWallet = Number(
      (params.changeDepositedToWallet ?? 0).toFixed(2)
    );
    const currentWalletBalance = Number(customer.walletBalance ?? 0);

    if (walletAmountUsed > 0 && currentWalletBalance + 0.001 < walletAmountUsed) {
      throw new Error('INSUFFICIENT_WALLET_BALANCE');
    }

    const balanceAfterDebit = Number(
      (currentWalletBalance - walletAmountUsed).toFixed(2)
    );
    const finalWalletBalance = Number(
      (balanceAfterDebit + changeDepositedToWallet).toFixed(2)
    );

    const newPointsBalance =
      Number(customer.pointsBalance) - params.pointsRedeemed + params.pointsEarned;
    const newTotalSpent = Number(customer.totalSpent ?? 0) + params.netPayable;

    const updateData: any = {
      pointsBalance: newPointsBalance,
      totalSpent: new Prisma.Decimal(newTotalSpent.toFixed(2)),
    };
    if (
      walletAmountUsed > 0 ||
      changeDepositedToWallet > 0 ||
      customer.walletBalance !== undefined
    ) {
      updateData.walletBalance = new Prisma.Decimal(finalWalletBalance.toFixed(2));
    }

    const updatedCustomer = await customerDelegate.update({
      where: { id: customer.id },
      data: updateData,
    });

    if (loyaltyTxDelegate && typeof loyaltyTxDelegate.create === 'function') {
      if (params.pointsRedeemed > 0) {
        await loyaltyTxDelegate.create({
          data: {
            customerId: customer.id,
            orderId: params.orderId,
            type: LoyaltyTransactionType.REDEEM,
            points: -params.pointsRedeemed,
            amountValue: new Prisma.Decimal(params.discountFromPoints.toFixed(2)),
            description: `استبدال ${params.pointsRedeemed} نقطة بخصم ${params.discountFromPoints.toFixed(2)} ج.م على الفاتورة ${params.orderNumber}`,
          },
        });
      }

      if (params.pointsEarned > 0) {
        await loyaltyTxDelegate.create({
          data: {
            customerId: customer.id,
            orderId: params.orderId,
            type: LoyaltyTransactionType.EARN,
            points: params.pointsEarned,
            amountValue: new Prisma.Decimal(params.netPayable.toFixed(2)),
            description: `اكتساب ${params.pointsEarned} نقطة من الفاتورة ${params.orderNumber}`,
          },
        });
      }
    }

    if (walletTxDelegate && typeof walletTxDelegate.create === 'function') {
      if (walletAmountUsed > 0) {
        await walletTxDelegate.create({
          data: {
            customerId: customer.id,
            orderId: params.orderId,
            amount: new Prisma.Decimal((-walletAmountUsed).toFixed(2)),
            balanceAfter: new Prisma.Decimal(balanceAfterDebit.toFixed(2)),
            type: WalletTransactionType.PURCHASE_PAYMENT,
            description: `سداد من رصيد محفظة الفكة للفاتورة ${params.orderNumber}`,
          },
        });
      }

      if (changeDepositedToWallet > 0) {
        await walletTxDelegate.create({
          data: {
            customerId: customer.id,
            orderId: params.orderId,
            amount: new Prisma.Decimal(changeDepositedToWallet.toFixed(2)),
            balanceAfter: new Prisma.Decimal(finalWalletBalance.toFixed(2)),
            type: WalletTransactionType.CHANGE_DEPOSIT,
            description: `إيداع باقي الفكة في المحفظة من الفاتورة ${params.orderNumber}`,
          },
        });
      }
    }

    const code = Number(updatedCustomer.customerCode ?? customer.customerCode ?? 1001);
    const cleanName =
      typeof updatedCustomer.name === 'string' && updatedCustomer.name.trim().length > 0
        ? updatedCustomer.name.trim()
        : null;

    return {
      id: updatedCustomer.id,
      customerCode: code,
      formattedCode: `C-${code}`,
      name: cleanName,
      displayName: getCustomerDisplayName({ name: cleanName, customerCode: code }),
      phone: updatedCustomer.phone,
      pointsBalance: Number(updatedCustomer.pointsBalance),
      walletBalance: Number(updatedCustomer.walletBalance ?? finalWalletBalance),
      totalSpent: Number(updatedCustomer.totalSpent),
    };
  }

  static async updateCustomerCreditLimit(customerId: string, creditLimit: number) {
    const validLimit = Math.max(0, Number(creditLimit));
    const customer = await prisma.customer.update({
      where: { id: customerId },
      data: {
        creditLimit: new Prisma.Decimal(validLimit.toFixed(2)),
      },
      include: {
        loyaltyTransactions: { orderBy: { createdAt: 'desc' }, take: 25 },
        walletTransactions: { orderBy: { createdAt: 'desc' }, take: 25 },
        creditTransactions: { orderBy: { createdAt: 'desc' }, take: 25 },
      },
    });
    return this.formatCustomer(customer);
  }

  static async settleCustomerDebt(params: {
    customerId: string;
    amount: number;
    notes?: string;
    cashierId?: string;
    shiftId?: string;
  }) {
    const settleAmount = Number(params.amount);
    if (!Number.isFinite(settleAmount) || settleAmount <= 0) {
      throw new Error('INVALID_SETTLEMENT_AMOUNT');
    }

    return prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: params.customerId },
      });
      if (!customer) {
        throw new Error('CUSTOMER_NOT_FOUND');
      }

      const currentDebt = Number(customer.creditBalance ?? 0);
      if (currentDebt <= 0) {
        throw new Error('NO_OUTSTANDING_DEBT');
      }
      if (settleAmount > currentDebt) {
        throw new Error(`SETTLEMENT_EXCEEDS_DEBT:${currentDebt}`);
      }

      const newBalance = Number((currentDebt - settleAmount).toFixed(2));
      const updatedCustomer = await tx.customer.update({
        where: { id: customer.id },
        data: {
          creditBalance: new Prisma.Decimal(newBalance.toFixed(2)),
        },
      });

      const creditTx = await tx.creditTransaction.create({
        data: {
          customerId: customer.id,
          amount: new Prisma.Decimal(settleAmount.toFixed(2)),
          balanceAfter: new Prisma.Decimal(newBalance.toFixed(2)),
          type: 'SETTLEMENT_PAYMENT',
          notes: params.notes || 'سداد دفعة نقدية من الحساب الآجل (شكك)',
        },
      });

      let targetShiftId = params.shiftId;
      if (!targetShiftId && params.cashierId) {
        const activeShift = await tx.shift.findFirst({
          where: { cashierId: params.cashierId, closedAt: null },
        });
        if (activeShift) {
          targetShiftId = activeShift.id;
        }
      }

      if (targetShiftId && params.cashierId) {
        await tx.cashMovement.create({
          data: {
            shiftId: targetShiftId,
            cashierId: params.cashierId,
            type: 'CASH_IN',
            amount: new Prisma.Decimal(settleAmount.toFixed(2)),
            reason: `سداد دفعة حساب آجل للعميل ${customer.name || customer.phone}`,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          action: 'DEBT_SETTLEMENT',
          cashierId: params.cashierId,
          details: `سداد آجل بمبلغ ${settleAmount} ج.م للعميل ${customer.phone}. الرصيد المتبقي: ${newBalance} ج.م`,
        },
      });

      return {
        customer: this.formatCustomer(updatedCustomer),
        transaction: {
          id: creditTx.id,
          amount: settleAmount,
          balanceAfter: newBalance,
          createdAt: creditTx.createdAt,
          notes: creditTx.notes,
        },
      };
    });
  }

  static async getCustomerStatement(customerId: string) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            orderNumber: true,
            totalAmount: true,
            paymentMethod: true,
            isReturned: true,
            createdAt: true,
          },
        },
        creditTransactions: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        walletTransactions: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        loyaltyTransactions: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!customer) {
      throw new Error('CUSTOMER_NOT_FOUND');
    }

    return {
      customer: this.formatCustomer(customer),
      orders: customer.orders.map((o) => ({
        ...o,
        totalAmount: Number(o.totalAmount),
      })),
      creditTransactions: customer.creditTransactions.map((c) => ({
        ...c,
        amount: Number(c.amount),
        balanceAfter: Number(c.balanceAfter),
      })),
      walletTransactions: customer.walletTransactions.map((w) => ({
        ...w,
        amount: Number(w.amount),
        balanceAfter: Number(w.balanceAfter),
      })),
      loyaltyTransactions: customer.loyaltyTransactions.map((l) => ({
        ...l,
        amountValue: Number(l.amountValue),
      })),
    };
  }
}
