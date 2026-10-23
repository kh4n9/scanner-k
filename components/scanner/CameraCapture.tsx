"use client";

import * as React from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  CameraOff,
  Check,
  FlipHorizontal2,
  Loader2,
  ScanLine,
} from "lucide-react";

/**
 * The viewfinder.
 *
 * The sweep marks the scan band across the live preview — the second and last
 * place it is used in the app, because here it is literally the thing moving
 * under the glass. A real scan needs the page to sit inside the band, so the
 * band is drawn as a frame rather than a full-bleed wash.
 */
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
  const [flash, setFlash] = React.useState(false);
  const [capturing, setCapturing] = React.useState(false);

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
          "Camera cần HTTPS. Hãy mở trang bằng https:// (VD: " +
            window.location.origin.replace(/^http:/, "https:") +
            ") và chấp nhận chứng chỉ, hoặc dùng chọn ảnh.",
        );
        return;
      }
      if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
        window.setTimeout(() => {
          if (!cancelled) {
            setError(
              "Đang yêu cầu quyền camera — nếu không có hộp thoại, trình duyệt bạn đang chặn. Hãy bật quyền camera hoặc chọn ảnh có sẵn.",
            );
          }
        }, 0);
        return;
      }
      try {
        // Ask for 4K: the stream is a *preference* (the browser falls back to
        // whatever the device supports), but on phones that can do it this
        // doubles the linear resolution of the fallback frame capture. The
        // still-photo path in `capture` is even higher when available.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
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
        setError(
          "Không thể truy cập camera — hãy cấp quyền camera trong trình duyệt (biểu tượng khoá) rồi thử lại, hoặc chọn ảnh có sẵn.",
        );
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [facing, stop]);

  const pulseFlash = () => {
    setFlash(true);
    setTimeout(() => setFlash(false), 600);
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || capturing) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    setCapturing(true);
    try {
      // Prefer a real still photo: the video stream is capped at 1080p on most
      // phones, while takePhoto() can return the sensor's full resolution.
      // That extra pixel detail is what keeps small print crisp in the export;
      // the frame path below is the fallback where takePhoto is unsupported.
      const track = streamRef.current?.getVideoTracks()[0];
      const ImageCaptureCtor = (
        window as Window & {
          ImageCapture?: new (t: MediaStreamTrack) => {
            takePhoto: () => Promise<Blob>;
          };
        }
      ).ImageCapture;
      if (track && ImageCaptureCtor) {
        try {
          const blob = await new ImageCaptureCtor(track).takePhoto();
          if (blob && blob.size > 0) {
            const type = blob.type || "image/jpeg";
            const ext = type === "image/png" ? "png" : "jpg";
            pulseFlash();
            onCaptured(new File([blob], `scan-${Date.now()}.${ext}`, { type }));
            return;
          }
        } catch {
          // takePhoto is unavailable for this track — fall through to a frame.
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(video, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92),
      );
      if (blob) {
        pulseFlash();
        onCaptured(
          new File([blob], `scan-${Date.now()}.jpg`, { type: "image/jpeg" }),
        );
      }
    } finally {
      setCapturing(false);
    }
  };

  return (
    <Sheet
      open={true}
      onClose={onClose}
      title="Chụp trang"
      description="Đặt trang giấy trong khung, giữ máy thẳng và đủ sáng."
      className="sm:max-w-2xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          <IconButton aria-label="Đổi camera trước/sau" onClick={flipFacing}>
            <FlipHorizontal2 className="h-5 w-5" />
          </IconButton>

          <Button
            size="lg"
            className="min-w-32"
            onClick={capture}
            disabled={!ready || capturing}
          >
            {capturing ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ScanLine className="h-5 w-5" />
            )}
            {capturing ? "Đang chụp…" : "Chụp"}
          </Button>

          <span className="w-10" aria-hidden="true" />
        </div>
      }
    >
      <div className="bed relative h-[58dvh] w-full">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <CameraOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              {error}
            </p>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              aria-label="Khung hình camera"
              className="h-full w-full object-contain"
            />
            {ready && (
              <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                {/* The scan band: the sweep travels inside the frame only. */}
                <div className="sweep" />
                <div className="absolute inset-5 rounded-lg border border-white/25" />
              </div>
            )}
          </>
        )}
        {flash && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/40">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl">
              <Check className="h-8 w-8" />
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
