/**
 * A QR code drawn on the device (UX spec 5.9 QrLinkProps, S55 visitor token, S50 register code): an
 * SVG image, ink modules on white with the 4 module quiet zone, crisp at any size. Nothing is fetched
 * to draw it. The accessible name is the given label (`alt`); a code never carries its link as text
 * unless a short link is given to print under it (S50).
 */
import { useMemo } from "react";
import { bidiText } from "../../../i18n/rich";
import { useCheckUi } from "../shared/CheckUi";
import { encodeQr, qrPath, type QrEcc } from "./qr";
import "./booth.css";

export interface QrCodeProps {
  text: string;
  /** The accessible name (UX spec: the QR alt). */
  label: string;
  /** CSS pixels (160 by default, 5.9). */
  size?: number;
  ecc?: QrEcc;
}

export function QrCode({ text, label, size = 160, ecc = "M" }: QrCodeProps) {
  const m = useMemo(() => encodeQr(text, ecc), [text, ecc]);
  const box = m.size + 8;
  return (
    <svg
      className="booth-qr-svg"
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${box} ${box}`}
      shapeRendering="crispEdges"
      data-qr-version={m.version}
    >
      <rect width={box} height={box} className="booth-qr-light" />
      <path d={qrPath(m)} className="booth-qr-dark" />
    </svg>
  );
}

export interface QrLinkProps {
  url: string;
  /** Printed under the code, so a person can type it (S50); never a booth token (S55). */
  shortUrl?: string;
  alt: string;
  size?: number;
}

/** A QR code with an optional short link under it (S50 register block). */
export function QrLink({ url, shortUrl, alt, size = 160 }: QrLinkProps) {
  const { lang } = useCheckUi();
  return (
    <figure className="booth-qr">
      <QrCode text={url} label={alt} size={size} />
      {shortUrl && (
        <figcaption className="check-meta" dir="ltr" lang="en">
          {bidiText(lang, shortUrl)}
        </figcaption>
      )}
    </figure>
  );
}
