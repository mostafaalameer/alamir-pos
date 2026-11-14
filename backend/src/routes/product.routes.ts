import { Router } from 'express';
import multer from 'multer';
import { Role } from '@prisma/client';
import { ProductController } from '../controllers/product.controller';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// Public / Delivery App sync endpoint
router.get('/ecommerce/catalog', ProductController.getOnlineCatalog);

// Protected Admin endpoints (inventory, bulk Excel import/template, pricing & expiry alerts)
router.get(
  '/expiry-alerts',
  authenticate,
  authorizeRoles(Role.ADMIN),
  ProductController.getExpiryAlerts
);
router.get(
  '/bulk-template',
  authenticate,
  authorizeRoles(Role.ADMIN),
  ProductController.downloadBulkTemplate
);
router.post(
  '/bulk-import',
  authenticate,
  authorizeRoles(Role.ADMIN),
  upload.single('file'),
  ProductController.bulkImport
);
router.post(
  '/bulk-delete',
  authenticate,
  authorizeRoles(Role.ADMIN),
  ProductController.bulkDeleteProducts
);
router.delete(
  '/bulk',
  authenticate,
  authorizeRoles(Role.ADMIN),
  ProductController.bulkDeleteProducts
);
router.post('/', authenticate, authorizeRoles(Role.ADMIN), ProductController.createProduct);
router.patch('/:id/price', authenticate, authorizeRoles(Role.ADMIN), ProductController.updatePrice);
router.patch('/:id', authenticate, authorizeRoles(Role.ADMIN), ProductController.updateProduct);
router.delete('/:id', authenticate, authorizeRoles(Role.ADMIN), ProductController.deleteProduct);
router.post('/:id/batches', authenticate, authorizeRoles(Role.ADMIN), ProductController.addBatch);
router.post(
  '/:id/adjust-stock',
  authenticate,
  authorizeRoles(Role.ADMIN),
  ProductController.adjustStock
);

// Shared Cashier & Admin read/search endpoints (costPrice automatically stripped for CASHIER)
router.get('/search', authenticate, ProductController.searchProducts);
router.get('/', authenticate, ProductController.listProducts);
router.get('/barcode/:barcode', authenticate, ProductController.getByBarcode);

export default router;
