"use client";

import Link from "next/link";

import { useBranding } from "@/components/layout/branding-provider";
import { cn } from "@/lib/cn";

type BrandProps = {
  className?: string;
  compact?: boolean;
  href?: string;
  labelClassName?: string;
};

export function Brand({
  className = "",
  compact = false,
  href = "/",
  labelClassName = "",
}: BrandProps) {
  const { logoUrl, productName } = useBranding();

  // An install's own logo stands in for the mark and the name. The link
  // still carries the name, for people who cannot see the picture.
  if (logoUrl) {
    return (
      <Link
        aria-label={productName}
        className={cn("inline-flex min-w-0 items-center", className)}
        href={href}
      >
        <BrandLogo compact={compact} src={logoUrl} />
      </Link>
    );
  }

  return (
    <Link
      aria-label={productName}
      className={cn(
        "inline-flex min-w-0 items-center gap-2.5 text-(--fg)",
        className,
      )}
      href={href}
    >
      <BrandMark />
      {!compact ? (
        <span
          className={cn(
            "max-w-[52vw] truncate text-[1.125rem] font-extrabold tracking-[-0.02em] sm:max-w-[22rem] sm:text-[1.1875rem]",
            labelClassName,
          )}
        >
          {productName}
        </span>
      ) : null}
    </Link>
  );
}

/** The install's own logo, kept to the height of the header. */
export function BrandLogo({
  className = "",
  compact = false,
  src,
}: {
  className?: string;
  compact?: boolean;
  src: string;
}) {
  return (
    // Served by this site at an address that changes with the image:
    // next/image would only add a second copy to keep in step.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      className={cn(
        "block h-8 w-auto object-contain object-left",
        compact ? "max-w-10" : "max-w-[44vw] sm:max-w-44",
        className,
      )}
      decoding="async"
      src={src}
    />
  );
}

/** The Open Controls mark. The surrounding link carries the product name. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    // The same vector is used for the browser tab icon.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      aria-hidden="true"
      className={cn("size-7 shrink-0 dark:invert", className)}
      height={28}
      src="/icon.svg"
      width={28}
    />
  );
}
