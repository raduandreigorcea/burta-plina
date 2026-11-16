import type { ReactNode } from "react";

function Svg({ children, size = 16, className }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type P = { size?: number };

export const PinIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.900 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Svg>
);

export const SearchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.800-3.800" />
  </Svg>
);

export const TagIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 12.200V4a1 1 0 0 1 1-1h8.200a1 1 0 0 1 .700.300l7.800 7.800a1 1 0 0 1 0 1.400l-8.200 8.200a1 1 0 0 1-1.400 0l-7.800-7.800a1 1 0 0 1-.300-.700z" />
    <circle cx="7.500" cy="7.500" r="1.300" />
  </Svg>
);

export const AlertIcon = (p: P) => (
  <Svg {...p}>
    <path d="M10.300 3.900 2.500 17.500A2 2 0 0 0 4.200 20.500h15.600a2 2 0 0 0 1.700-3L13.700 3.900a2 2 0 0 0-3.400 0z" />
    <path d="M12 9v4.500" />
    <path d="M12 17h.010" />
  </Svg>
);

export const CloseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12" />
    <path d="M18 6 6 18" />
  </Svg>
);

export const TrophyIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
    <path d="M8 5H5v1.500A3 3 0 0 0 8 9.500" />
    <path d="M16 5h3v1.500a3 3 0 0 1-3 3" />
    <path d="M12 13v4" />
    <path d="M8.500 20h7" />
    <path d="M10 17h4v3h-4z" />
  </Svg>
);

export const ExternalIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Svg>
);

export const SpinnerIcon = (p: P) => (
  <Svg {...p} className="spin">
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Svg>
);

export const PlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Svg>
);

export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="m5 12.500 4.500 4.500L19 7.500" />
  </Svg>
);
