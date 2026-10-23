import Link from "next/link";
import { ArrowRight, ScanLine } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

/*
 * The hero is a scanner bed. A dark plate, a white sheet lying on it, and the
 * lamp sweeping across — the app's one motion, used here and nowhere else on
 * this screen. The three facts below are the whole value proposition, so they
 * are written as commitments rather than feature names.
 */
const FACTS = [
  {
    k: "Kín",
    label: "Ảnh không rời thiết bị",
    body: "Mọi bước xử lý chạy trong trình duyệt. Không máy chủ, không tài khoản.",
  },
  {
    k: "Thẳng",
    label: "Cắt và nắn mép giấy",
    body: "Dò mép, uốn thẳng trang cong, làm trắng nền như máy quét thật.",
  },
  {
    k: "Gọn",
    label: "Một file PDF đúng khổ",
    body: "Gộp toàn bộ trang thành A4 hoặc Letter, xuất PDF, PNG hay JPG.",
  },
];

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-12 sm:px-6">
      <div className="w-full max-w-3xl">
        <p className="mb-6 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
          <ScanLine className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          Scanner-K
        </p>

        <h1 className="max-w-2xl text-[clamp(2rem,6vw,3.4rem)] font-semibold leading-[1.05] tracking-[-0.02em]">
          Giấy tờ của bạn,
          <br />
          <span className="text-primary">thành PDF</span> ngay trên máy.
        </h1>

        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Chụp hoặc tải ảnh từng trang, cắt đúng mép giấy, rồi gộp thành một file
          PDF sắc nét — ngay trên chiếc điện thoại bạn đang cầm.
        </p>

        <div className="mt-8">
          <Link href="/scan" className={buttonClasses({ size: "lg", className: "pr-6" })}>
            Bắt đầu quét
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        {/* The scanner bed: a white sheet, the lamp passing under the glass. */}
        <div className="bed relative mt-12 h-40 overflow-hidden rounded-2xl border border-border sm:h-48">
          <div className="sweep" aria-hidden="true" />
          <div
            className="absolute inset-0 flex items-center justify-center"
            aria-hidden="true"
          >
            {/* A stand-in for a document, not a real page: it is cut off by the
                bed on purpose, so it reads as "a sheet in the scanner" rather
                than as a picture of a sheet. One sheet, because a scanner
                holds one at a time. */}
            <div className="paper-shadow h-[150%] w-[52%] translate-y-[14%] rounded-sm bg-paper sm:w-[36%]">
              <div className="flex h-full flex-col gap-[7px] p-6 pt-8 opacity-[0.18] sm:gap-[9px] sm:p-8">
                <div className="h-2 w-2/5 rounded-full bg-black" />
                <div className="mt-3 h-1 w-full rounded-full bg-black" />
                <div className="h-1 w-11/12 rounded-full bg-black" />
                <div className="h-1 w-full rounded-full bg-black" />
                <div className="h-1 w-8/12 rounded-full bg-black" />
                <div className="mt-3 h-1 w-full rounded-full bg-black" />
                <div className="h-1 w-10/12 rounded-full bg-black" />
                <div className="h-1 w-full rounded-full bg-black" />
                <div className="h-1 w-9/12 rounded-full bg-black" />
              </div>
            </div>
          </div>
        </div>

        <dl className="mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-3">
          {FACTS.map((f) => (
            <div key={f.k} className="border-t border-border pt-3">
              <dt className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] uppercase tracking-widest text-primary">
                  {f.k}
                </span>
                <span className="text-sm font-semibold">{f.label}</span>
              </dt>
              <dd className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                {f.body}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </main>
  );
}
