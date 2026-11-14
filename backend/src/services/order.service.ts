import { Prisma, PaymentMethod, Role } from '@prisma/client';
import { prisma } from '../config/db';
import { env } from '../config/env';
import { ProductService } from './product.service';
import {
  LoyaltyService,
  getCustomerDisplayName,
  parseCustomerCodeSearch,
} from './loyalty.service';

export interface CheckoutItemInput {
  productId: string;
  quantity: number;
}

export interface CreateOrderInput {
  shiftId?: string;
  cashierId: string;
  paymentMethod: PaymentMethod;
  orderNumber?: string;
  customerId?: string;
  customerCode?: number | string;
  customerPhone?: string;
  customerName?: string | null;
  redeemPoints?: boolean | number;
  paidAmount?: number;
  changeGiven?: number;
  changeDepositedToWallet?: number;
  walletAmountUsed?: number;
  useWallet?: boolean;
  items: CheckoutItemInput[];
}

export interface CreatePublicOnlineOrderInput {
  customerPhone: string;
  customerName?: string | null;
  deliveryAddress: string;
  deliveryNotes?: string | null;
  paymentMethod?: PaymentMethod;
  redeemPoints?: boolean | number;
  useWallet?: boolean;
  walletAmountUsed?: number;
  items: CheckoutItemInput[];
}

