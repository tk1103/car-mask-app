import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { site } from "../lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} | ${site.taglineJa}`,
    template: `%s | ${site.name}`,
  },
  description: site.descriptionJa,
  icons: {
    icon: [
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icon-192.png", type: "image/png", sizes: "192x192" }],
  },
  appleWebApp: { capable: true, title: site.name },
  openGraph: {
    type: "website",
    locale: "ja_JP",
    url: site.url,
    siteName: site.name,
    title: `${site.name} | ${site.taglineJa}`,
    description: site.descriptionJa,
  },
  twitter: {
    card: "summary_large_image",
    title: `${site.name} | ${site.taglineJa}`,
    description: site.descriptionJa,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
