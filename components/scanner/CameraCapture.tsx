"use client";

import * as React from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { FlipHorizontal2, ScanLine, CameraOff } from "lucide-react";

export function CameraCapture({
  onClose,
  onCaptured,
}: {
  onClose: () => void;
  onCaptured: (file: File) => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [facing, setFacing] = React.useState<"environment" | "user">(
    "environment",
  );
  const [error, setError] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);

  const stop = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const flipFacing = React.useCallback(() => {
    setError(null);
    setReady(false);
    setFacing((f) => (f === "user" ? "environment" : "user"));
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!window.isSecureContext) {
        setError(
          "Camera cần HTTPS. Hãy mở trang bằng https:// (VD: " + window.location.origin.replace(/^http:/, "https:") + ") và chấp nhận chứng chỉ, hoặc dùng tải ảnh.",
        );
        return;
      }
      if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
        window.setTimeout(() => {
          if (!cancelled) {
            setError("Đang yêu cầu quyền camera — nếu không có hộp thoại, trình duyệt bạn đang chặn. Hãy bật quyền camera hoặc dùng tải ảnh.");
          }
        }, 0);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1920 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        setReady(true);
      } catch {
        setReady(false);
        setError("Không thể truy cập camera — hãy cấp quyền camera/ảnh trong trình duyệt (biểu tượng khóa) rồi thử lại, hoặc dùng tải ảnh.");
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [facing, stop]);

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `scan-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        onCaptured(file);
      },
      "image/jpeg",
      0.9,
    );
  };

  return (
    <Sheet
      open={true}
      onClose={onClose}
      title="Chụp trang"
      className="sm:max-w-2xl"
      footer={
        <div className="flex items-center justify-between">
          <IconButton aria-label="Xoay camera" onClick={flipFacing}>
            <FlipHorizontal2 className="h-5 w-5" />
          </IconButton>

          <Button size="lg" className="min-w-28" onClick={capture} disabled={!ready}>
            <ScanLine className="h-5 w-5" />
            Chụp
          </Button>

          <span className="w-10" />
        </div>
      }
    >
      <div className="relative h-[58dvh] w-full bg-black">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <CameraOff className="h-8 w-8 text-muted-foreground" />
            <p className="max-w-xs text-sm text-muted-foreground">{error}</p>
          </div>
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="h-full w-full object-contain"
          />
        )}
        {!error && ready && (
          <div className="pointer-events-none absolute inset-0">
            <div className="scan-beam" />
          </div>
        )}
      </div>
    </Sheet>
  );
}
