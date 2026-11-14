import dotenv from 'dotenv';

dotenv.config();

export const env = {
  PORT: Number(process.env.PORT) || 4000,
  JWT_SECRET: process.env.JWT_SECRET || 'alamir-supermarket-secret-key-2026',
  CURRENCY: process.env.CURRENCY || 'ج.م',
  LOCALE: process.env.LOCALE || 'ar-EG',
  COUNTRY: 'Egypt',
  MANAGER_PIN: process.env.MANAGER_PIN || '1234',
};

