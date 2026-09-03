import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Atlas Quality Partners",
  description: "Démonstration d'administration Atlas Quality Partners",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}
