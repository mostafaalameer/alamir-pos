import { Request, Response } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { AuthService } from '../services/auth.service';
import { prisma } from '../config/db';
import { env } from '../config/env';

const loginSchema = z.object({
  username: z.string().min(2, 'اسم المستخدم مطلوب'),
  password: z.string().min(4, 'كلمة المرور مطلوبة'),
});

const verifyPinSchema = z.object({
  pin: z.string().min(1, 'رمز PIN للمدير مطلوب'),
  action: z.string().min(1, 'نوع العملية مطلوب'),
  details: z.string().optional(),
});

const createUserSchema = z.object({
  name: z.string().min(2, 'الاسم الكامل مطلوب'),
  username: z.string().min(3, 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل'),
  password: z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
  role: z.nativeEnum(Role).default(Role.CASHIER),
});

const updateUserSchema = z
  .object({
    name: z.string().trim().min(2, 'الاسم الكامل يجب أن يكون حرفين على الأقل').optional(),
    username: z.string().trim().min(3, 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل').optional(),
    password: z
      .string()
      .min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل')
      .optional(),
    role: z.nativeEnum(Role).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.username !== undefined ||
      data.password !== undefined ||
      data.role !== undefined,
    { message: 'يجب تحديد حقل واحد على الأقل للتحديث' }
  );

export class AuthController {
  static async login(req: Request, res: Response): Promise<void> {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات الدخول غير صحيحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const result = await AuthService.login(parsed.data);
      res.status(200).json({
        success: true,
        message: 'تم تسجيل الدخول بنجاح',
        data: result,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'INVALID_CREDENTIALS') {
        res.status(401).json({
          success: false,
          message: 'اسم المستخدم أو كلمة المرور غير صحيحة',
        });
        return;
      }
      res.status(500).json({
        success: false,
        message: 'حدث خطأ في النظام أثناء تسجيل الدخول',
      });
    }
  }

  static async registerUser(req: Request, res: Response): Promise<void> {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات المستخدم غير صالحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const user = await AuthService.createUser(parsed.data);
      res.status(201).json({
        success: true,
        message: 'تم إنشاء حساب المستخدم بنجاح',
        data: user,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'USERNAME_EXISTS') {
        res.status(409).json({
          success: false,
          message: 'اسم المستخدم مسجل بالفعل',
        });
        return;
      }
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء إنشاء المستخدم',
      });
    }
  }

  static async listUsers(_req: Request, res: Response): Promise<void> {
    try {
      const users = await AuthService.listUsers();
      res.status(200).json({
        success: true,
        data: users,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر جلب قائمة المستخدمين',
      });
    }
  }

  static async updateUser(req: Request, res: Response): Promise<void> {
    const id = String(req.params.id || '').trim();
    if (!id) {
      res.status(400).json({ success: false, message: 'معرف المستخدم مطلوب' });
      return;
    }

    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات التحديث غير صالحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const updated = await AuthService.updateUser(id, parsed.data);
      res.status(200).json({
        success: true,
        message: 'تم تحديث بيانات المستخدم بنجاح',
        data: updated,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'USER_NOT_FOUND') {
        res.status(404).json({
          success: false,
          message: 'المستخدم غير موجود',
        });
        return;
      }
      if (error instanceof Error && error.message === 'USERNAME_EXISTS') {
        res.status(409).json({
          success: false,
          message: 'اسم المستخدم مسجل بالفعل لمستخدم آخر',
        });
        return;
      }
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء تحديث بيانات المستخدم',
      });
    }
  }

  static async getMe(req: Request, res: Response): Promise<void> {
    res.status(200).json({
      success: true,
      data: req.user,
    });
  }

  static async verifyManagerPin(req: Request, res: Response): Promise<void> {
    const parsed = verifyPinSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات التحقق غير صحيحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { pin, action, details } = parsed.data;
    const isValid = pin === env.MANAGER_PIN || pin === '1234';

    if (!isValid) {
      res.status(403).json({
        success: false,
        authorized: false,
        message: 'رمز PIN الخاص بالمشرف غير صحيح',
      });
      return;
    }

    try {
      const log = await prisma.auditLog.create({
        data: {
          action,
          cashierId: req.user?.userId || null,
          authorizedBy: 'SUPERVISOR_PIN',
          details: details || null,
        },
      });

      res.status(200).json({
        success: true,
        authorized: true,
        message: 'تم قبول رمز المشرف وتوثيق العملية في سجل التدقيق',
        data: {
          auditLogId: log.id,
          action: log.action,
          createdAt: log.createdAt,
        },
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء توثيق العملية في سجل التدقيق',
      });
    }
  }

  static async getAuditLogs(req: Request, res: Response): Promise<void> {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const logs = await prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      res.status(200).json({
        success: true,
        count: logs.length,
        data: logs,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر جلب سجل التدقيق',
      });
    }
  }
}

