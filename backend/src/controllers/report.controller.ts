import { Request, Response } from 'express';
import { ReportService } from '../services/report.service';

export class ReportController {
  static async getDashboardOverview(_req: Request, res: Response): Promise<void> {
    try {
      const overview = await ReportService.getDashboardOverview();
      res.status(200).json({
        success: true,
        data: overview,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر جلب ملخص المبيعات والورديات الحية',
      });
    }
  }

  static async getProfitAndLoss(req: Request, res: Response): Promise<void> {
    try {
      const startDate =
        typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
      const endDate =
        typeof req.query.endDate === 'string' ? req.query.endDate : undefined;

      const summary = await ReportService.getProfitAndLossSummary({
        startDate,
        endDate,
      });

      res.status(200).json({
        success: true,
        data: summary,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر حساب تقرير الأرباح والخسائر',
      });
    }
  }

  static async exportSalesExcel(req: Request, res: Response): Promise<void> {
    try {
      const startDate =
        typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
      const endDate =
        typeof req.query.endDate === 'string' ? req.query.endDate : undefined;

      const buffer = await ReportService.generateSalesExcelBuffer({
        startDate,
        endDate,
      });

      const fileName = `alamir-sales-report-${new Date().toISOString().split('T')[0]}.xlsx`;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.status(200).send(buffer);
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر تصدير تقرير المبيعات إلى إكسيل',
      });
    }
  }

  static async exportInventoryExcel(req: Request, res: Response): Promise<void> {
    try {
      const expiryDays = Number(req.query.expiryDays) || 90;
      const buffer = await ReportService.generateInventoryExcelBuffer(expiryDays);

      const fileName = `alamir-inventory-report-${new Date().toISOString().split('T')[0]}.xlsx`;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.status(200).send(buffer);
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر تصدير تقرير المخزون إلى إكسيل',
      });
    }
  }

  static async exportShiftsExcel(req: Request, res: Response): Promise<void> {
    try {
      const startDate =
        typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
      const endDate =
        typeof req.query.endDate === 'string' ? req.query.endDate : undefined;

      const buffer = await ReportService.generateShiftsExcelBuffer({
        startDate,
        endDate,
      });

      const fileName = `alamir-shifts-report-${new Date().toISOString().split('T')[0]}.xlsx`;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.status(200).send(buffer);
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر تصدير سجل الورديات إلى إكسيل',
      });
    }
  }

  static async exportExcelReport(req: Request, res: Response): Promise<void> {
    try {
      const startDate =
        typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
      const endDate =
        typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
      const expiryDays = Number(req.query.expiryDays) || 90;

      const buffer = await ReportService.generateExcelWorkbook(
        { startDate, endDate },
        expiryDays
      );

      const fileName = `alamir-pos-report-${new Date().toISOString().split('T')[0]}.xlsx`;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.status(200).send(buffer);
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر تصدير ملف الإكسيل',
      });
    }
  }
}
