import { Router } from 'express';
import { LoyaltyController } from '../controllers/loyalty.controller';
import { PublicController } from '../controllers/public.controller';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';
import { Role } from '@prisma/client';

const router = Router();

// Public storefront customer lookup by phone (`GET /api/customers/lookup?phone=01xxxxxxxxx`)
router.get('/lookup', PublicController.lookupCustomerByPhone);

// Both ADMIN and CASHIER can look up customers, balances & transaction history, and register new customers
router.get('/', authenticate, LoyaltyController.listCustomers);
router.post('/', authenticate, LoyaltyController.createCustomer);

// Customer credit ledger & statements
router.put('/:id/credit-limit', authenticate, authorizeRoles(Role.ADMIN), LoyaltyController.updateCreditLimit);
router.post('/:id/credit/settle', authenticate, LoyaltyController.settleDebt);
router.get('/:id/statement', authenticate, LoyaltyController.getCustomerStatement);

export default router;
