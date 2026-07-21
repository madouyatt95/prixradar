import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.SITE_URL ??
  "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "PrixRadar",
    template: "%s · PrixRadar",
  },
  description:
    "Radar mobile-first d’anomalies de prix, avec vérification et historique Keepa pour Amazon FR, DE, IT, ES et UK.",
  applicationName: "PrixRadar",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PrixRadar",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png", sizes: "64x64" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "PrixRadar",
    title: "PrixRadar — Repérez l’inhabituel. Vérifiez avant d’acheter.",
    description:
      "Un radar clair pour les anomalies de prix en France et sur Amazon Europe.",
    images: [
      {
        url: new URL("/og-v2.png", siteUrl).toString(),
        width: 1536,
        height: 1024,
        alt: "PrixRadar, repérez l’inhabituel et vérifiez avant d’acheter",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PrixRadar — Les anomalies de prix, vérifiées",
    description:
      "Un radar clair pour les anomalies de prix en France et sur Amazon Europe.",
    images: [new URL("/og-v2.png", siteUrl).toString()],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f5f1e8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
