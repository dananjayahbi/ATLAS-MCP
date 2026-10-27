import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "@/styles/globals.css";
import { AppShell } from "@/components/hud/app-shell";
import { Providers } from "./providers";

/** Doc 06 §2.1 — zero-JS shell: html/body, fonts, providers. */

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ATLAS Command Center",
  description: "Multi-agent orchestration HUD",
};

export const viewport: Viewport = {
  themeColor: "#030712",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh bg-canvas text-primary antialiased">
        <a
          href="#main-content"
          className="sr-only-focusable absolute top-1 left-1 z-[80] rounded-hud border border-flow bg-panel px-2 py-1 text-hud-label text-flow"
        >
          Skip to content
        </a>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
