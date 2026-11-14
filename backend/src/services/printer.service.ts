import { ChildProcessWithoutNullStreams, execFile, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { promisify } from 'util';
import QRCode from 'qrcode';
import { env } from '../config/env';
import { getCustomerDisplayName } from './loyalty.service';

const execFileAsync = promisify(execFile);

export interface ReceiptItemPayload {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface ReceiptPayload {
  orderNumber: string;
  cashierName: string;
  paymentMethod: string;
  createdAt: string;
  items: ReceiptItemPayload[];
  totalAmount: number;
  paidAmount?: number;
  changeGiven?: number;
  changeDepositedToWallet?: number;
  walletAmountUsed?: number;
  paperWidth?: '80mm' | '58mm';
  openCashDrawer?: boolean;
  customerCode?: number | string;
  customerName?: string | null;
  customerPhone?: string;
  pointsEarned?: number;
  pointsRedeemed?: number;
  discountFromPoints?: number;
  customerPointsBalance?: number;
  customerWalletBalance?: number;
}

export interface ZReportPrintPayload {
  shiftId: string;
  cashierName: string;
  openedAt: string;
  closedAt: string;
  paperWidth?: '80mm' | '58mm';
  startingCash: number;
  totalCashSales: number;
  totalCardSales: number;
  totalReturns: number;
  totalChangeCreditedToWallets?: number;
  totalWalletRedemptions?: number;
  expectedCash: number;
  actualEndCash: number;
  discrepancy: number;
}

export interface ReturnReceiptPayload {
  returnNumber: string;
  originalOrderNumber: string;
  cashierName: string;
  refundMethod: 'CASH' | 'WALLET';
  refundAmount: number;
  returnedItems: ReceiptItemPayload[];
  createdAt: string;
  paperWidth?: '80mm' | '58mm';
  customerCode?: number | string;
  customerName?: string | null;
  customerPhone?: string;
  customerWalletBalance?: number;
}

export class ThermalPrinterService {
  // Standard ESC/POS control sequences
  private static readonly ESC_INIT = [0x1b, 0x40]; // Initialize printer
  private static readonly ESC_ALIGN_CENTER = [0x1b, 0x61, 0x01];
  private static readonly ESC_ALIGN_RIGHT = [0x1b, 0x61, 0x02];
  private static readonly ESC_BOLD_ON = [0x1b, 0x45, 0x01];
  private static readonly ESC_BOLD_OFF = [0x1b, 0x45, 0x00];
  private static readonly GS_CUT_FULL = [0x1d, 0x56, 0x41, 0x10]; // Feed & Full Cut
  // RJ11 Cash Drawer Kick Pulse on Pin 2 (ESC p 0 25 250 -> 0x1B 0x70 0x00 0x19 0xFA)
  private static readonly ESC_DRAWER_KICK_PIN2 = [0x1b, 0x70, 0x00, 25, 250];

  static generateCashDrawerKickPayload(): { hex: string; base64: string; bytes: number[] } {
    const bytes = [...this.ESC_INIT, ...this.ESC_DRAWER_KICK_PIN2];
    const buffer = Buffer.from(bytes);
    return {
      bytes,
      hex: buffer.toString('hex'),
      base64: buffer.toString('base64'),
    };
  }

  static generateEscPosReceipt(payload: ReceiptPayload) {
    const dividerWidth = payload.paperWidth === '58mm' ? 32 : 48;
    const divider = '-'.repeat(dividerWidth);
    const changeGiven = payload.changeGiven ?? 0;
    const changeDepositedToWallet = payload.changeDepositedToWallet ?? 0;
    const walletAmountUsed = payload.walletAmountUsed ?? 0;

    const hasCustomer = Boolean(
      payload.customerCode !== undefined ||
        (payload.customerName && payload.customerName.trim().length > 0) ||
        payload.customerPhone
    );
    const normalizedCode =
      payload.customerCode !== undefined
        ? String(payload.customerCode).replace(/^(?:c-|#)/i, '')
        : undefined;
    const displayCustomerName = hasCustomer
      ? getCustomerDisplayName({
          name: payload.customerName,
          customerCode: normalizedCode,
        })
      : undefined;

    const lines: string[] = [
      'Alamir Market - ماركت الأمير',
      'إيصال مبيعات نقدية (غير مسجل بضريبة القيمة المضافة / معفى)',
      divider,
      `رقم الفاتورة: ${payload.orderNumber}`,
      `التاريخ: ${payload.createdAt}`,
      `الكاشير: ${payload.cashierName}`,
      `طريقة الدفع: ${payload.paymentMethod}`,
    ];

    if (normalizedCode) {
      lines.push(`رقم العميل: C-${normalizedCode}`);
    }
    if (displayCustomerName) {
      lines.push(`العميل: ${displayCustomerName}`);
    }

    lines.push(divider);
    lines.push('الصنف | الكمية × سعر الوحدة = الإجمالي');
    lines.push(divider);

    for (const item of payload.items) {
      lines.push(
        `${item.name} | ${item.quantity} x ${item.unitPrice.toFixed(2)} = ${item.lineTotal.toFixed(2)} ${env.CURRENCY}`,
        `${item.name}\n  الكمية: ${item.quantity} × سعر الوحدة: ${item.unitPrice.toFixed(2)} ${env.CURRENCY} = ${item.lineTotal.toFixed(2)} ${env.CURRENCY}`
      );
    }

    lines.push(divider);
    if (payload.discountFromPoints && payload.discountFromPoints > 0) {
      lines.push(
        `خصم نقاط الولاء (${payload.pointsRedeemed ?? 0} نقطة): -${payload.discountFromPoints.toFixed(2)} ${env.CURRENCY}`
      );
    }
    lines.push(`الإجمالي النهائي: ${payload.totalAmount.toFixed(2)} ${env.CURRENCY}`);
    if (walletAmountUsed > 0) {
      lines.push(`مدفوع من المحفظة: ${walletAmountUsed.toFixed(2)} ${env.CURRENCY}`);
    }
    if (payload.paidAmount !== undefined && payload.paidAmount > 0) {
      lines.push(`النقدية المسددة: ${payload.paidAmount.toFixed(2)} ${env.CURRENCY}`);
    }
    lines.push(`طريقة الدفع: ${payload.paymentMethod}`);
    lines.push(`الباقي للعميل: ${changeGiven.toFixed(2)} ${env.CURRENCY}`);

    if (changeDepositedToWallet > 0) {
      lines.push(
        `الباقي مضاف للمحفظة: ${changeDepositedToWallet.toFixed(2)} ${env.CURRENCY}`
      );
    }
    if (
      payload.customerWalletBalance !== undefined &&
      (hasCustomer || changeDepositedToWallet > 0 || walletAmountUsed > 0)
    ) {
      lines.push(
        `رصيد محفظتك الحالي: ${payload.customerWalletBalance.toFixed(2)} ${env.CURRENCY}`
      );
    }

    if (
      hasCustomer ||
      (payload.pointsEarned ?? 0) > 0 ||
      (payload.pointsRedeemed ?? 0) > 0
    ) {
      lines.push(divider);
      lines.push('--- ملخص برنامج نقاط الولاء ---');
      if (normalizedCode) {
        lines.push(`رقم العميل: C-${normalizedCode}`);
      }
      if (displayCustomerName) {
        lines.push(`اسم العميل: ${displayCustomerName}`);
      }
      lines.push(`النقاط المكتسبة بهذه الفاتورة: +${payload.pointsEarned ?? 0} نقطة`);
      lines.push(`النقاط المستبدلة: ${payload.pointsRedeemed ?? 0} نقطة`);
      if (payload.customerPointsBalance !== undefined) {
        lines.push(`الرصيد الجديد للنقاط: ${payload.customerPointsBalance} نقطة`);
      }
    }

    lines.push(divider);
    lines.push(`BARCODE/QR:${payload.orderNumber}`);
    lines.push('شكراً لزيارتكم ماركت الأمير');

    const textContent = lines.join('\n') + '\n';
    const textBytes = Array.from(Buffer.from(textContent, 'utf8'));
    const barcodeBytes = [
      0x1d,
      0x6b,
      73,
      payload.orderNumber.length,
      ...Array.from(Buffer.from(payload.orderNumber, 'ascii')),
    ];

    const commandBytes: number[] = [
      ...this.ESC_INIT,
      ...(payload.openCashDrawer ? this.ESC_DRAWER_KICK_PIN2 : []),
      ...this.ESC_ALIGN_CENTER,
      ...this.ESC_BOLD_ON,
      ...textBytes,
      ...this.ESC_BOLD_OFF,
      ...barcodeBytes,
      ...this.ESC_ALIGN_RIGHT,
      ...this.GS_CUT_FULL,
    ];

    const rawBuffer = Buffer.from(commandBytes);

    // Build structured 2-column visual layout matching the POS UI preview
    const paymentMethodAr =
      payload.paymentMethod === 'CARD'
        ? 'بطاقة بنكية (Card)'
        : payload.paymentMethod === 'CREDIT'
        ? 'آجل / شكك (Credit)'
        : 'نقدي (Cash)';

    const layoutLines: string[] = [
      'TITLE::Alamir Market - ماركت الأمير',
      'SUBTITLE::جمهورية مصر العربية - إيصال مبيعات (80mm ESC/POS)',
      `CENTER_BOLD::رقم الفاتورة: ${payload.orderNumber}`,
      `CENTER::التاريخ: ${payload.createdAt}`,
      `CENTER::الكاشير: ${payload.cashierName} | الدفع: ${paymentMethodAr}`,
    ];

    if (normalizedCode || displayCustomerName) {
      layoutLines.push('DASH_LIGHT');
      if (normalizedCode) {
        layoutLines.push(`CENTER_BOLD::رقم العميل: C-${normalizedCode}`);
      }
      if (displayCustomerName) {
        layoutLines.push(`CENTER_BOLD::العميل: ${displayCustomerName}`);
      }
    }

    layoutLines.push('DASH');
    layoutLines.push('TBL_HDR::الصنف / تفاصيل السعر::الإجمالي');

    for (let i = 0; i < payload.items.length; i++) {
      const item = payload.items[i];
      layoutLines.push(`ITEM_MAIN::${item.name}::${item.lineTotal.toFixed(2)} ج.م`);
      layoutLines.push(
        `ITEM_SUB::الكمية: ${item.quantity} × سعر الوحدة: ${item.unitPrice.toFixed(2)} ج.م`
      );
      if (i < payload.items.length - 1) {
        layoutLines.push('DASH_LIGHT');
      }
    }

    layoutLines.push('DASH');

    if (payload.discountFromPoints && payload.discountFromPoints > 0) {
      layoutLines.push(
        `ROW_BOLD::خصم نقاط الولاء (${payload.pointsRedeemed ?? 0} نقطة):::-${payload.discountFromPoints.toFixed(2)} ج.م`
      );
    }

    layoutLines.push(`TOTAL_BOX::الإجمالي النهائي: ::${payload.totalAmount.toFixed(2)} ج.م`);

    if (walletAmountUsed > 0 || changeDepositedToWallet > 0 || (payload.paidAmount ?? 0) > 0) {
      layoutLines.push('DASH_LIGHT');
      if (walletAmountUsed > 0) {
        layoutLines.push(`ROW_BOLD::مدفوع من المحفظة: ::${walletAmountUsed.toFixed(2)} ج.م`);
      }
      if ((payload.paidAmount ?? 0) > 0) {
        layoutLines.push(`ROW::النقدية المدفوعة: ::${(payload.paidAmount ?? 0).toFixed(2)} ج.م`);
      }
      layoutLines.push(`ROW::الباقي نقداً للعميل: ::${changeGiven.toFixed(2)} ج.م`);
      if (changeDepositedToWallet > 0) {
        layoutLines.push(
          `ROW_BOLD::الباقي مضاف للمحفظة: ::${changeDepositedToWallet.toFixed(2)} ج.م`
        );
      }
      if (
        payload.customerWalletBalance !== undefined &&
        (changeDepositedToWallet > 0 || walletAmountUsed > 0)
      ) {
        layoutLines.push(
          `ROW_BOLD::رصيد محفظتك الحالي: ::${payload.customerWalletBalance.toFixed(2)} ج.م`
        );
      }
    }

    if (
      hasCustomer ||
      (payload.pointsEarned ?? 0) > 0 ||
      (payload.pointsRedeemed ?? 0) > 0
    ) {
      layoutLines.push('DASH');
      layoutLines.push('CENTER_BOLD::--- ملخص حساب العميل (نقاط ومحفظة) ---');
      if (normalizedCode) {
        layoutLines.push(`ROW_BOLD::رقم العميل: ::C-${normalizedCode}`);
      }
      if (displayCustomerName) {
        layoutLines.push(`ROW_BOLD::العميل: ::${displayCustomerName}`);
      }
      layoutLines.push(`ROW::النقاط المكتسبة بهذه الفاتورة: ::+${payload.pointsEarned ?? 0} نقطة`);
      layoutLines.push(`ROW::النقاط المستبدلة: ::${payload.pointsRedeemed ?? 0} نقطة`);
      if (payload.customerPointsBalance !== undefined) {
        layoutLines.push(
          `ROW_BOLD::الرصيد الإجمالي الجديد للنقاط: ::${payload.customerPointsBalance} نقطة`
        );
      }
      if (payload.customerWalletBalance !== undefined) {
        layoutLines.push(
          `ROW_BOLD::رصيد محفظة الفكة الحالي: ::${payload.customerWalletBalance.toFixed(2)} ج.م`
        );
      }
    }

    layoutLines.push('DASH');
    layoutLines.push(`BARCODE::${payload.orderNumber}`);
    try {
      const qr = QRCode.create(payload.orderNumber, { errorCorrectionLevel: 'M' });
      const qrSize = qr.modules.size;
      let qrBits = '';
      for (let i = 0; i < qr.modules.data.length; i++) {
        qrBits += qr.modules.data[i] ? '1' : '0';
      }
      layoutLines.push(`QRCODE::${qrSize}::${qrBits}`);
    } catch {
      // Non-blocking if QR generation fails
    }
    layoutLines.push('CENTER_BOLD::شكراً لتسوقكم من ماركت الأمير');

    return {
      paperWidth: payload.paperWidth || '80mm',
      currency: env.CURRENCY,
      drawerTriggered: Boolean(payload.openCashDrawer),
      changeGiven,
      changeDepositedToWallet,
      walletAmountUsed,
      customerCode: normalizedCode ? `C-${normalizedCode}` : undefined,
      customerDisplayName: displayCustomerName,
      invoiceBarcode: payload.orderNumber,
      printableText: textContent,
      structuredLayoutText: layoutLines.join('\n'),
      escPosBase64: rawBuffer.toString('base64'),
      escPosHex: rawBuffer.toString('hex'),
    };
  }

  static generateZReportEscPos(payload: ZReportPrintPayload) {
    const dividerWidth = payload.paperWidth === '58mm' ? 32 : 48;
    const divider = '='.repeat(dividerWidth);
    const changeCredited = payload.totalChangeCreditedToWallets ?? 0;
    const walletRedemptions = payload.totalWalletRedemptions ?? 0;

    const lines: string[] = [
      'Alamir Market - ماركت الأمير',
      'تقرير إغلاق الوردية اليومي (Z-Report)',
      divider,
      `رقم الوردية: ${payload.shiftId}`,
      `الكاشير: ${payload.cashierName}`,
      `وقت الفتح: ${payload.openedAt}`,
      `وقت الإغلاق: ${payload.closedAt}`,
      divider,
      `عهدة البداية: ${payload.startingCash.toFixed(2)} ${env.CURRENCY}`,
      `إجمالي مبيعات الكاش: ${payload.totalCashSales.toFixed(2)} ${env.CURRENCY}`,
      `إجمالي مبيعات البطاقة: ${payload.totalCardSales.toFixed(2)} ${env.CURRENCY}`,
      `إجمالي المرتجعات: ${payload.totalReturns.toFixed(2)} ${env.CURRENCY}`,
      `إجمالي الفكة المحفوظة بالمحافظ (Change Credited to Wallets): ${changeCredited.toFixed(2)} ${env.CURRENCY}`,
      `إجمالي المدفوعات من المحافظ (Wallet Redemptions): ${walletRedemptions.toFixed(2)} ${env.CURRENCY}`,
      divider,
      `النقدية المتوقعة بالدرج: ${payload.expectedCash.toFixed(2)} ${env.CURRENCY}`,
      `النقدية الفعلية المعدودة: ${payload.actualEndCash.toFixed(2)} ${env.CURRENCY}`,
      `الفارق (العجز / الفائض): ${payload.discrepancy.toFixed(2)} ${env.CURRENCY}`,
      divider,
    ];

    const textContent = lines.join('\n') + '\n';
    const textBytes = Array.from(Buffer.from(textContent, 'utf8'));

    const commandBytes: number[] = [
      ...this.ESC_INIT,
      ...this.ESC_ALIGN_CENTER,
      ...this.ESC_BOLD_ON,
      ...textBytes,
      ...this.ESC_BOLD_OFF,
      ...this.GS_CUT_FULL,
    ];

    const rawBuffer = Buffer.from(commandBytes);

    return {
      paperWidth: payload.paperWidth || '80mm',
      currency: env.CURRENCY,
      shiftId: payload.shiftId,
      totalChangeCreditedToWallets: changeCredited,
      totalWalletRedemptions: walletRedemptions,
      printableText: textContent,
      escPosBase64: rawBuffer.toString('base64'),
      escPosHex: rawBuffer.toString('hex'),
    };
  }

  static generateReturnReceipt(payload: ReturnReceiptPayload) {
    const dividerWidth = payload.paperWidth === '58mm' ? 32 : 48;
    const divider = '-'.repeat(dividerWidth);

    const hasCustomer = Boolean(
      payload.customerCode !== undefined ||
        (payload.customerName && payload.customerName.trim().length > 0) ||
        payload.customerPhone
    );
    const normalizedCode =
      payload.customerCode !== undefined
        ? String(payload.customerCode).replace(/^(?:c-|#)/i, '')
        : undefined;
    const displayCustomerName = hasCustomer
      ? getCustomerDisplayName({
          name: payload.customerName,
          customerCode: normalizedCode,
        })
      : undefined;

    const lines: string[] = [
      'Alamir Market - ماركت الأمير',
      '*** إيصال استرجاع بضاعة (RETURN RECEIPT) ***',
      divider,
      `رقم إيصال المرتجع: ${payload.returnNumber}`,
      `الفاتورة الأصلية: ${payload.originalOrderNumber}`,
      `التاريخ: ${payload.createdAt}`,
      `الكاشير: ${payload.cashierName}`,
      `طريقة الرد: ${payload.refundMethod === 'WALLET' ? 'إيداع بمحفظة الفكة' : 'نقداً من الدرج (Cash)'}`,
    ];

    if (normalizedCode) {
      lines.push(`رقم العميل: C-${normalizedCode}`);
    }
    if (displayCustomerName) {
      lines.push(`العميل: ${displayCustomerName}`);
    }

    lines.push(divider);
    lines.push('الأصناف المرتجعة:');
    for (const item of payload.returnedItems) {
      lines.push(
        `${item.name} | ${item.quantity} x ${item.unitPrice.toFixed(2)} = ${item.lineTotal.toFixed(2)} ${env.CURRENCY}`,
        `${item.name}\n  الكمية: ${item.quantity} × سعر الوحدة: ${item.unitPrice.toFixed(2)} ${env.CURRENCY} = ${item.lineTotal.toFixed(2)} ${env.CURRENCY}`
      );
    }

    lines.push(divider);
    lines.push(`إجمالي المبلغ المردود: ${payload.refundAmount.toFixed(2)} ${env.CURRENCY}`);

    if (payload.refundMethod === 'WALLET' && payload.customerWalletBalance !== undefined) {
      lines.push(`رصيد المحفظة الجديد: ${payload.customerWalletBalance.toFixed(2)} ${env.CURRENCY}`);
    }

    lines.push(divider);
    lines.push('تم إعادة الأصناف للمخزون بنجاح');
    lines.push('شكراً لتسوقكم من ماركت الأمير');
    lines.push(divider);

    const textContent = lines.join('\n') + '\n';
    const textBytes = Array.from(Buffer.from(textContent, 'utf8'));

    const commandBytes: number[] = [
      ...this.ESC_INIT,
      ...this.ESC_ALIGN_CENTER,
      ...this.ESC_BOLD_ON,
      ...textBytes,
      ...this.ESC_BOLD_OFF,
      ...(payload.refundMethod === 'CASH' ? this.ESC_DRAWER_KICK_PIN2 : []),
      ...this.GS_CUT_FULL,
    ];

    const rawBuffer = Buffer.from(commandBytes);

    return {
      paperWidth: payload.paperWidth || '80mm',
      currency: env.CURRENCY,
      returnNumber: payload.returnNumber,
      originalOrderNumber: payload.originalOrderNumber,
      refundMethod: payload.refundMethod,
      refundAmount: payload.refundAmount,
      drawerTriggered: payload.refundMethod === 'CASH',
      printableText: textContent,
      escPosBase64: rawBuffer.toString('base64'),
      escPosHex: rawBuffer.toString('hex'),
    };
  }

  private static spoolerDaemon: ChildProcessWithoutNullStreams | null = null;
  private static spoolerPendingResolvers: Array<
    (res: { printed: boolean; printerName: string; bytesSent: number; error?: string }) => void
  > = [];

  private static getNativeSpoolerExePath(): string {
    return path.resolve(__dirname, '../../bin/pos-thermal-spooler.exe');
  }

  private static async ensureNativeSpoolerExe(): Promise<string> {
    const exePath = this.getNativeSpoolerExePath();
    if (fs.existsSync(exePath)) {
      return exePath;
    }
    const csPath = path.resolve(__dirname, '../../bin/PosThermalSpooler.cs');
    const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
    if (fs.existsSync(csPath) && fs.existsSync(cscPath)) {
      await execFileAsync(
        cscPath,
        ['/nologo', '/optimize+', '/target:exe', `/out:${exePath}`, '/r:System.Drawing.dll', csPath],
        { timeout: 10000 }
      );
    }
    return exePath;
  }

  private static getOrStartDaemon(exePath: string): ChildProcessWithoutNullStreams | null {
    if (this.spoolerDaemon && !this.spoolerDaemon.killed && this.spoolerDaemon.exitCode === null) {
      return this.spoolerDaemon;
    }
    try {
      const child = spawn(exePath, ['--daemon'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const rl = readline.createInterface({ input: child.stdout });
      rl.on('line', (line) => {
        const match = line.match(/RESULT_JSON=(\{.*\})/);
        if (match && this.spoolerPendingResolvers.length > 0) {
          const resolver = this.spoolerPendingResolvers.shift();
          if (resolver) {
            try {
              resolver(JSON.parse(match[1]));
            } catch {
              resolver({
                printed: false,
                printerName: 'Printer 80Receipt',
                bytesSent: 0,
                error: 'Invalid JSON from spooler daemon',
              });
            }
          }
        }
      });

      child.on('exit', () => {
        this.spoolerDaemon = null;
        while (this.spoolerPendingResolvers.length > 0) {
          const r = this.spoolerPendingResolvers.shift();
          r?.({
            printed: false,
            printerName: 'Printer 80Receipt',
            bytesSent: 0,
            error: 'Spooler daemon exited unexpectedly',
          });
        }
      });

      this.spoolerDaemon = child;
      return child;
    } catch {
      this.spoolerDaemon = null;
      return null;
    }
  }

  /**
   * Pre-warms the native C# WinSpool daemon at server startup so cash drawer kicks
   * and thermal prints execute in <15 milliseconds with zero process-spawn delay.
   */
  static warmUpSpoolerDaemon(): void {
    if (process.platform !== 'win32' || process.env.VITEST || process.env.NODE_ENV === 'test') {
      return;
    }
    void this.ensureNativeSpoolerExe()
      .then((exePath) => {
        if (fs.existsSync(exePath)) {
          this.getOrStartDaemon(exePath);
        }
      })
      .catch(() => {
        // Ignore warmup errors
      });
  }

  /**
   * Sends a rasterized ESC/POS Arabic + English receipt or cash drawer kick directly to
   * the connected Windows USB thermal printer ("Printer 80Receipt") in <15ms via native WinSpool.
   */
  static async printToPhysicalThermalPrinter(options: {
    printableText: string;
    paperWidth?: '80mm' | '58mm';
    cutPaper?: boolean;
    openCashDrawer?: boolean;
    printerName?: string;
  }): Promise<{
    printed: boolean;
    printerName: string;
    bytesSent: number;
    error?: string;
  }> {
    const preferredPrinter =
      options.printerName || process.env.THERMAL_PRINTER_NAME || 'Printer 80Receipt';
    if (process.env.VITEST || process.env.NODE_ENV === 'test') {
      return {
        printed: false,
        printerName: preferredPrinter,
        bytesSent: 0,
      };
    }

    if (process.platform !== 'win32') {
      return {
        printed: false,
        printerName: preferredPrinter,
        bytesSent: 0,
        error: 'Physical WinSpool printing is only supported on Windows hosts.',
      };
    }

    const cleanedText = options.printableText.replace(/\r\n/g, '\n').trimEnd();
    const widthDots = options.paperWidth === '58mm' ? 384 : 576;
    const cutFlag = options.cutPaper !== false && cleanedText.length > 0 ? '1' : '0';
    const kickFlag = options.openCashDrawer ? '1' : '0';

    const printerB64 = Buffer.from(preferredPrinter, 'utf8').toString('base64');
    const textB64 = cleanedText.length > 0 ? Buffer.from(cleanedText, 'utf8').toString('base64') : '';
    const jobLine = `${printerB64}|${widthDots}|${cutFlag}|${kickFlag}|${textB64}`;

    try {
      const exePath = await this.ensureNativeSpoolerExe();
      const daemon = this.getOrStartDaemon(exePath);

      if (daemon && daemon.stdin.writable) {
        return await new Promise((resolve) => {
          const timer = setTimeout(() => {
            const idx = this.spoolerPendingResolvers.indexOf(wrappedResolve);
            if (idx !== -1) this.spoolerPendingResolvers.splice(idx, 1);
            resolve({
              printed: false,
              printerName: preferredPrinter,
              bytesSent: 0,
              error: 'Spooler daemon timed out',
            });
          }, 5000);

          const wrappedResolve = (res: {
            printed: boolean;
            printerName: string;
            bytesSent: number;
            error?: string;
          }) => {
            clearTimeout(timer);
            resolve(res);
          };

          this.spoolerPendingResolvers.push(wrappedResolve);
          daemon.stdin.write(jobLine + '\n', 'utf8');
        });
      }

      // Direct native exe fallback (~180ms, no PowerShell needed)
      const { stdout } = await execFileAsync(exePath, [jobLine], {
        timeout: 5000,
        windowsHide: true,
      });
      const match = stdout.match(/RESULT_JSON=(\{.*\})/);
      if (match) {
        return JSON.parse(match[1]);
      }
      return {
        printed: false,
        printerName: preferredPrinter,
        bytesSent: 0,
        error: 'Unexpected output from native spooler',
      };
    } catch (err: unknown) {
      return {
        printed: false,
        printerName: preferredPrinter,
        bytesSent: 0,
        error: err instanceof Error ? err.message : 'WinSpool execution failed',
      };
    }
  }
}

// Pre-warm the native C# WinSpool daemon when the module is loaded
ThermalPrinterService.warmUpSpoolerDaemon();
