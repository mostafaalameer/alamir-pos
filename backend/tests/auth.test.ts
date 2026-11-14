import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/config/db';
import { env } from '../src/config/env';

vi.mock('../src/config/db', () => {
  const mockUser = {
    findUnique: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
  };
  return {
    prisma: {
      user: mockUser,
      $transaction: vi.fn((callback) => callback({ user: mockUser })),
    },
  };
});

describe('Alamir Market POS - Milestone 1: Health & RBAC Auth API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/health returns Arabic store metadata and EGP currency (ج.م)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.currency).toBe('ج.م');
    expect(res.body.country).toBe('Egypt');
  });

  it('POST /api/auth/login authenticates valid user and returns JWT + role', async () => {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'u-admin-1',
      name: 'أحمد الأمير',
      username: 'admin',
      password: hashedPassword,
      role: Role.ADMIN,
      createdAt: new Date(),
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.role).toBe(Role.ADMIN);
  });

  it('POST /api/auth/users blocks CASHIER role from creating users (403 Forbidden)', async () => {
    const cashierToken = jwt.sign(
      { userId: 'u-cashier-1', username: 'cashier1', role: Role.CASHIER },
      env.JWT_SECRET
    );

    const res = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        name: 'كاشير جديد',
        username: 'cashier2',
        password: 'password123',
        role: Role.CASHIER,
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/auth/users allows ADMIN role to create a new user inside $transaction', async () => {
    const adminToken = jwt.sign(
      { userId: 'u-admin-1', username: 'admin', role: Role.ADMIN },
      env.JWT_SECRET
    );

    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.user.create).mockResolvedValueOnce({
      id: 'u-cashier-2',
      name: 'محمد كاشير',
      username: 'mohamed_pos',
      password: 'hashed_password',
      role: Role.CASHIER,
      createdAt: new Date(),
    });

    const res = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'محمد كاشير',
        username: 'mohamed_pos',
        password: 'password123',
        role: Role.CASHIER,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.username).toBe('mohamed_pos');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

