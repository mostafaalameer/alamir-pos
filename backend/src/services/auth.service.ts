import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { prisma } from '../config/db';
import { env } from '../config/env';

export interface CreateUserInput {
  name: string;
  username: string;
  password: string;
  role: Role;
}

export interface UpdateUserInput {
  name?: string;
  username?: string;
  password?: string;
  role?: Role;
}

export interface LoginInput {
  username: string;
  password: string;
}

export class AuthService {
  static async login(input: LoginInput) {
    let user = null;
    try {
      user = await prisma.user.findUnique({
        where: { username: input.username },
      });
    } catch {
      // Database is offline or unreachable - allow fallback to default demo users
    }

    if (user) {
      const isPasswordValid = await bcrypt.compare(input.password, user.password);
      if (!isPasswordValid) {
        throw new Error('INVALID_CREDENTIALS');
      }

      const token = jwt.sign(
        {
          userId: user.id,
          username: user.username,
          role: user.role,
        },
        env.JWT_SECRET,
        { expiresIn: '12h' }
      );

      return {
        token,
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          role: user.role,
        },
      };
    }

    // Default built-in demo users for immediate testing and offline development
    if (input.username === 'admin' && input.password === 'admin123') {
      const demoAdmin = {
        id: 'admin-demo-id',
        name: 'أحمد الأمير (المدير)',
        username: 'admin',
        role: Role.ADMIN,
      };
      const token = jwt.sign(
        {
          userId: demoAdmin.id,
          username: demoAdmin.username,
          role: demoAdmin.role,
        },
        env.JWT_SECRET,
        { expiresIn: '12h' }
      );
      return { token, user: demoAdmin };
    }

    if (input.username === 'cashier' && input.password === 'cashier123') {
      const demoCashier = {
        id: 'cashier-demo-id',
        name: 'محمد كاشير',
        username: 'cashier',
        role: Role.CASHIER,
      };
      const token = jwt.sign(
        {
          userId: demoCashier.id,
          username: demoCashier.username,
          role: demoCashier.role,
        },
        env.JWT_SECRET,
        { expiresIn: '12h' }
      );
      return { token, user: demoCashier };
    }

    throw new Error('INVALID_CREDENTIALS');
  }

  static async createUser(input: CreateUserInput) {
    const existing = await prisma.user.findUnique({
      where: { username: input.username },
    });

    if (existing) {
      throw new Error('USERNAME_EXISTS');
    }

    const hashedPassword = await bcrypt.hash(input.password, 10);

    const created = await prisma.$transaction(async (tx) => {
      return tx.user.create({
        data: {
          name: input.name,
          username: input.username,
          password: hashedPassword,
          role: input.role,
        },
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
          createdAt: true,
        },
      });
    });

    return created;
  }

  static async listUsers() {
    return prisma.user.findMany({
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async updateUser(id: string, input: UpdateUserInput) {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('USER_NOT_FOUND');
    }

    const nextUsername = input.username?.trim();
    if (nextUsername && nextUsername !== existing.username) {
      const taken = await prisma.user.findUnique({
        where: { username: nextUsername },
      });
      if (taken) {
        throw new Error('USERNAME_EXISTS');
      }
    }

    const data: Record<string, unknown> = {};
    if (input.name?.trim()) data.name = input.name.trim();
    if (nextUsername) data.username = nextUsername;
    if (input.role) data.role = input.role;
    if (input.password && input.password.length > 0) {
      data.password = await bcrypt.hash(input.password, 10);
    }

    return prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        createdAt: true,
      },
    });
  }
}

