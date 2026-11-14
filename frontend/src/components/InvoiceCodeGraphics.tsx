import { useMemo } from 'react';
import QRCode from 'qrcode';

const CODE128_PATTERNS = [
  '11011001100','11001101100','11001100110','10010011000','10010001100','10001001100','10011001000','10011000100',
  '10001100100','11001001000','11001000100','11000100100','10110011100','10011011100','10011001110','10111001100',
  '10011101100','10011100110','11001110010','11001011100','11001001110','11011100100','11001110100','11101101110',
  '11101001100','11100101100','11100100110','11101100100','11100110100','11100110010','11011011000','11011000110',
  '11000110110','10100011000','10001011000','10001000110','10110001000','10001101000','10001100010','11010001000',
  '11000101000','11000100010','10110111000','10110001110','10001101110','10111011000','10111000110','10001110110',
  '11101110110','11010001110','11000101110','11011101000','11011100010','11011101110','11101011000','11101000110',
  '11100010110','11101101000','11101100010','11100011010','11101111010','11001000010','11110001010','10100110000',
  '10100001100','10010110000','10010000110','10000101100','10000100110','10110010000','10110000100','10011010000',
  '10011000010','10000110100','10000110010','11000010010','11001010000','11110111010','11000010100','10001111010',
  '10100111100','10010111100','10010011110','10111100100','10011110100','10011110010','11110100100','11110010100',
  '11110010010','11011011110','11011110110','11110110110','10101111000','10100011110','10001011110','10111101000',
  '10111100010','11110101000','11110100010','10111011110','10111101110','11101011110','11110101110','11010000100',
  '11010010000','11010011100','1100011101011',
];

function encodeCode128B(value: string): string {
  if (!value) return '';
  const codes: number[] = [104];
  let checksum = 104;
  for (let i = 0; i < value.length; i++) {
    let ascii = value.charCodeAt(i);
    if (ascii < 32 || ascii > 127) ascii = 45;
    const val = ascii - 32;
    codes.push(val);
    checksum += val * (i + 1);
  }
  codes.push(checksum % 103);
  codes.push(106);
  return codes.map((c) => CODE128_PATTERNS[c]).join('');
}

export function InvoiceCodeGraphics({ orderNumber }: { orderNumber: string }) {
  const barcodeBits = useMemo(() => encodeCode128B(orderNumber), [orderNumber]);

  const qrMatrix = useMemo(() => {
    try {
      const qr = QRCode.create(orderNumber, { errorCorrectionLevel: 'M' });
      const size = qr.modules.size;
      const cells: Array<{ r: number; c: number }> = [];
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (qr.modules.data[r * size + c]) {
            cells.push({ r, c });
          }
        }
      }
      return { size, cells };
    } catch {
      return null;
    }
  }, [orderNumber]);

  return (
    <div className="flex flex-col items-center gap-2 py-1">
      {barcodeBits && (
        <div className="flex flex-col items-center">
          <svg
            viewBox={`-10 0 ${barcodeBits.length + 20} 40`}
            className="w-56 h-11 bg-white"
            shapeRendering="crispEdges"
            aria-label={`Barcode ${orderNumber}`}
          >
            <rect x={-10} y={0} width={barcodeBits.length + 20} height={40} fill="#ffffff" />
            {Array.from(barcodeBits).map((bit, idx) =>
              bit === '1' ? (
                <rect key={idx} x={idx} y={2} width={1} height={36} fill="#000000" />
              ) : null
            )}
          </svg>
          <span className="font-mono font-bold text-[11px] tracking-widest text-slate-900">
            {orderNumber}
          </span>
        </div>
      )}

      {qrMatrix && (
        <div className="flex flex-col items-center">
          <svg
            viewBox={`-2 -2 ${qrMatrix.size + 4} ${qrMatrix.size + 4}`}
            className="w-20 h-20 bg-white border border-slate-200 p-0.5 rounded"
            shapeRendering="crispEdges"
            aria-label={`QR Code ${orderNumber}`}
          >
            <rect x={-2} y={-2} width={qrMatrix.size + 4} height={qrMatrix.size + 4} fill="#ffffff" />
            {qrMatrix.cells.map(({ r, c }) => (
              <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#000000" />
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}

