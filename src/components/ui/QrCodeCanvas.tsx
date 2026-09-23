'use client';

import { useEffect, useRef } from 'react';

/**
 * QrCodeCanvas — renders a QR payload string entirely in-browser
 * (canvas, no financial data sent to third parties).
 */
export function QrCodeCanvas({ payload, size = 240 }: { payload: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!payload || !canvasRef.current) return;
    import('qrcode').then((QRCode) => {
      if (!canvasRef.current) return;
      QRCode.toCanvas(canvasRef.current, payload, {
        width: size,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      }).catch(() => {/* render error handled by blank canvas */});
    }).catch(() => {/* module load error — canvas stays blank */});
  }, [payload, size]);

  return (
    <div className="p-3 bg-white rounded-xl inline-block shadow-lg">
      <canvas ref={canvasRef} width={size} height={size} />
    </div>
  );
}
