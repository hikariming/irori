import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:1430");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Irori",
  description:
    "Irori is a local-first desktop companion app with character cards, local memory, model presets, and tool safety.",
  openGraph: {
    title: "Irori",
    description: "Local-first character companions for thinking, writing, coding, and planning.",
    images: ["/assets/irori-character-hero.png"]
  },
  icons: {
    icon: "/assets/irori-logo.png"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
