import type { Metadata } from "next";
import "./globals.css";

const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:1430")
).replace(/\/$/, "");

const siteTitle = "Irori | Local-first AI companion desktop app with character cards";
const siteDescription =
  "Irori is an open-source, local-first desktop AI companion app with character cards, local memory, OpenAI-compatible model settings, and tool safety gates.";
const heroImage = "/assets/irori-character-hero.png";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "Irori",
  title: {
    default: siteTitle,
    template: "%s | Irori"
  },
  description: siteDescription,
  keywords: [
    "Irori",
    "local-first AI companion",
    "AI companion desktop app",
    "character card AI app",
    "local AI assistant",
    "OpenAI-compatible desktop client",
    "Tauri AI app",
    "AI角色卡",
    "本地AI陪伴应用"
  ],
  authors: [{ name: "Irori contributors", url: "https://github.com/hikariming/irori" }],
  creator: "Irori contributors",
  publisher: "Irori contributors",
  category: "technology",
  alternates: {
    canonical: "/"
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1
    }
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Irori",
    locale: "zh_CN",
    alternateLocale: ["en_US", "ja_JP", "ko_KR"],
    title: siteTitle,
    description: siteDescription,
    images: [
      {
        url: heroImage,
        width: 1200,
        height: 630,
        alt: "Irori local-first AI companion desktop app"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: [heroImage]
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
