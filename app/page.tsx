import Link from "next/link";
import { ArrowRight, ScanLine, ShieldCheck, FileCheck2, Crop } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-[calc(100dvh-0px)] flex-col items-center justify-center px-6 py-16">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-card px-8 py-14 text-center">
        <div className="scan-beam" aria-hidden="true" />

        {/* Content sits above the beam so the line never crosses the text. */}
        <div className="relative z-10">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <ScanLine className="h-8 w-8" aria-hidden="true" />
          </div>

          <p className="mb-3 text-xs font-medium uppercase tracking-[0.25em] text-primary">
            Scanner-K
          </p>
          <h1 className="mx-auto max-w-xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Quét tài liệu,
            <br />
            xuất PDF ngay trên thiết bị.
          </h1>
          <p className="mx-auto mt-4 max-w-md text-base text-muted-foreground">
            Chụp hoặc tải ảnh các trang giấy, cắt và nâng cao chất lượng, rồi gộp
            thành một file PDF. Mọi thứ diễn ra trong trình duyệt — không tải lên
            máy chủ.
          </p>

          <div className="mt-8">
            <Link
              href="/scan"
              className={buttonClasses({ size: "lg", className: "px-8" })}
            >
              Bắt đầu quét
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          <div className="mt-12 grid gap-6 text-left sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold">Quyền riêng tư</h3>
              <p className="text-xs text-muted-foreground">
                Ảnh không bao giờ rời khỏi thiết bị của bạn.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Crop className="h-5 w-5 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold">Cắt &amp; nâng cao</h3>
              <p className="text-xs text-muted-foreground">
                Xoay, cắt và chọn bộ lọc như máy quét thật.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <FileCheck2 className="h-5 w-5 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold">PDF đúng khổ</h3>
              <p className="text-xs text-muted-foreground">
                Gộp nhiều trang thành một file A4 hoặc Letter.
              </p>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Chạy 100% trong trình duyệt · Không cần tài khoản
      </p>
    </main>
  );
}
