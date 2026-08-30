import type { Metadata } from "next";
import { PwaRegister } from "@/app/pwa-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scanner-K — Quét tài liệu thành PDF",
  description:
    "Chụp hoặc tải ảnh các trang giấy, cắt và gộp thành một file PDF ngay trên thiết bị. Không tải ảnh lên máy chủ.",
  applicationName: "Scanner-K",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Scanner-K",
  },
  icons: {
    icon: "/icon.svg",
  },
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
