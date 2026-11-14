import { Router } from 'express';
import { PublicController } from '../controllers/public.controller';

const router = Router();

// 1. Public Storefront Configuration (Cloudflare R2 Banners, Featured Categories, Delivery Fee, Open/Closed Status)
router.get('/storefront/config', PublicController.getStorefrontConfig);

// 2. Public E-Commerce Storefront Catalog (isAvailableOnline = true & calculated stock > 0)
router.get('/products', PublicController.listOnlineProducts);

// 3. Public Customer Loyalty Points & Change-Wallet Lookup by Phone
router.get('/customers/lookup', PublicController.lookupCustomerByPhone);
router.get('/customer', PublicController.lookupCustomerByPhone);

// 4. Public Online Order Checkout & Live Order Tracking
router.get('/orders', PublicController.listCustomerOrders);
router.post('/orders', PublicController.createOnlineOrder);
router.get('/orders/:orderNumber', PublicController.getOnlineOrderByNumber);

export default router;
