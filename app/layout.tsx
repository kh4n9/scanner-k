import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/app/pwa-register";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

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
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="vi"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
