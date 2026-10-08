import type { Lang } from "../../app/i18n";
import "./illustrations.css";

/** Public files are fetched by the image element, never embedded in JavaScript. */
export function Illustration({
  group,
  name,
  alt,
  mirror = false,
  phone = false,
  lang,
  className = "",
}: {
  group: "rom" | "walk" | "landing";
  name: string;
  alt: string;
  mirror?: boolean;
  phone?: boolean;
  lang: Lang;
  className?: string;
}) {
  const base = `/illustrations/v7/${group}/${name}`;
  return (
    <picture className={`v7-illustration ${className}${mirror ? " is-mirrored" : ""}`}>
      {phone && (
        <source
          media="(width <= 640px)"
          srcSet={`${base}_phone_600.webp 600w, ${base}_phone.webp 1200w`}
          sizes="(width <= 640px) calc(100vw - 40px), 600px"
          width={1200}
          height={1500}
        />
      )}
      <img
        src={`${base}.webp`}
        srcSet={`${base}_600.webp 600w, ${base}.webp 1200w`}
        sizes="(width <= 640px) calc(100vw - 48px), 600px"
        width={1200}
        height={800}
        loading="lazy"
        decoding="async"
        alt={alt}
        role="img"
        lang={lang}
      />
    </picture>
  );
}
