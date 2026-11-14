import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import authRoutes from './routes/auth.routes';
import productRoutes from './routes/product.routes';
import inventoryRoutes from './routes/inventory.routes';
import shiftRoutes from './routes/shift.routes';
import orderRoutes from './routes/order.routes';
import reportRoutes from './routes/report.routes';
import syncRoutes from './routes/sync.routes';
import loyaltyRoutes from './routes/loyalty.routes';
import customerRoutes from './routes/customer.routes';
import publicRoutes from './routes/public.routes';
import backupRoutes from './routes/backup.routes';
import { globalErrorMonitorMiddleware } from './middlewares/errorMonitor.middleware';

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/api/health', (_req, res) => {
  res.status(200).json({
    success: true,
    store: 'ماركت الأمير (Alamir Market)',
    country: env.COUNTRY,
    locale: env.LOCALE,
    currency: env.CURRENCY,
    status: 'ONLINE',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/backup', backupRoutes);

app.use(globalErrorMonitorMiddleware);

export default app;

