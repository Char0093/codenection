import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Waypoint - Trip Planner",
  description: "Shared trip planning with reviewed itinerary proposals.",
};

// viewportFit: "cover" lets the bottom tab bar (see .trip-nav in globals.css) draw under the
// home indicator on notched phones and pad itself out with env(safe-area-inset-bottom) instead
// of leaving a dead strip of browser chrome below it. No maximumScale here -- pinch-zoom stays
// available for anyone who needs it.
//
// themeColor is given per colour scheme so the browser chrome matches the canvas token on both
// sides: systemGroupedBackground in light, true black in dark.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

/**
 * Applies the saved theme before first paint.
 *
 * The toggle persists "light" | "dark" and writes it to <html data-theme>. Without this
 * inline script the document would paint with the OS preference first and then snap to the
 * saved override once React hydrated -- a visible flash on every navigation. Deliberately
 * synchronous and dependency-free so it runs ahead of any stylesheet-driven paint. "system"
 * (or no stored value) leaves the attribute off, which is what lets the prefers-color-scheme
 * media query in globals.css take over.
 */
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem("waypoint-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
