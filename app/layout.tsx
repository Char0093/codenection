import type { Metadata, Viewport } from "next";
import { Fraunces, Public_Sans } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });
const publicSans = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "Waypoint - Trip Planner",
  description: "Shared trip planning with reviewed itinerary proposals.",
};

// viewportFit: "cover" lets the bottom tab bar (see .trip-nav in globals.css) draw under the
// home indicator on notched phones and pad itself out with env(safe-area-inset-bottom) instead
// of leaving a dead strip of browser chrome below it. No maximumScale here -- pinch-zoom stays
// available for anyone who needs it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#182544",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${publicSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
