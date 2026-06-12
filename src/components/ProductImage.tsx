import { useState } from "react";
import { proxiedProductImageUrl } from "../lib/productImageUrl";

interface Props {
  url?: string;
  alt: string;
  className?: string;
}

export function ProductImage({ url, alt, className = "" }: Props) {
  const [failed, setFailed] = useState(false);
  const src = proxiedProductImageUrl(url);

  if (!src || failed) return null;

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
