using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.InteropServices;

public class PosThermalSpooler
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOW
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOW di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    // Official ISO/IEC 15417 Code 128 patterns (indices 0..106)
    private static readonly string[] CODE128_PATTERNS = new string[] {
        "11011001100","11001101100","11001100110","10010011000","10010001100","10001001100","10011001000","10011000100",
        "10001100100","11001001000","11001000100","11000100100","10110011100","10011011100","10011001110","10111001100",
        "10011101100","10011100110","11001110010","11001011100","11001001110","11011100100","11001110100","11101101110",
        "11101001100","11100101100","11100100110","11101100100","11100110100","11100110010","11011011000","11011000110",
        "11000110110","10100011000","10001011000","10001000110","10110001000","10001101000","10001100010","11010001000",
        "11000101000","11000100010","10110111000","10110001110","10001101110","10111011000","10111000110","10001110110",
        "11101110110","11010001110","11000101110","11011101000","11011100010","11011101110","11101011000","11101000110",
        "11100010110","11101101000","11101100010","11100011010","11101111010","11001000010","11110001010","10100110000",
        "10100001100","10010110000","10010000110","10000101100","10000100110","10110010000","10110000100","10011010000",
        "10011000010","10000110100","10000110010","11000010010","11001010000","11110111010","11000010100","10001111010",
        "10100111100","10010111100","10010011110","10111100100","10011110100","10011110010","11110100100","11110010100",
        "11110010010","11011011110","11011110110","11110110110","10101111000","10100011110","10001011110","10111101000",
        "10111100010","11110101000","11110100010","10111011110","10111101110","11101011110","11110101110","11010000100",
        "11010010000","11010011100","1100011101011"
    };

    private static string EncodeCode128B(string text)
    {
        if (string.IsNullOrEmpty(text)) return "";
        List<int> codes = new List<int>();
        codes.Add(104); // Start Code B
        int checksum = 104;
        for (int i = 0; i < text.Length; i++)
        {
            int ascii = (int)text[i];
            if (ascii < 32 || ascii > 127) ascii = (int)'-';
            int val = ascii - 32;
            codes.Add(val);
            checksum += val * (i + 1);
        }
        codes.Add(checksum % 103);
        codes.Add(106); // Stop

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < codes.Count; i++)
        {
            sb.Append(CODE128_PATTERNS[codes[i]]);
        }
        return sb.ToString();
    }

    public static bool SendRawBytes(string printerName, byte[] bytes, string docName)
    {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
        {
            return false;
        }
        try
        {
            DOCINFOW di = new DOCINFOW
            {
                pDocName = docName,
                pDataType = "RAW"
            };
            if (!StartDocPrinter(hPrinter, 1, di)) return false;
            try
            {
                if (!StartPagePrinter(hPrinter)) return false;
                try
                {
                    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                    try
                    {
                        Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                        int dwWritten;
                        bool ok = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
                        return ok && dwWritten == bytes.Length;
                    }
                    finally
                    {
                        Marshal.FreeCoTaskMem(pUnmanagedBytes);
                    }
                }
                finally
                {
                    EndPagePrinter(hPrinter);
                }
            }
            finally
            {
                EndDocPrinter(hPrinter);
            }
        }
        finally
        {
            ClosePrinter(hPrinter);
        }
    }

    private static int EstimateHeight(string[] lines)
    {
        int h = 44;
        for (int i = 0; i < lines.Length; i++)
        {
            string l = lines[i] ?? "";
            if (l.StartsWith("TITLE::")) h += 36;
            else if (l.StartsWith("TOTAL_BOX::")) h += 44;
            else if (l.StartsWith("BARCODE::")) h += 92;
            else if (l.StartsWith("QRCODE::")) h += 165;
            else if (l == "DASH" || l == "SOLID" || l == "DASH_LIGHT") h += 16;
            else if (l.StartsWith("TBL_HDR::")) h += 32;
            else if (l.StartsWith("ITEM_MAIN::")) h += 28;
            else if (l.StartsWith("ITEM_SUB::")) h += 26;
            else h += 28;
        }
        return Math.Max(160, h + 40);
    }

    private static void DrawCode128Barcode(Graphics g, string code, int widthDots, ref int y)
    {
        string bits = EncodeCode128B(code);
        if (string.IsNullOrEmpty(bits)) return;

        int maxUsableW = widthDots - 32;
        int moduleW = Math.Max(2, Math.Min(3, maxUsableW / bits.Length));
        int totalBarWidth = bits.Length * moduleW;
        int startX = (widthDots - totalBarWidth) / 2;
        int barTop = y + 4;
        int barHeight = 52;

        for (int i = 0; i < bits.Length; i++)
        {
            if (bits[i] == '1')
            {
                g.FillRectangle(Brushes.Black, startX + i * moduleW, barTop, moduleW, barHeight);
            }
        }

        y += barHeight + 6;
        using (Font fCode = new Font("Consolas", 14, FontStyle.Bold, GraphicsUnit.Pixel))
        using (StringFormat sfCenterLtr = new StringFormat { Alignment = StringAlignment.Center })
        {
            g.DrawString(code, fCode, Brushes.Black, new RectangleF(10, y, widthDots - 20, 22), sfCenterLtr);
        }
        y += 26;
    }

    private static void DrawQrCodeMatrix(Graphics g, int size, string bits, int widthDots, ref int y)
    {
        if (size <= 0 || string.IsNullOrEmpty(bits) || bits.Length < size * size) return;
        int modulePx = Math.Max(4, Math.Min(6, (widthDots - 120) / size));
        int qrPx = size * modulePx;
        int startX = (widthDots - qrPx) / 2;
        int startY = y + 6;

        for (int r = 0; r < size; r++)
        {
            for (int c = 0; c < size; c++)
            {
                if (bits[r * size + c] == '1')
                {
                    g.FillRectangle(Brushes.Black, startX + c * modulePx, startY + r * modulePx, modulePx, modulePx);
                }
            }
        }
        y = startY + qrPx + 10;
    }

    public static byte[] RenderLinesToEscPos(string[] lines, int widthDots, bool cutPaper)
    {
        using (Font fontTitle = new Font("Tahoma", 23, FontStyle.Bold, GraphicsUnit.Pixel))
        using (Font fontSubtitle = new Font("Tahoma", 14, FontStyle.Bold, GraphicsUnit.Pixel))
        using (Font fontTotal = new Font("Tahoma", 20, FontStyle.Bold, GraphicsUnit.Pixel))
        using (Font fontBold = new Font("Tahoma", 16, FontStyle.Bold, GraphicsUnit.Pixel))
        using (Font fontRegular = new Font("Tahoma", 15, FontStyle.Regular, GraphicsUnit.Pixel))
        using (Font fontSub = new Font("Tahoma", 14, FontStyle.Regular, GraphicsUnit.Pixel))
        using (StringFormat sfCenter = new StringFormat { Alignment = StringAlignment.Center, FormatFlags = StringFormatFlags.DirectionRightToLeft })
        using (StringFormat sfRight = new StringFormat { Alignment = StringAlignment.Near, FormatFlags = StringFormatFlags.DirectionRightToLeft })
        using (StringFormat sfLeft = new StringFormat { Alignment = StringAlignment.Far, FormatFlags = StringFormatFlags.DirectionRightToLeft })
        {
            int heightDots = EstimateHeight(lines);
            int marginX = 12;
            int innerW = widthDots - marginX * 2;

            using (Bitmap bmp = new Bitmap(widthDots, heightDots, PixelFormat.Format24bppRgb))
            {
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.Clear(Color.White);
                    g.SmoothingMode = SmoothingMode.None;
                    g.TextRenderingHint = TextRenderingHint.SingleBitPerPixelGridFit;

                    // Top thick border like border-t-4 in the preview
                    g.FillRectangle(Brushes.Black, marginX, 6, innerW, 4);
                    int y = 16;

                    for (int i = 0; i < lines.Length; i++)
                    {
                        string line = (lines[i] ?? "").Trim();
                        if (line.Length == 0) continue;

                        if (line == "DASH" || line.StartsWith("---"))
                        {
                            using (Pen dashPen = new Pen(Color.Black, 2))
                            {
                                dashPen.DashStyle = DashStyle.Dash;
                                g.DrawLine(dashPen, marginX, y + 7, widthDots - marginX, y + 7);
                            }
                            y += 16;
                            continue;
                        }

                        if (line == "DASH_LIGHT")
                        {
                            using (Pen dotPen = new Pen(Color.Black, 1))
                            {
                                dotPen.DashStyle = DashStyle.Dot;
                                g.DrawLine(dotPen, marginX, y + 5, widthDots - marginX, y + 5);
                            }
                            y += 12;
                            continue;
                        }

                        if (line == "SOLID" || line.StartsWith("==="))
                        {
                            using (Pen solidPen = new Pen(Color.Black, 2))
                            {
                                g.DrawLine(solidPen, marginX, y + 7, widthDots - marginX, y + 7);
                            }
                            y += 16;
                            continue;
                        }

                        if (line.StartsWith("TITLE::"))
                        {
                            string txt = line.Substring(7);
                            g.DrawString(txt, fontTitle, Brushes.Black, new RectangleF(marginX, y, innerW, 34), sfCenter);
                            y += 34;
                            continue;
                        }

                        if (line.StartsWith("SUBTITLE::"))
                        {
                            string txt = line.Substring(10);
                            g.DrawString(txt, fontSubtitle, Brushes.Black, new RectangleF(marginX, y, innerW, 24), sfCenter);
                            y += 24;
                            continue;
                        }

                        if (line.StartsWith("CENTER_BOLD::"))
                        {
                            string txt = line.Substring(13);
                            g.DrawString(txt, fontBold, Brushes.Black, new RectangleF(marginX, y, innerW, 26), sfCenter);
                            y += 26;
                            continue;
                        }

                        if (line.StartsWith("CENTER::"))
                        {
                            string txt = line.Substring(8);
                            g.DrawString(txt, fontRegular, Brushes.Black, new RectangleF(marginX, y, innerW, 25), sfCenter);
                            y += 25;
                            continue;
                        }

                        if (line.StartsWith("TBL_HDR::"))
                        {
                            string[] cols = line.Substring(9).Split(new string[] { "::" }, StringSplitOptions.None);
                            string rightCol = cols.Length > 0 ? cols[0] : "";
                            string leftCol = cols.Length > 1 ? cols[1] : "";
                            g.DrawString(rightCol, fontSubtitle, Brushes.Black, new RectangleF(marginX + 140, y, innerW - 140, 24), sfRight);
                            g.DrawString(leftCol, fontSubtitle, Brushes.Black, new RectangleF(marginX, y, 140, 24), sfLeft);
                            y += 24;
                            using (Pen dotPen = new Pen(Color.Black, 1))
                            {
                                dotPen.DashStyle = DashStyle.Dash;
                                g.DrawLine(dotPen, marginX, y + 2, widthDots - marginX, y + 2);
                            }
                            y += 8;
                            continue;
                        }

                        if (line.StartsWith("ITEM_MAIN::"))
                        {
                            string[] cols = line.Substring(11).Split(new string[] { "::" }, StringSplitOptions.None);
                            string rightCol = cols.Length > 0 ? cols[0] : "";
                            string leftCol = cols.Length > 1 ? cols[1] : "";
                            g.DrawString(rightCol, fontBold, Brushes.Black, new RectangleF(marginX + 145, y, innerW - 145, 26), sfRight);
                            g.DrawString(leftCol, fontBold, Brushes.Black, new RectangleF(marginX, y, 145, 26), sfLeft);
                            y += 26;
                            continue;
                        }

                        if (line.StartsWith("ITEM_SUB::"))
                        {
                            string txt = line.Substring(10);
                            g.DrawString(txt, fontSub, Brushes.Black, new RectangleF(marginX, y, innerW - 6, 22), sfRight);
                            y += 24;
                            continue;
                        }

                        if (line.StartsWith("ROW::") || line.StartsWith("ROW_BOLD::"))
                        {
                            bool isBold = line.StartsWith("ROW_BOLD::");
                            string rest = isBold ? line.Substring(10) : line.Substring(5);
                            string[] cols = rest.Split(new string[] { "::" }, StringSplitOptions.None);
                            string rightCol = cols.Length > 0 ? cols[0] : "";
                            string leftCol = cols.Length > 1 ? cols[1] : "";
                            Font f = isBold ? fontBold : fontRegular;
                            g.DrawString(rightCol, f, Brushes.Black, new RectangleF(marginX + 165, y, innerW - 165, 26), sfRight);
                            g.DrawString(leftCol, f, Brushes.Black, new RectangleF(marginX, y, 165, 26), sfLeft);
                            y += 26;
                            continue;
                        }

                        if (line.StartsWith("TOTAL_BOX::"))
                        {
                            string[] cols = line.Substring(11).Split(new string[] { "::" }, StringSplitOptions.None);
                            string rightCol = cols.Length > 0 ? cols[0] : "";
                            string leftCol = cols.Length > 1 ? cols[1] : "";
                            using (Pen boxPen = new Pen(Color.Black, 2))
                            {
                                g.DrawRectangle(boxPen, marginX, y + 2, innerW, 36);
                            }
                            g.DrawString(rightCol, fontTotal, Brushes.Black, new RectangleF(marginX + 180, y + 6, innerW - 190, 30), sfRight);
                            g.DrawString(leftCol, fontTotal, Brushes.Black, new RectangleF(marginX + 10, y + 6, 175, 30), sfLeft);
                            y += 44;
                            continue;
                        }

                        if (line.StartsWith("BARCODE::"))
                        {
                            string code = line.Substring(9).Trim();
                            DrawCode128Barcode(g, code, widthDots, ref y);
                            continue;
                        }

                        if (line.StartsWith("QRCODE::"))
                        {
                            string[] qparts = line.Substring(8).Split(new string[] { "::" }, StringSplitOptions.None);
                            if (qparts.Length >= 2)
                            {
                                int qSize;
                                if (int.TryParse(qparts[0], out qSize))
                                {
                                    DrawQrCodeMatrix(g, qSize, qparts[1], widthDots, ref y);
                                }
                            }
                            continue;
                        }

                        // Fallback for untagged lines (e.g. Z-report or Return Receipt lines)
                        int colonIdx = line.IndexOf(':');
                        if (colonIdx > 0 && colonIdx < line.Length - 1 && !line.StartsWith("وقت ") && !line.StartsWith("التاريخ"))
                        {
                            string rLabel = line.Substring(0, colonIdx + 1).Trim();
                            string lVal = line.Substring(colonIdx + 1).Trim();
                            bool boldRow = line.Contains("الإجمالي") || line.Contains("المتوقعة") || line.Contains("الفعلية") || line.Contains("الفارق") || line.Contains("المردود");
                            Font f = boldRow ? fontBold : fontRegular;
                            g.DrawString(rLabel, f, Brushes.Black, new RectangleF(marginX + 170, y, innerW - 170, 26), sfRight);
                            g.DrawString(lVal, f, Brushes.Black, new RectangleF(marginX, y, 170, 26), sfLeft);
                            y += 26;
                        }
                        else
                        {
                            bool isHdr = (i <= 1) || line.Contains("شكراً") || line.Contains("***");
                            Font f = isHdr ? fontBold : fontRegular;
                            StringFormat sf = isHdr ? sfCenter : sfRight;
                            g.DrawString(line, f, Brushes.Black, new RectangleF(marginX, y, innerW, 26), sf);
                            y += 26;
                        }
                    }

                    heightDots = Math.Min(heightDots, y + 16);
                }

                // Fast LockBits scan
                BitmapData bmpData = bmp.LockBits(new Rectangle(0, 0, widthDots, heightDots), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
                int stride = bmpData.Stride;
                byte[] rawPixels = new byte[stride * heightDots];
                Marshal.Copy(bmpData.Scan0, rawPixels, 0, rawPixels.Length);
                bmp.UnlockBits(bmpData);

                int widthBytes = (widthDots + 7) / 8;
                using (MemoryStream ms = new MemoryStream(widthBytes * heightDots + 256))
                {
                    ms.Write(new byte[] { 0x1B, 0x40 }, 0, 2);
                    int row = 0;
                    while (row < heightDots)
                    {
                        int chunkH = Math.Min(240, heightDots - row);
                        ms.Write(new byte[] {
                            0x1D, 0x76, 0x30, 0x00,
                            (byte)(widthBytes & 0xFF), (byte)((widthBytes >> 8) & 0xFF),
                            (byte)(chunkH & 0xFF), (byte)((chunkH >> 8) & 0xFF)
                        }, 0, 8);

                        for (int y = row; y < row + chunkH; y++)
                        {
                            int rowOffset = y * stride;
                            for (int bx = 0; bx < widthBytes; bx++)
                            {
                                byte b = 0;
                                int baseX = bx * 8;
                                for (int bit = 0; bit < 8; bit++)
                                {
                                    int x = baseX + bit;
                                    if (x < widthDots)
                                    {
                                        if (rawPixels[rowOffset + x * 3] < 160)
                                        {
                                            b |= (byte)(0x80 >> bit);
                                        }
                                    }
                                }
                                ms.WriteByte(b);
                            }
                        }
                        row += chunkH;
                    }
                    ms.Write(new byte[] { 0x1B, 0x64, 0x04 }, 0, 3);
                    if (cutPaper)
                    {
                        ms.Write(new byte[] { 0x1D, 0x56, 0x42, 0x00 }, 0, 4);
                    }
                    return ms.ToArray();
                }
            }
        }
    }

    public static string ProcessJob(string requestLine)
    {
        try
        {
            string[] parts = requestLine.Trim().Split('|');
            if (parts.Length < 5)
            {
                return "{\"printed\":false,\"printerName\":\"\",\"bytesSent\":0,\"error\":\"Invalid job format\"}";
            }

            string printerName = Encoding.UTF8.GetString(Convert.FromBase64String(parts[0]));
            int widthDots = int.Parse(parts[1]);
            bool cutPaper = parts[2] == "1";
            bool kickDrawer = parts[3] == "1";
            string textContent = parts[4].Length > 0 ? Encoding.UTF8.GetString(Convert.FromBase64String(parts[4])) : "";

            int totalBytesSent = 0;
            bool ok = true;

            if (kickDrawer)
            {
                byte[] kickBytes = new byte[] { 0x1B, 0x40, 0x1B, 0x70, 0x00, 0x19, 0xFA };
                ok = SendRawBytes(printerName, kickBytes, "AlAmir POS Drawer Kick");
                if (ok) totalBytesSent += kickBytes.Length;
            }

            string trimmed = textContent.Trim();
            if (trimmed.Length > 0)
            {
                string[] rawLines = textContent.Replace("\r\n", "\n").Split('\n');
                byte[] receiptBytes = RenderLinesToEscPos(rawLines, widthDots, cutPaper);
                bool receiptOk = SendRawBytes(printerName, receiptBytes, "AlAmir POS Thermal Receipt");
                ok = receiptOk;
                if (receiptOk) totalBytesSent += receiptBytes.Length;
            }

            string safePrinter = printerName.Replace("\\", "\\\\").Replace("\"", "\\\"");
            return string.Format("{{\"printed\":{0},\"printerName\":\"{1}\",\"bytesSent\":{2}}}",
                ok ? "true" : "false", safePrinter, totalBytesSent);
        }
        catch (Exception ex)
        {
            string safeErr = (ex.Message ?? "Error").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
            return string.Format("{{\"printed\":false,\"printerName\":\"\",\"bytesSent\":0,\"error\":\"{0}\"}}", safeErr);
        }
    }

    public static int Main(string[] args)
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = Encoding.UTF8;

        if (args.Length > 0 && args[0] == "--daemon")
        {
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                string res = ProcessJob(line);
                Console.WriteLine("RESULT_JSON=" + res);
                Console.Out.Flush();
            }
            return 0;
        }
        else if (args.Length > 0)
        {
            string res = ProcessJob(args[0]);
            Console.WriteLine("RESULT_JSON=" + res);
            return 0;
        }
        return 1;
    }
}
