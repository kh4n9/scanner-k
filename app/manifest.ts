import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scanner-K — Quét tài liệu thành PDF",
    short_name: "Scanner-K",
    description:
      "Chụp hoặc tải ảnh trang giấy, nắn thẳng và xuất PDF ngay trên thiết bị. Không tải ảnh lên máy chủ.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0d10",
    theme_color: "#0b0d10",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
