import type { Metadata } from "next";
import { Sofia_Sans, Sofia_Sans_Extra_Condensed } from "next/font/google";
import "./globals.css";

// One family in two widths: the regular width for reading, the extra-condensed
// one for the title and the scale readouts.
const body = Sofia_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-body" });
const display = Sofia_Sans_Extra_Condensed({ subsets: ["latin", "latin-ext"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "Burta Plină",
  description: "Cea mai multă mâncare pentru bugetul tău, comparată între Wolt, Glovo și Bolt Food.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ro" className={`${body.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
