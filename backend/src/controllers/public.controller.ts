import { Request, Response } from 'express';
import { z } from 'zod';
import { PaymentMethod, Role } from '@prisma/client';
import { prisma } from '../config/db';
import { ProductService } from '../services/product.service';
import { LoyaltyService } from '../services/loyalty.service';
import { OrderService } from '../services/order.service';

const createPublicOrderSchema = z.object({
  customerPhone: z
    .string()
    .trim()
    .min(8, 'رقم الموبايل مطلوب (8 أرقام على الأقل)'),
  customerName: z.string().trim().optional().nullable(),
  deliveryAddress: z
    .string()
    .trim()
    .min(3, 'عنوان التوصيل بالتفصيل مطلوب'),
  deliveryNotes: z.string().trim().optional().nullable(),
  paymentMethod: z
    .enum(['CASH', 'CARD', 'WALLET', 'SPLIT', 'CREDIT'])
    .default('CASH'),
  redeemPoints: z.union([z.boolean(), z.number().int().nonnegative()]).optional(),
  useWallet: z.boolean().optional(),
  walletAmountUsed: z.number().nonnegative().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, 'معرف الصنف مطلوب'),
        quantity: z.number().int().positive('الكمية يجب أن تكون أكبر من صفر'),
      })
    )
    .min(1, 'يجب أن تحتوي السلة على صنف واحد على الأقل'),
});

// Active promotional rules for online storefront items
const STORE_PROMOTIONS: Record<
  string,
  { discountPercent: number; offerBadge: string }
> = {
  '6221000001': { discountPercent: 15, offerBadge: 'خصم 15%' },
  '6221000002': { discountPercent: 20, offerBadge: 'عرض اليوم 🔥' },
  '6221000003': { discountPercent: 12, offerBadge: 'وفّر 12%' },
  '6221000005': { discountPercent: 18, offerBadge: 'خصم 18%' },
  '6221000008': { discountPercent: 15, offerBadge: 'عرض خاص' },
};

function enrichWithPromotion(product: any) {
  const promo = STORE_PROMOTIONS[product.barcode];
  const availableStock = Number(
    product.availableStock ?? product.availableQuantity ?? 0
  );
  const minStockAlert = Number(product.minStockAlert ?? 5);

  if (promo) {
    const originalPrice = Number(
      (product.retailPrice / (1 - promo.discountPercent / 100)).toFixed(2)
    );
    return {
      ...product,
      minStockAlert,
      availableStock,
      availableQuantity: availableStock,
      originalPrice,
      discountPercent: promo.discountPercent,
      isOffer: true,
      offerBadge: promo.offerBadge,
    };
  }
  return {
    ...product,
    minStockAlert,
    availableStock,
    availableQuantity: availableStock,
    originalPrice: null,
    discountPercent: 0,
    isOffer: false,
    offerBadge: null,
  };
}

