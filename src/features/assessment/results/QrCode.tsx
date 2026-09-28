/**
 * A QR code drawn on the device (UX spec S50, 5.9 QrLinkProps): 160 px, ink modules on the card
 * colour with a four module quiet zone, role img with its alt text. The short address is printed
 * next to it by the caller for people who cannot scan.
 */
import { useMemo } from "react";
import { encodeQr } from "./qr";

export function qrPath(modules: readonly (readonly boolean[])[], quiet = 4): string {
  let d = "";
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }),
  );
  return d;
}

export function QrCode({ text, label, size = 160 }: { text: string; label: string; size?: number }) {
  const qr = useMemo(() => encodeQr(text), [text]);
  if (!qr) return null;
  const quiet = 4;
  const n = qr.size + quiet * 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      data-qr={text}
    >
      <rect className="rs-qr-light" x="0" y="0" width={n} height={n} />
      <path className="rs-qr-dark" d={qrPath(qr.modules, quiet)} />
    </svg>
  );
}
