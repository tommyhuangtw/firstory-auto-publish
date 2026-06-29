import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_TC } from "next/font/google";
import "./globals.css";
import Navigation from "@/components/Navigation";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoSansTC = Noto_Sans_TC({
  variable: "--font-noto-tc",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "AI懶人報 Dashboard",
  description: "AI懶人報 — Podcast Automation Dashboard",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AI懶人報",
  },
  // Browser-tab favicon + apple-touch icon come from app/icon.png & app/apple-icon.png
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  // Let content extend into the iOS safe areas so env(safe-area-inset-*) is non-zero,
  // which the mobile bottom-nav uses to sit above the home indicator.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-TW"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansTC.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-zinc-950 text-zinc-100 flex flex-col">
        <Navigation />
        {/* main fills the viewport; on mobile, short pages center vertically (my-auto)
            so a short form isn't stranded at the top with a big void above the nav.
            my-auto is overflow-safe: when content is taller than the screen the margins
            collapse and the page scrolls normally from the top. Desktop is unaffected. */}
        <main className="flex-1 flex flex-col md:ml-56 pt-[env(safe-area-inset-top)] md:pt-0 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
          <div className="my-auto md:my-0 w-full">{children}</div>
        </main>
      </body>
    </html>
  );
}