export class OrderService {
  private static sanitizeOrderForRole(
    order: any,
    role: Role,
    loyaltySummary?: any,
    refundMethod?: string
  ) {
    const items = (order.items || []).map((item: any) => {
      const returnedQuantity = Number(item.returnedQuantity ?? 0);
      const unitPrice = Number(item.unitPrice);
      const base = {
        id: item.id,
        productId: item.productId,
        productName: item.product?.name,
        barcode: item.product?.barcode,
        quantity: item.quantity,
        returnedQuantity,
        unitPrice,
        lineTotal: Number((unitPrice * item.quantity).toFixed(2)),
        returnedTotal: Number((unitPrice * returnedQuantity).toFixed(2)),
      };

      if (role === Role.ADMIN) {
        return {
          ...base,
          costPrice: Number(item.costPrice),
        };
      }
      return base;
    });

    const returnedTotalAmount = Number(
      items.reduce((sum: number, i: any) => sum + (i.returnedTotal || 0), 0).toFixed(2)
    );
    const hasPartialReturn =
      !order.isReturned && items.some((i: any) => (i.returnedQuantity || 0) > 0);

    const totalAmount = Number(order.totalAmount);
    const paidAmount = Number(
      order.paidAmount ?? loyaltySummary?.paidAmount ?? totalAmount
    );
    const changeGiven = Number(order.changeGiven ?? loyaltySummary?.changeGiven ?? 0);
    const changeDepositedToWallet = Number(
      order.changeDepositedToWallet ?? loyaltySummary?.changeDepositedToWallet ?? 0
    );
    const walletAmountUsed = Number(
      order.walletAmountUsed ?? loyaltySummary?.walletAmountUsed ?? 0
    );

    const customerCode =
      order.customer?.customerCode ?? loyaltySummary?.customerCode ?? null;
    const rawCustomerName =
      order.customer?.name ?? loyaltySummary?.rawCustomerName ?? null;
    const hasCustomer = Boolean(
      order.customerId || loyaltySummary?.customerId || customerCode
    );
    const displayCustomerName = hasCustomer
      ? loyaltySummary?.customerName ??
        getCustomerDisplayName({ name: rawCustomerName, customerCode })
      : null;

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      shiftId: order.shiftId,
      cashierId: order.cashierId,
      cashierName: order.cashier?.name ?? order.cashier?.username ?? null,
      customerId: order.customerId ?? loyaltySummary?.customerId ?? null,
      customerCode: customerCode !== null ? Number(customerCode) : null,
      customerFormattedCode: customerCode !== null ? `C-${customerCode}` : null,
      customerName: displayCustomerName,
      customerPhone: order.customer?.phone ?? loyaltySummary?.customerPhone ?? null,
      pointsEarned: Number(order.pointsEarned ?? loyaltySummary?.pointsEarned ?? 0),
      pointsRedeemed: Number(order.pointsRedeemed ?? loyaltySummary?.pointsRedeemed ?? 0),
      discountFromPoints: Number(
        order.discountFromPoints ?? loyaltySummary?.discountFromPoints ?? 0
      ),
      customerPointsBalance:
        loyaltySummary?.customerPointsBalance ??
        (order.customer ? Number(order.customer.pointsBalance) : null),
      customerWalletBalance:
        loyaltySummary?.customerWalletBalance ??
        (order.customer && order.customer.walletBalance !== undefined
          ? Number(order.customer.walletBalance)
          : null),
      totalAmount,
      paidAmount,
      changeGiven,
      changeDepositedToWallet,
      walletAmountUsed,
      currency: env.CURRENCY,
      paymentMethod: order.paymentMethod,
      refundMethod: refundMethod ?? null,
      isReturned: order.isReturned,
      hasPartialReturn,
      returnedTotalAmount,
      createdAt: order.createdAt,
      items,
    };
  }

  static async createOrderFIFO(input: CreateOrderInput, role: Role) {
    let loyaltySummary: any = null;

    const executedOrder = await prisma.$transaction(async (tx) => {
      const shift = input.shiftId
        ? await tx.shift.findUnique({
            where: { id: input.shiftId },
          })
        : await tx.shift.findFirst({
            where: {
              cashierId: input.cashierId,
              closedAt: null,
            },
          });

      if (!shift || shift.closedAt !== null) {
        throw new Error('SHIFT_CLOSED_OR_INVALID');
      }

      let orderSubtotal = 0;
      const orderItemsToCreate: Array<{
        productId: string;
        quantity: number;
        unitPrice: Prisma.Decimal;
        costPrice: Prisma.Decimal;
      }> = [];

      for (const reqItem of input.items) {
        const product = await tx.product.findUnique({
          where: { id: reqItem.productId },
        });

        if (!product) {
          throw new Error(`PRODUCT_NOT_FOUND:${reqItem.productId}`);
        }

        let fifoResult;
        try {
          fifoResult = await ProductService.deductProductStockFIFO(
            reqItem.productId,
            reqItem.quantity,
            tx
          );
        } catch (err: unknown) {
          if (err instanceof Error && err.message.startsWith('INSUFFICIENT_STOCK:')) {
            throw new Error(`INSUFFICIENT_STOCK:${product.name}`);
          }
          throw err;
        }

        const unitRetailPrice = Number(product.retailPrice);

        for (const allocation of fifoResult.allocations) {
          orderSubtotal += allocation.deductedQuantity * unitRetailPrice;
          orderItemsToCreate.push({
            productId: product.id,
            quantity: allocation.deductedQuantity,
            unitPrice: product.retailPrice,
            costPrice: allocation.costPrice,
          });
        }
      }

      const generatedOrderNumber =
        input.orderNumber || (await this.getNextOrderNumber(tx));

      let finalPayableTotal = orderSubtotal;
      let resolvedCustomer: any = null;
      let pointsEarned = 0;
      let pointsRedeemed = 0;
      let discountFromPoints = 0;

      const customerDelegate = (tx as any).customer;
      if (
        (input.customerId || input.customerCode || input.customerPhone) &&
        customerDelegate &&
        typeof customerDelegate.findUnique === 'function'
      ) {
        if (input.customerId) {
          resolvedCustomer = await customerDelegate.findUnique({
            where: { id: input.customerId },
          });
        }

        if (!resolvedCustomer && input.customerCode !== undefined) {
          const parsedCode = parseCustomerCodeSearch(input.customerCode);
          if (parsedCode !== null) {
            resolvedCustomer = await customerDelegate.findUnique({
              where: { customerCode: parsedCode },
            });
          }
        }

        if (!resolvedCustomer && input.customerPhone) {
          const cleanPhone = input.customerPhone.trim();
          const codeFromInput = parseCustomerCodeSearch(cleanPhone);
          if (codeFromInput !== null) {
            resolvedCustomer = await customerDelegate.findUnique({
              where: { customerCode: codeFromInput },
            });
          }
          if (!resolvedCustomer) {
            resolvedCustomer = await customerDelegate.findUnique({
              where: { phone: cleanPhone },
            });
          }
          if (!resolvedCustomer && typeof customerDelegate.create === 'function') {
            const nextCode = await LoyaltyService.getNextCustomerCode(tx);
            const cleanName =
              typeof input.customerName === 'string' &&
              input.customerName.trim().length > 0
                ? input.customerName.trim()
                : null;
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
          }
        }

        if (!resolvedCustomer) {
          throw new Error('CUSTOMER_NOT_FOUND');
        }

        const settings = await LoyaltyService.getSettings(tx);
        const calc = LoyaltyService.calculateOrderLoyalty({
          orderSubtotal,
          customerPointsBalance: Number(resolvedCustomer.pointsBalance ?? 0),
          redeemPoints: input.redeemPoints,
          settings,
        });

        pointsEarned = calc.pointsEarned;
        pointsRedeemed = calc.pointsRedeemed;
        discountFromPoints = calc.discountFromPoints;
        finalPayableTotal = calc.netPayable;
      }

      if (input.paymentMethod === PaymentMethod.CREDIT) {
        if (!resolvedCustomer) {
          throw new Error('CUSTOMER_REQUIRED_FOR_CREDIT');
        }
        const creditLimit = Number(resolvedCustomer.creditLimit ?? 0);
        const currentDebt = Number(resolvedCustomer.creditBalance ?? 0);
        if (creditLimit <= 0) {
          throw new Error('NO_CREDIT_FACILITY');
        }
        if (currentDebt + finalPayableTotal > creditLimit) {
          throw new Error(`CREDIT_LIMIT_EXCEEDED:${(creditLimit - currentDebt).toFixed(2)}`);
        }
      }

      // Smart Change Wallet calculation
      const customerWalletBefore = resolvedCustomer
        ? Number(resolvedCustomer.walletBalance ?? 0)
        : 0;

      let walletAmountUsed =
        input.walletAmountUsed !== undefined
          ? Number(input.walletAmountUsed.toFixed(2))
          : input.useWallet && resolvedCustomer
          ? Number(Math.min(customerWalletBefore, finalPayableTotal).toFixed(2))
          : 0;

      if (walletAmountUsed > finalPayableTotal) {
        walletAmountUsed = Number(finalPayableTotal.toFixed(2));
      }

      const remainingCashDue = Number(
        Math.max(0, finalPayableTotal - walletAmountUsed).toFixed(2)
      );

      const paidAmount =
        input.paidAmount !== undefined
          ? Number(input.paidAmount.toFixed(2))
          : remainingCashDue;

      const totalChangeDue = Number(
        Math.max(0, paidAmount - remainingCashDue).toFixed(2)
      );

      const changeDepositedToWallet =
        input.changeDepositedToWallet !== undefined
          ? Number(input.changeDepositedToWallet.toFixed(2))
          : 0;

      const changeGiven =
        input.changeGiven !== undefined
          ? Number(input.changeGiven.toFixed(2))
          : Number(Math.max(0, totalChangeDue - changeDepositedToWallet).toFixed(2));

      if ((walletAmountUsed > 0 || changeDepositedToWallet > 0) && !resolvedCustomer) {
        throw new Error('CUSTOMER_NOT_FOUND');
      }

      const hasWalletOrCashFields =
        resolvedCustomer !== null ||
        input.paidAmount !== undefined ||
        input.changeGiven !== undefined ||
        input.changeDepositedToWallet !== undefined ||
        input.walletAmountUsed !== undefined;

      const orderData: any = {
        orderNumber: generatedOrderNumber,
        shiftId: shift.id,
        cashierId: input.cashierId,
        totalAmount: new Prisma.Decimal(finalPayableTotal.toFixed(2)),
        paymentMethod: input.paymentMethod,
        items: {
          create: orderItemsToCreate,
        },
      };

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

      if (input.paymentMethod === PaymentMethod.CREDIT && resolvedCustomer) {
        const currentDebt = Number(resolvedCustomer.creditBalance ?? 0);
        const nextDebt = Number((currentDebt + finalPayableTotal).toFixed(2));
        await (tx as any).customer.update({
          where: { id: resolvedCustomer.id },
          data: {
            creditBalance: new Prisma.Decimal(nextDebt.toFixed(2)),
          },
        });
        await (tx as any).creditTransaction.create({
          data: {
            customerId: resolvedCustomer.id,
            orderId: createdOrder.id,
            amount: new Prisma.Decimal(finalPayableTotal.toFixed(2)),
            balanceAfter: new Prisma.Decimal(nextDebt.toFixed(2)),
            type: 'PURCHASE_DEBT',
            notes: `شراء بالآجل - فاتورة رقم ${createdOrder.orderNumber}`,
          },
        });
        resolvedCustomer.creditBalance = nextDebt;
      }

      if (resolvedCustomer) {
        const updatedCustomer = await LoyaltyService.recordOrderLoyaltyInTx(tx, {
          customerId: resolvedCustomer.id,
          orderId: createdOrder.id,
          orderNumber: createdOrder.orderNumber,
          netPayable: finalPayableTotal,
          pointsEarned,
          pointsRedeemed,
          discountFromPoints,
          walletAmountUsed,
          changeDepositedToWallet,
        });

        const code = Number(
          updatedCustomer?.customerCode ?? resolvedCustomer.customerCode ?? 1001
        );
        const rawName = updatedCustomer?.name ?? resolvedCustomer.name ?? null;

        loyaltySummary = {
          customerId: resolvedCustomer.id,
          customerCode: code,
          rawCustomerName: rawName,
          customerName: getCustomerDisplayName({ name: rawName, customerCode: code }),
          customerPhone: updatedCustomer?.phone ?? resolvedCustomer.phone,
          pointsEarned,
          pointsRedeemed,
          discountFromPoints,
          paidAmount,
          changeGiven,
          changeDepositedToWallet,
          walletAmountUsed,
          customerPointsBalance:
            updatedCustomer?.pointsBalance ??
            Number(resolvedCustomer.pointsBalance ?? 0) - pointsRedeemed + pointsEarned,
          customerWalletBalance:
            updatedCustomer?.walletBalance ??
            Number(
              (
                customerWalletBefore -
                walletAmountUsed +
                changeDepositedToWallet
              ).toFixed(2)
            ),
        };
      } else if (hasWalletOrCashFields) {
        loyaltySummary = {
          paidAmount,
          changeGiven,
          changeDepositedToWallet,
          walletAmountUsed,
        };
      }

      return createdOrder;
    });

    return this.sanitizeOrderForRole(executedOrder, role, loyaltySummary);
  }

  static async returnOrder(
    orderId: string,
    role: Role,
    cashierId?: string,
    refundOptions?: {
      refundMethod?: 'CASH' | 'WALLET';
      refundAmount?: number;
      returnedItems?: Array<{ orderItemId: string; quantity: number }>;
    }
  ) {
    const refundMethod = refundOptions?.refundMethod ?? 'CASH';
    const returnedItemsInput = refundOptions?.returnedItems;

    const returnedOrder = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: true,
          customer: true,
        },
      });

      if (!order) {
        throw new Error('ORDER_NOT_FOUND');
      }

      if (order.isReturned) {
        throw new Error('ORDER_ALREADY_RETURNED');
      }

      const orderTotal = Number(order.totalAmount ?? 0);
      let calculatedRefundTotal = 0;
      const itemsToProcess: Array<{ item: (typeof order.items)[0]; returnQty: number }> = [];

      if (Array.isArray(returnedItemsInput) && returnedItemsInput.length > 0) {
        for (const reqItem of returnedItemsInput) {
          const item = order.items.find((i) => i.id === reqItem.orderItemId);
          if (!item) {
            throw new Error(`ORDER_ITEM_NOT_FOUND:${reqItem.orderItemId}`);
          }
          const alreadyReturned = (item as any).returnedQuantity ?? 0;
          const returnable = item.quantity - alreadyReturned;
          if (reqItem.quantity <= 0 || reqItem.quantity > returnable) {
            throw new Error(`INVALID_RETURN_QUANTITY:${item.id}`);
          }
          itemsToProcess.push({ item, returnQty: reqItem.quantity });
          calculatedRefundTotal += reqItem.quantity * Number(item.unitPrice);
        }
      } else {
        // Full order return of all remaining items
        for (const item of order.items) {
          const alreadyReturned = (item as any).returnedQuantity ?? 0;
          const returnable = item.quantity - alreadyReturned;
          if (returnable > 0) {
            itemsToProcess.push({ item, returnQty: returnable });
            calculatedRefundTotal += returnable * Number(item.unitPrice);
          }
        }
      }

      if (itemsToProcess.length === 0) {
        throw new Error('NO_ITEMS_TO_RETURN');
      }

      // Restore inventory batches in transaction
      for (const { item, returnQty } of itemsToProcess) {
        const matchingBatch = await tx.productBatch.findFirst({
          where: {
            productId: item.productId,
            costPrice: item.costPrice,
          },
          orderBy: { expiryDate: 'asc' },
        });

        if (matchingBatch) {
          await tx.productBatch.update({
            where: { id: matchingBatch.id },
            data: {
              quantity: matchingBatch.quantity + returnQty,
            },
          });
        } else {
          const fallbackBatch = await tx.productBatch.findFirst({
            where: { productId: item.productId },
            orderBy: { expiryDate: 'asc' },
          });

          if (fallbackBatch) {
            await tx.productBatch.update({
              where: { id: fallbackBatch.id },
              data: {
                quantity: fallbackBatch.quantity + returnQty,
              },
            });
          }
        }

        // Update returnedQuantity on OrderItem
        const nextReturnedQty = ((item as any).returnedQuantity ?? 0) + returnQty;
        if ((tx as any).orderItem?.update) {
          await (tx as any).orderItem.update({
            where: { id: item.id },
            data: {
              returnedQuantity: nextReturnedQty,
            },
          });
        }
        (item as any).returnedQuantity = nextReturnedQty;
      }

      const customerDelegate = (tx as any).customer;
      const loyaltyTxDelegate = (tx as any).loyaltyTransaction;
      const walletTxDelegate = (tx as any).walletTransaction;
      const creditTxDelegate = (tx as any).creditTransaction;

      const requestedRefundAmount =
        refundOptions?.refundAmount !== undefined ? Number(refundOptions.refundAmount) : null;
      const effectiveRefundAmount =
        requestedRefundAmount !== null && Number.isFinite(requestedRefundAmount)
          ? Math.min(orderTotal, Math.max(0, requestedRefundAmount))
          : Math.min(orderTotal, Number(calculatedRefundTotal.toFixed(2)));

      const allItemsReturned = order.items.every(
        (i) => ((i as any).returnedQuantity ?? 0) >= i.quantity
      );

      if (order.customerId && customerDelegate && typeof customerDelegate.findUnique === 'function') {
        const currentCustomer = await customerDelegate.findUnique({
          where: { id: order.customerId },
        });

        if (currentCustomer) {
          const returnRatio = orderTotal > 0 ? effectiveRefundAmount / orderTotal : 1;
          const pointsEarnedToDeduct = Math.round(Number(order.pointsEarned ?? 0) * returnRatio);
          const pointsRedeemedToRestore = Math.round(
            Number(order.pointsRedeemed ?? 0) * returnRatio
          );

          const nextPointsBalance = Math.max(
            0,
            Number(currentCustomer.pointsBalance ?? 0) -
              pointsEarnedToDeduct +
              pointsRedeemedToRestore
          );

          const walletAmountUsed = Number(order.walletAmountUsed ?? 0);
          const currentWalletBalance = Number(currentCustomer.walletBalance ?? 0);
          const walletRestored = Number((walletAmountUsed * returnRatio).toFixed(2));
          const restoredWalletBalance = Number(
            (currentWalletBalance + walletRestored).toFixed(2)
          );
          const walletRefundBalance =
            refundMethod === 'WALLET' && effectiveRefundAmount > 0
              ? Number((restoredWalletBalance + effectiveRefundAmount).toFixed(2))
              : restoredWalletBalance;

          const currentCreditBalance = Number(currentCustomer.creditBalance ?? 0);
          const creditReduction =
            order.paymentMethod === PaymentMethod.CREDIT && effectiveRefundAmount > 0
              ? Number(Math.min(currentCreditBalance, effectiveRefundAmount).toFixed(2))
              : 0;
          const nextCreditBalance = Number((currentCreditBalance - creditReduction).toFixed(2));

          await customerDelegate.update({
            where: { id: order.customerId },
            data: {
              pointsBalance: nextPointsBalance,
              walletBalance: new Prisma.Decimal(walletRefundBalance.toFixed(2)),
              ...(creditReduction > 0 && {
                creditBalance: new Prisma.Decimal(nextCreditBalance.toFixed(2)),
              }),
            },
          });

          if (creditReduction > 0 && creditTxDelegate?.create) {
            await creditTxDelegate.create({
              data: {
                customerId: order.customerId,
                orderId: order.id,
                amount: new Prisma.Decimal((-creditReduction).toFixed(2)),
                balanceAfter: new Prisma.Decimal(nextCreditBalance.toFixed(2)),
                type: 'ADJUSTMENT',
                notes: `خصم مديونية مقابل مرتجع فاتورة رقم ${order.orderNumber}`,
              },
            });
          }

          if (pointsEarnedToDeduct > 0 && loyaltyTxDelegate?.create) {
            await loyaltyTxDelegate.create({
              data: {
                customerId: order.customerId,
                orderId: order.id,
                type: 'ADJUST',
                points: -pointsEarnedToDeduct,
                amountValue: new Prisma.Decimal((-effectiveRefundAmount).toFixed(2)),
                description: `إلغاء اكتساب ${pointsEarnedToDeduct} نقطة من الفاتورة ${order.orderNumber}`,
              },
            });
          }

          if (pointsRedeemedToRestore > 0 && loyaltyTxDelegate?.create) {
            await loyaltyTxDelegate.create({
              data: {
                customerId: order.customerId,
                orderId: order.id,
                type: 'ADJUST',
                points: pointsRedeemedToRestore,
                amountValue: new Prisma.Decimal(
                  (Number(order.discountFromPoints ?? 0) * returnRatio).toFixed(2)
                ),
                description: `إعادة ${pointsRedeemedToRestore} نقطة مستبدلة للفاتورة ${order.orderNumber}`,
              },
            });
          }

          if (walletTxDelegate?.create) {
            if (walletRestored > 0) {
              await walletTxDelegate.create({
                data: {
                  customerId: order.customerId,
                  orderId: order.id,
                  amount: new Prisma.Decimal(walletRestored.toFixed(2)),
                  balanceAfter: new Prisma.Decimal(restoredWalletBalance.toFixed(2)),
                  type: 'REFUND_CREDIT',
                  description: `إرجاع رصيد محفظة الفكة من الفاتورة ${order.orderNumber}`,
                },
              });
            }

            if (refundMethod === 'WALLET' && effectiveRefundAmount > 0) {
              await walletTxDelegate.create({
                data: {
                  customerId: order.customerId,
                  orderId: order.id,
                  amount: new Prisma.Decimal(effectiveRefundAmount.toFixed(2)),
                  balanceAfter: new Prisma.Decimal(walletRefundBalance.toFixed(2)),
                  type: 'REFUND_CREDIT',
                  description: `إضافة مبلغ استرجاع للمحفظة من الفاتورة ${order.orderNumber}`,
                },
              });
            }
          }
        }
      }

      // Log deduction against the active shift if an active shift exists for the cashier
      let targetShiftId = order.shiftId;
      if (cashierId) {
        const activeShift = await tx.shift.findFirst({
          where: {
            cashierId,
            closedAt: null,
          },
        });
        if (activeShift) {
          targetShiftId = activeShift.id;
        }
      }

      const updated = await tx.order.update({
        where: { id: order.id },
        data: {
          isReturned: allItemsReturned,
          ...(targetShiftId && { shiftId: targetShiftId }),
        },
        include: {
          items: {
            include: {
              product: {
                select: { id: true, name: true, barcode: true },
              },
            },
          },
          customer: true,
        },
      });

      return {
        ...updated,
        refundAmount: effectiveRefundAmount,
        refundMethod,
        isPartial: !allItemsReturned,
      };
    });

    return this.sanitizeOrderForRole(returnedOrder, role, undefined, refundMethod);
  }

  static async getOrderByNumber(orderNumber: string, role: Role) {
    const normalized = orderNumber.trim();
    const candidates = normalized.startsWith('#')
      ? [normalized, normalized.slice(1)]
      : [normalized, `#${normalized}`];

    let order: any = null;
    for (const candidate of candidates) {
      order = await prisma.order.findUnique({
        where: { orderNumber: candidate },
        include: {
          customer: true,
          items: {
            include: {
              product: {
                select: { id: true, name: true, barcode: true },
              },
            },
          },
        },
      });
      if (order) break;
    }

    if (!order) {
      throw new Error('ORDER_NOT_FOUND');
    }

    return this.sanitizeOrderForRole(order, role);
  }

  static async listOrders(
    role: Role,
    filters?: {
      search?: string;
      paymentMethod?: string;
      isReturned?: boolean;
      limit?: number;
    }
  ) {
    const cleanSearch = filters?.search?.trim();
    const take = Math.min(Math.max(filters?.limit ?? 150, 1), 500);

    const where: Prisma.OrderWhereInput = {
      ...(filters?.paymentMethod &&
      ['CASH', 'CARD', 'SPLIT', 'CREDIT'].includes(filters.paymentMethod)
        ? { paymentMethod: filters.paymentMethod as PaymentMethod }
        : {}),
      ...(filters?.isReturned === true
        ? {
            OR: [
              { isReturned: true },
              { items: { some: { returnedQuantity: { gt: 0 } } } },
            ],
          }
        : filters?.isReturned === false
          ? {
              isReturned: false,
              items: { none: { returnedQuantity: { gt: 0 } } },
            }
          : {}),
      ...(cleanSearch
        ? {
            OR: [
              { orderNumber: { contains: cleanSearch, mode: 'insensitive' } },
              { customer: { phone: { contains: cleanSearch } } },
              { customer: { name: { contains: cleanSearch, mode: 'insensitive' } } },
              {
                items: {
                  some: {
                    product: {
                      OR: [
                        { name: { contains: cleanSearch, mode: 'insensitive' } },
                        { barcode: { contains: cleanSearch } },
                      ],
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const orders = await prisma.order.findMany({
      where,
      include: {
        cashier: {
          select: { id: true, name: true, username: true },
        },
        customer: true,
        items: {
          include: {
            product: {
              select: { id: true, name: true, barcode: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return orders.map((o) => this.sanitizeOrderForRole(o, role));
  }

  static async createPublicOnlineOrder(input: CreatePublicOnlineOrderInput) {
    let loyaltySummary: any = null;
    let orderSubtotal = 0;

    const executedOrder = await prisma.$transaction(async (tx) => {
      // 1. Resolve an active shift, or fall back to most recent shift / create online shift
      let shift = await tx.shift.findFirst({
        where: { closedAt: null },
        orderBy: { openedAt: 'desc' },
      });

      if (!shift) {
        const latestShift = await tx.shift.findFirst({
          orderBy: { openedAt: 'desc' },
        });
        if (latestShift) {
          shift = latestShift;
        } else if ((tx as any).user?.findFirst && tx.shift?.create) {
          const fallbackUser = await (tx as any).user.findFirst({
            orderBy: { createdAt: 'asc' },
          });
          if (fallbackUser) {
            shift = await tx.shift.create({
              data: {
                cashierId: fallbackUser.id,
                startingCash: new Prisma.Decimal('0.00'),
              },
            });
          }
        }
      }

      if (!shift) {
        throw new Error('SHIFT_CLOSED_OR_INVALID');
      }

      // 2. Validate online availability and deduct FIFO stock
      const orderItemsToCreate: Array<{
        productId: string;
        quantity: number;
        unitPrice: Prisma.Decimal;
        costPrice: Prisma.Decimal;
      }> = [];

      for (const reqItem of input.items) {
        const product = await tx.product.findUnique({
          where: { id: reqItem.productId },
        });

        if (!product) {
          throw new Error(`PRODUCT_NOT_FOUND:${reqItem.productId}`);
        }

        if (product.isAvailableOnline === false) {
          throw new Error(`PRODUCT_NOT_AVAILABLE_ONLINE:${product.name}`);
        }

        let fifoResult;
        try {
          fifoResult = await ProductService.deductProductStockFIFO(
            reqItem.productId,
            reqItem.quantity,
            tx
          );
        } catch (err: unknown) {
          if (err instanceof Error && err.message.startsWith('INSUFFICIENT_STOCK:')) {
            throw new Error(`INSUFFICIENT_STOCK:${product.name}`);
          }
          throw err;
        }

        const unitRetailPrice = Number(product.retailPrice);

        for (const allocation of fifoResult.allocations) {
          orderSubtotal += allocation.deductedQuantity * unitRetailPrice;
          orderItemsToCreate.push({
            productId: product.id,
            quantity: allocation.deductedQuantity,
            unitPrice: product.retailPrice,
            costPrice: allocation.costPrice,
          });
        }
      }

      orderSubtotal = Number(orderSubtotal.toFixed(2));

      // 3. Generate human-friendly Order Number (e.g., #ORD-1080)
      let sequenceNum = 1080;
      if (typeof (tx.order as any)?.count === 'function') {
        try {
          const existingCount = await (tx.order as any).count();
          sequenceNum = 1080 + Number(existingCount || 0);
        } catch {
          sequenceNum = 1000 + Math.floor(Math.random() * 9000);
        }
      } else {
        sequenceNum = 1080 + Math.floor(Math.random() * 900);
      }

      let generatedOrderNumber = `#ORD-${sequenceNum}`;
      if (typeof tx.order?.findUnique === 'function') {
        const existingOrd = await tx.order.findUnique({
          where: { orderNumber: generatedOrderNumber },
        });
        if (existingOrd) {
          generatedOrderNumber = `#ORD-${sequenceNum}-${Math.floor(10 + Math.random() * 90)}`;
        }
      }

      // 4. Customer lookup / creation & Loyalty / Wallet calculation
      let finalPayableTotal = orderSubtotal;
      let resolvedCustomer: any = null;
      let pointsEarned = 0;
      let pointsRedeemed = 0;
      let discountFromPoints = 0;

      const cleanPhone = input.customerPhone.trim();
      const cleanName =
        typeof input.customerName === 'string' && input.customerName.trim().length > 0
          ? input.customerName.trim()
          : null;

      const customerDelegate = (tx as any).customer;
      if (customerDelegate && typeof customerDelegate.findUnique === 'function') {
        resolvedCustomer = await customerDelegate.findUnique({
          where: { phone: cleanPhone },
        });

        if (!resolvedCustomer && typeof customerDelegate.create === 'function') {
          const nextCode = await LoyaltyService.getNextCustomerCode(tx);
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
        } else if (
          resolvedCustomer &&
          cleanName &&
          !resolvedCustomer.name &&
          typeof customerDelegate.update === 'function'
        ) {
          resolvedCustomer = await customerDelegate.update({
            where: { id: resolvedCustomer.id },
            data: { name: cleanName },
          });
        }

        if (resolvedCustomer) {
          const settings = await LoyaltyService.getSettings(tx);
          const calc = LoyaltyService.calculateOrderLoyalty({
            orderSubtotal,
            customerPointsBalance: Number(resolvedCustomer.pointsBalance ?? 0),
            redeemPoints: input.redeemPoints,
            settings,
          });

          pointsEarned = calc.pointsEarned;
          pointsRedeemed = calc.pointsRedeemed;
          discountFromPoints = calc.discountFromPoints;
          finalPayableTotal = calc.netPayable;
        }
      }

      const customerWalletBefore = resolvedCustomer
        ? Number(resolvedCustomer.walletBalance ?? 0)
        : 0;

      let walletAmountUsed =
        input.walletAmountUsed !== undefined
          ? Number(input.walletAmountUsed.toFixed(2))
          : input.useWallet && resolvedCustomer
          ? Number(Math.min(customerWalletBefore, finalPayableTotal).toFixed(2))
          : 0;

      if (walletAmountUsed > finalPayableTotal) {
        walletAmountUsed = Number(finalPayableTotal.toFixed(2));
      }

      if (walletAmountUsed > 0 && !resolvedCustomer) {
        throw new Error('CUSTOMER_NOT_FOUND');
      }

      const cashDueOnDelivery = Number(
        Math.max(0, finalPayableTotal - walletAmountUsed).toFixed(2)
      );

      const orderData: any = {
        orderNumber: generatedOrderNumber,
        shiftId: shift.id,
        cashierId: shift.cashierId,
        totalAmount: new Prisma.Decimal(finalPayableTotal.toFixed(2)),
        paidAmount: new Prisma.Decimal(cashDueOnDelivery.toFixed(2)),
        changeGiven: new Prisma.Decimal('0.00'),
        changeDepositedToWallet: new Prisma.Decimal('0.00'),
        walletAmountUsed: new Prisma.Decimal(walletAmountUsed.toFixed(2)),
        paymentMethod: input.paymentMethod ?? PaymentMethod.CASH,
        items: {
          create: orderItemsToCreate,
        },
      };

      if (resolvedCustomer) {
        orderData.customerId = resolvedCustomer.id;
        orderData.pointsEarned = pointsEarned;
        orderData.pointsRedeemed = pointsRedeemed;
        orderData.discountFromPoints = new Prisma.Decimal(discountFromPoints.toFixed(2));
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
        const updatedCustomer = await LoyaltyService.recordOrderLoyaltyInTx(tx, {
          customerId: resolvedCustomer.id,
          orderId: createdOrder.id,
          orderNumber: createdOrder.orderNumber,
          netPayable: finalPayableTotal,
          pointsEarned,
          pointsRedeemed,
          discountFromPoints,
          walletAmountUsed,
          changeDepositedToWallet: 0,
        });

        const code = Number(
          updatedCustomer?.customerCode ?? resolvedCustomer.customerCode ?? 1001
        );
        const rawName = cleanName ?? updatedCustomer?.name ?? resolvedCustomer.name ?? null;

        loyaltySummary = {
          customerId: resolvedCustomer.id,
          customerCode: code,
          rawCustomerName: rawName,
          customerName: getCustomerDisplayName({ name: rawName, customerCode: code }),
          customerPhone: updatedCustomer?.phone ?? resolvedCustomer.phone,
          pointsEarned,
          pointsRedeemed,
          discountFromPoints,
          paidAmount: cashDueOnDelivery,
          changeGiven: 0,
          changeDepositedToWallet: 0,
          walletAmountUsed,
          customerPointsBalance:
            updatedCustomer?.pointsBalance ??
            Number(resolvedCustomer.pointsBalance ?? 0) - pointsRedeemed + pointsEarned,
          customerWalletBalance:
            updatedCustomer?.walletBalance ??
            Number((customerWalletBefore - walletAmountUsed).toFixed(2)),
        };
      }

      if ((tx as any).auditLog?.create) {
        await (tx as any).auditLog.create({
          data: {
            action: 'ONLINE_ORDER_CREATED',
            cashierId: shift.cashierId,
            details: JSON.stringify({
              orderNumber: createdOrder.orderNumber,
              customerPhone: cleanPhone,
              customerName: cleanName,
              deliveryAddress: input.deliveryAddress.trim(),
              deliveryNotes: input.deliveryNotes?.trim() || null,
              subtotal: orderSubtotal,
              discountFromPoints,
              walletAmountUsed,
              cashDueOnDelivery,
            }),
          },
        });
      }

      return createdOrder;
    });

    const sanitized = this.sanitizeOrderForRole(executedOrder, Role.CASHIER, loyaltySummary);

    return {
      ...sanitized,
      customerName:
        sanitized.customerName ??
        (input.customerName && input.customerName.trim().length > 0
          ? input.customerName.trim()
          : 'عميل أونلاين'),
      customerPhone: sanitized.customerPhone ?? input.customerPhone.trim(),
      subtotal: orderSubtotal,
      deliveryFee: 0,
      cashDueOnDelivery: Number(
        Math.max(0, sanitized.totalAmount - sanitized.walletAmountUsed).toFixed(2)
      ),
      deliveryAddress: input.deliveryAddress.trim(),
      deliveryNotes: input.deliveryNotes?.trim() || null,
      estimatedDelivery: '30 - 45 دقيقة',
    };
  }

  /**
   * Generates the next sequential POS invoice number (ALM-000001, ALM-000002, ...).
   * Skips any existing collisions (including legacy timestamp-based order numbers).
   */
  static async getNextOrderNumber(client: any = prisma): Promise<string> {
    const orderDelegate = client?.order;
    if (!orderDelegate || typeof orderDelegate.findMany !== 'function') {
      return 'ALM-000001';
    }

    const existing = await orderDelegate.findMany({
      where: {
        orderNumber: { startsWith: 'ALM-' },
      },
      select: { orderNumber: true },
    });

    const existingSet = new Set<string>(
      existing.map((row: { orderNumber: string }) => row.orderNumber.toUpperCase())
    );

    let seq = 1;
    while (existingSet.has(`ALM-${String(seq).padStart(6, '0')}`)) {
      seq += 1;
    }

    return `ALM-${String(seq).padStart(6, '0')}`;
  }
}
