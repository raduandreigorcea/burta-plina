"use client";

import { useState } from "react";
import type { Chain } from "@/lib/chains";
import type { PlatformId } from "@/lib/types";

/**
 * A chain's logo: public/logos/<slug>.svg (or .png) when the file is there,
 * otherwise a monogram in the chain's colours.
 */
export function ChainBadge({ chain, size = 28 }: { chain: Chain; size?: number }) {
  const [ext, setExt] = useState<"svg" | "png" | null>("svg");
  const box = { width: size, height: size };
  if (ext) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="badge logo"
        style={box}
        src={`/logos/${chain.slug}.${ext}`}
        alt=""
        onError={() => setExt(ext === "svg" ? "png" : null)}
      />
    );
  }
  return (
    <span
      className="badge mono"
      style={{ ...box, background: chain.bg, color: chain.fg, fontSize: size * (chain.short.length > 2 ? 0.34 : 0.46) }}
      aria-hidden="true"
    >
      {chain.short}
    </span>
  );
}

const PLATFORMS: Record<PlatformId, { bg: string; fg: string; letter: string }> = {
  wolt: { bg: "#009DE0", fg: "#FFFFFF", letter: "W" },
  glovo: { bg: "#FFC244", fg: "#1F2A22", letter: "G" },
  bolt: { bg: "#34D186", fg: "#10241A", letter: "B" },
};

/** The delivery app as a round mark in its own colour. */
export function PlatformBadge({ platform, size = 22 }: { platform: PlatformId; size?: number }) {
  const p = PLATFORMS[platform];
  return (
    <span className="badge round" style={{ width: size, height: size, background: p.bg, color: p.fg, fontSize: size * 0.55 }} aria-hidden="true">
      {p.letter}
    </span>
  );
}