export class PublicController {
  /**
   * GET /api/public/storefront/config
   * Returns active promotional banners (Cloudflare R2 URLs), featured categories with icons/emojis,
   * delivery fee, and store open/closed status.
   */
  static async getStorefrontConfig(_req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json({
        success: true,
        data: {
          storeName: 'ماركت الأمير - Alamir Market',
          isOpen: true,
          storeStatus: 'OPEN',
          openingHours: 'يومياً من 8:00 صباحاً حتى 2:00 منتصف الليل',
          deliveryFee: 0,
          currency: 'ج.م',
          deliveryEta: '30 - 45 دقيقة',
          r2PublicBaseUrl: 'https://pub-alamir-media.r2.dev',
          banners: [
            {
              id: 'banner-r2-1',
              badge: 'خصم 20% 🔥',
              title: 'مهرجان التوفير اليومي في ماركت الأمير',
              subtitle: 'خصومات فورية حتى 20% على الألبان، الأرز، والجبن الطازجة اليوم',
              imageUrl: 'https://pub-alamir-media.r2.dev/banners/daily-offers-16x9.webp',
              fallbackImageUrl:
                'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=80',
              gradient: 'from-brand-black via-brand-surface to-brand-orange/40',
              accentColor: 'bg-brand-orange text-brand-white',
              ctaLabel: 'تسوق العروض الآن',
              filterOffersOnly: true,
            },
            {
              id: 'banner-r2-2',
              badge: 'عرض اليوم ⚡',
              title: 'منتجات الألبان والأجبان الطازجة',
              subtitle: 'حليب جهينة وجبنة عبور لاند بأحدث تاريخ صلاحية وتوصيل سريع',
              imageUrl: 'https://pub-alamir-media.r2.dev/banners/dairy-fresh-16x9.webp',
              fallbackImageUrl:
                'https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=900&q=80',
              gradient: 'from-brand-black via-brand-surface to-brand-amber/35',
              accentColor: 'bg-brand-tangerine text-brand-black',
              ctaLabel: 'تصفح الألبان والأجبان',
              targetCategory: 'ألبان وأجبان',
            },
            {
              id: 'banner-r2-3',
              badge: 'محفظة الفكة والولاء 🎁',
              title: 'استبدل نقاطك ورصيد الفكة أونلاين',
              subtitle: 'كل 100 نقطة = 10 ج.م خصم فوري، أو ادفع مباشرة من رصيد محفظة الفكة',
              imageUrl: 'https://pub-alamir-media.r2.dev/banners/loyalty-wallet-16x9.webp',
              fallbackImageUrl:
                'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=900&q=80',
              gradient: 'from-brand-black via-brand-surface to-brand-orange/35',
              accentColor: 'bg-brand-amber text-brand-black',
              ctaLabel: 'استعلم عن رصيدك',
            },
          ],
          featuredCategories: [
            { id: 'all', name: 'الكل', label: '🛒 الكل', emoji: '🛒' },
            { id: 'offers', name: 'العروض', label: '🔥 العروض', emoji: '🔥', isOffersChip: true },
            { id: 'dairy', name: 'ألبان وأجبان', label: '🧀 الألبان', emoji: '🧀' },
            { id: 'dry', name: 'بقالة جافة', label: '🍚 البقوليات', emoji: '🍚' },
            { id: 'oils', name: 'زيوت وسمن', label: '🫗 الزيوت', emoji: '🫗' },
            { id: 'drinks', name: 'مشروبات وعصائر', label: '🧃 المشروبات', emoji: '🧃' },
            { id: 'detergents', name: 'منظفات وعناية', label: '🧴 المنظفات', emoji: '🧴' },
          ],
        },
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر جلب إعدادات المتجر الإلكتروني',
      });
    }
  }

  /**
   * GET /api/public/products
   * Returns products where `isAvailableOnline = true` and calculated stock > 0
   * (or includes out-of-stock when `?includeOutOfStock=true`).
   * Response item fields: id, name, retailPrice, imageUrls (R2 URLs), description, minStockAlert, availableStock.
   */
  static async listOnlineProducts(req: Request, res: Response): Promise<void> {
    try {
      const catalog = await ProductService.getOnlineCatalog();
      const includeOutOfStock = req.query.includeOutOfStock === 'true';

      const baseCatalog = (
        includeOutOfStock
          ? catalog
          : catalog.filter((item) => item.inStock && item.availableQuantity > 0)
      ).map(enrichWithPromotion);

      baseCatalog.sort((a, b) => {
        if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
        return String(a.name).localeCompare(String(b.name), 'ar');
      });

      const categorySet = new Set<string>();
      for (const p of baseCatalog) {
        if (p.category && p.category.trim().length > 0) {
          categorySet.add(p.category.trim());
        }
      }
      const categories = ['الكل', ...Array.from(categorySet)];

      const rawCategory =
        typeof req.query.category === 'string' ? req.query.category.trim() : '';
      const offersOnly = req.query.offersOnly === 'true';
      const rawSearch =
        typeof req.query.q === 'string'
          ? req.query.q.trim()
          : typeof req.query.search === 'string'
          ? req.query.search.trim()
          : '';

      const filtered = baseCatalog.filter((product) => {
        if (offersOnly && !product.isOffer) {
          return false;
        }
        if (rawCategory && rawCategory !== 'الكل' && product.category !== rawCategory) {
          return false;
        }
        if (rawSearch) {
          const qLower = rawSearch.toLowerCase();
          const matchName = product.name?.toLowerCase().includes(qLower);
          const matchCategory = product.category?.toLowerCase().includes(qLower);
          const matchBarcode = product.barcode?.toLowerCase().includes(qLower);
          const matchDesc = product.description?.toLowerCase().includes(qLower);
          return Boolean(matchName || matchCategory || matchBarcode || matchDesc);
        }
        return true;
      });

      res.status(200).json({
        success: true,
        currency: 'ج.م',
        categories,
        count: filtered.length,
        data: filtered,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر جلب منتجات المتجر الإلكتروني',
      });
    }
  }

  /**
   * GET /api/customers/lookup?phone=01xxxxxxxxx
   * & GET /api/public/customers/lookup?phone=01xxxxxxxxx
   * Returns customer profile: customerCode (e.g., C-1001), name (nullable), walletBalance, and totalPointsBalance.
   */
  static async lookupCustomerByPhone(req: Request, res: Response): Promise<void> {
    try {
      const phone =
        typeof req.query.phone === 'string' ? req.query.phone.trim() : '';

      if (!phone || phone.length < 4) {
        res.status(400).json({
          success: false,
          message: 'يرجى إدخال رقم الموبايل للبحث عن رصيد النقاط والمحفظة',
        });
        return;
      }

      const [customers, loyaltySettings] = await Promise.all([
        LoyaltyService.listCustomers({ phone }),
        LoyaltyService.getSettings(),
      ]);

      const matched = customers[0] ?? null;

      res.status(200).json({
        success: true,
        found: Boolean(matched),
        loyaltySettings,
        data: matched
          ? {
              id: matched.id,
              customerCode: matched.formattedCode,
              numericCustomerCode: matched.customerCode,
              formattedCode: matched.formattedCode,
              name: matched.name,
              displayName: matched.displayName,
              phone: matched.phone,
              pointsBalance: matched.pointsBalance,
              totalPointsBalance: matched.pointsBalance,
              walletBalance: matched.walletBalance,
              loyaltyTransactions: matched.loyaltyTransactions?.slice(0, 10) ?? [],
              walletTransactions: matched.walletTransactions?.slice(0, 10) ?? [],
            }
          : null,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر التحقق من بيانات العميل',
      });
    }
  }

  /**
   * POST /api/public/orders
   * Accepts `{ customerPhone, customerName, deliveryAddress, deliveryNotes, items, paymentMethod: "CASH" | "WALLET", walletAmountUsed }`.
   */
  static async createOnlineOrder(req: Request, res: Response): Promise<void> {
    const parsed = createPublicOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'يرجى التأكد من إدخال رقم الموبايل وعنوان التوصيل والمنتجات بشكل صحيح',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const isWalletPayment =
        parsed.data.paymentMethod === 'WALLET' || Boolean(parsed.data.useWallet);

      const prismaPaymentMethod: PaymentMethod =
        parsed.data.paymentMethod === 'CARD'
          ? PaymentMethod.CARD
          : PaymentMethod.CASH;

      const order = await OrderService.createPublicOnlineOrder({
        customerPhone: parsed.data.customerPhone,
        customerName: parsed.data.customerName,
        deliveryAddress: parsed.data.deliveryAddress,
        deliveryNotes: parsed.data.deliveryNotes,
        paymentMethod: prismaPaymentMethod,
        redeemPoints: parsed.data.redeemPoints,
        useWallet: isWalletPayment,
        walletAmountUsed: parsed.data.walletAmountUsed,
        items: parsed.data.items,
      });

      res.status(201).json({
        success: true,
        message: 'تم استلام طلبك بنجاح وجاري تجهيزه للتوصيل',
        data: order,
      });
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.message.startsWith('PRODUCT_NOT_FOUND:')) {
          res.status(404).json({
            success: false,
            message: 'أحد الأصناف المختارة غير موجود في المتجر',
          });
          return;
        }
        if (error.message.startsWith('PRODUCT_NOT_AVAILABLE_ONLINE:')) {
          const productName = error.message.split(':')[1];
          res.status(409).json({
            success: false,
            message: `الصنف غير متاح للطلب أونلاين حالياً: ${productName}`,
          });
          return;
        }
        if (error.message.startsWith('INSUFFICIENT_STOCK:')) {
          const productName = error.message.split(':')[1];
          res.status(409).json({
            success: false,
            message: `الكمية المطلوبة غير متوفرة بالكامل للصنف: ${productName}`,
          });
          return;
        }
        if (error.message === 'INSUFFICIENT_LOYALTY_POINTS') {
          res.status(409).json({
            success: false,
            message: 'رصيد نقاط الولاء غير كافٍ للاستبدال',
          });
          return;
        }
        if (error.message === 'INSUFFICIENT_WALLET_BALANCE') {
          res.status(409).json({
            success: false,
            message: 'رصيد محفظة الفكة غير كافٍ لإتمام الخصم',
          });
          return;
        }
      }

      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء تسجيل الطلب، يرجى المحاولة مرة أخرى',
      });
    }
  }

  /**
   * GET /api/public/orders?phone=01000000001
   * Lists recent orders for a customer by phone number for the live Orders tracking tab.
   */
  static async listCustomerOrders(req: Request, res: Response): Promise<void> {
    try {
      const phone =
        typeof req.query.phone === 'string' ? req.query.phone.trim() : '';
      if (!phone || phone.length < 4) {
        res.status(200).json({ success: true, data: [] });
        return;
      }

      const customer = await (prisma as any).customer?.findUnique?.({
        where: { phone },
        include: {
          orders: {
            orderBy: { createdAt: 'desc' },
            take: 15,
            include: {
              items: {
                include: {
                  product: {
                    select: { id: true, name: true, barcode: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!customer || !Array.isArray(customer.orders)) {
        res.status(200).json({ success: true, data: [] });
        return;
      }

      const formattedOrders = customer.orders.map((ord: any) => ({
        id: ord.id,
        orderNumber: ord.orderNumber,
        customerName: customer.name || `عميل #${customer.customerCode}`,
        customerPhone: customer.phone,
        totalAmount: Number(ord.totalAmount),
        paidAmount: Number(ord.paidAmount ?? ord.totalAmount),
        walletAmountUsed: Number(ord.walletAmountUsed ?? 0),
        discountFromPoints: Number(ord.discountFromPoints ?? 0),
        pointsEarned: Number(ord.pointsEarned ?? 0),
        pointsRedeemed: Number(ord.pointsRedeemed ?? 0),
        paymentMethod: ord.paymentMethod,
        isReturned: ord.isReturned,
        createdAt: ord.createdAt,
        estimatedDelivery: '30 - 45 دقيقة',
        items: (ord.items || []).map((it: any) => ({
          id: it.id,
          productId: it.productId,
          productName: it.product?.name || 'صنف ماركت الأمير',
          barcode: it.product?.barcode,
          quantity: it.quantity,
          unitPrice: Number(it.unitPrice),
          lineTotal: Number((Number(it.unitPrice) * it.quantity).toFixed(2)),
        })),
      }));

      res.status(200).json({
        success: true,
        data: formattedOrders,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر جلب سجل الطلبات',
      });
    }
  }

  /**
   * GET /api/public/orders/:orderNumber
   * Retrieves order summary for confirmation screen or live order tracking.
   */
  static async getOnlineOrderByNumber(req: Request, res: Response): Promise<void> {
    try {
      const order = await OrderService.getOrderByNumber(
        String(req.params.orderNumber),
        Role.CASHIER
      );
      res.status(200).json({
        success: true,
        data: order,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'ORDER_NOT_FOUND') {
        res.status(404).json({
          success: false,
          message: 'رقم الطلب غير موجود',
        });
        return;
      }
      res.status(500).json({
        success: false,
        message: 'تعذر جلب تفاصيل الطلب',
      });
    }
  }
}
