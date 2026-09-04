import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atlas Quality Partners",
  description: "Démonstration d'administration Atlas Quality Partners",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
