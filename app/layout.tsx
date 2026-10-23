import type { Metadata, Viewport } from "next";
import { Anek_Latin, JetBrains_Mono } from "next/font/google";
import { PwaRegister } from "@/app/pwa-register";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

// Anek Latin is Vietnamese-native, which matters because diacritics carry most
// of this interface's words. JetBrains Mono is only ever used for measurements
// (page counts, DPI, mm, file sizes) where tabular alignment does real work.
const anek = Anek_Latin({
  subsets: ["latin", "vietnamese"],
  variable: "--font-anek",
  display: "swap",
});

const monoData = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-data",
  display: "swap",
});

const title = "Scanner-K — Quét tài liệu thành PDF";
const description =
  "Chụp hoặc tải ảnh các trang giấy, cắt và gộp thành một file PDF ngay trên thiết bị. Không tải ảnh lên máy chủ.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: "%s · Scanner-K",
  },
  description,
  applicationName: "Scanner-K",
  keywords: [
    "quét tài liệu",
    "scan tài liệu",
    "PDF",
    "OCR",
    "scanner online",
    "chuyển ảnh sang PDF",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "vi_VN",
    url: "/",
    siteName: "Scanner-K",
    title,
    description,
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Scanner-K",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // iOS ignores SVG home-screen icons, so it gets a raster one.
    apple: "/apple-icon.png",
  },
  robots: {
    index: true,
    follow: true,
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the layout reach under the notch/home indicator so the fixed bottom
  // bar can pad itself with env(safe-area-inset-bottom) instead of floating.
  viewportFit: "cover",
  colorScheme: "dark light",
  // These must match --background in globals.css, otherwise the browser chrome
  // on iOS paints a different black from the page beneath it.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0c0f" },
    { media: "(prefers-color-scheme: light)", color: "#f7f8f6" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="vi"
      className={`h-full antialiased ${anek.variable} ${monoData.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
