import { Request, Response } from 'express';
import { BackupService, FullDatabaseBackupPayload } from '../services/backup.service';

export class BackupController {
  /**
   * GET /api/backup/export
   * Exports all PostgreSQL tables as a structured JSON backup (ADMIN only).
   */
  static async exportBackup(req: Request, res: Response): Promise<void> {
    try {
      const exportedBy = req.user?.username || req.user?.userId;
      const backup = await BackupService.exportFullBackup(exportedBy);

      if (req.query.download === '1' || req.query.download === 'true') {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="alamir-pos-backup-${stamp}.json"`
        );
        res.status(200).send(JSON.stringify(backup, null, 2));
        return;
      }

      res.status(200).json({
        success: true,
        data: backup,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        message:
          err instanceof Error
            ? err.message
            : 'تعذر تصدير النسخة الاحتياطية لقاعدة البيانات',
      });
    }
  }

  /**
   * POST /api/backup/restore
   * Restores all PostgreSQL tables from a previously exported JSON backup (ADMIN only).
   */
  static async restoreBackup(req: Request, res: Response): Promise<void> {
    try {
      const payload = req.body as FullDatabaseBackupPayload;
      const restoredBy = req.user?.username || req.user?.userId;
      const restoredCounts = await BackupService.restoreFullBackup(payload, restoredBy);

      res.status(200).json({
        success: true,
        message: 'تمت استعادة قاعدة البيانات بالكامل بنجاح',
        data: { restoredCounts },
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'تعذر استعادة قاعدة البيانات من ملف النسخة الاحتياطية';
      const status = msg.includes('غير صالح') ? 400 : 500;
      res.status(status).json({
        success: false,
        message: msg,
      });
    }
  }
}