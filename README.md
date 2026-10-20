# Scanner-K

Quét tài liệu thành PDF, chạy hoàn toàn trong trình duyệt. Ảnh không bao giờ rời
khỏi thiết bị — không có máy chủ, không có tài khoản, không có upload.

Chụp hoặc tải ảnh các trang giấy → tự dò viền và nắn phẳng phối cảnh → cắt, xoay,
lọc, tăng độ nét → gộp thành một file PDF (hoặc PNG/JPG/ZIP) đúng khổ A4/Letter.

## Chạy

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

Các script khác:

| Script | Việc |
| --- | --- |
| `pnpm dev:lan` | dev server mở trên `0.0.0.0` (test từ điện thoại trong LAN) |
| `pnpm dev:https` | dev server HTTPS tự ký — **cần cho camera**, xem bên dưới |
| `pnpm build` / `pnpm start` | bản production |
| `pnpm lint` | ESLint |

### Camera cần HTTPS

`getUserMedia` chỉ hoạt động trong secure context. `http://localhost` được tính là
secure, nhưng `http://192.168.x.x` thì không, nên mở từ điện thoại qua LAN sẽ bị
chặn camera. Dùng:

```bash
pnpm dev:https
# mở https://<ip-lan>:3000 trên điện thoại và chấp nhận chứng chỉ tự ký
```

Nếu địa chỉ máy dev không phải `localhost`, thêm nó vào danh sách được phép (nếu
không Next sẽ từ chối request):

```bash
DEV_ALLOWED_ORIGINS=192.168.1.20 pnpm dev:https
```

Không có camera vẫn dùng được app — nút "Tải ảnh" hoạt động bình thường.

## Kiến trúc

```
app/
  page.tsx            trang giới thiệu
  scan/page.tsx       chỉ mount <Scanner />
  layout.tsx          metadata + đăng ký service worker
  manifest.ts         PWA manifest
  pwa-register.tsx    đăng ký service worker (client)
components/scanner/
  Scanner.tsx         state tài liệu, autosave, chuyển/xoá tài liệu
  PageEditor.tsx      kéo 4 góc, khổ giấy, xoay, lọc, độ nét, dewarp
  PagePreview.tsx     một trang vẽ đúng tỉ lệ giấy (dùng chung grid/editor/preview)
  PagesGrid.tsx       danh sách trang
  PreviewSheet.tsx    xem trước cả tài liệu
  ExportSheet.tsx     xuất PDF/PNG/JPG/ZIP + OCR + chia sẻ/lưu
  CameraCapture.tsx   camera sau, ưu tiên takePhoto() để lấy độ phân giải cao
  AddSourcePad.tsx    chọn nguồn ảnh
  PaperBulkControl.tsx  đặt một khổ giấy cho mọi trang
components/ui/        button, icon-button, sheet
lib/
  image.ts            warp + filter trên canvas, cache ảnh đã decode, loadImage
  image-pixels.ts     toán học pixel thuần (sampler, mesh warp, filter) — không DOM
  opencv.ts           dò viền bằng OpenCV.js (tải theo yêu cầu)
  ocr.ts              OCR bằng Tesseract.js (tải theo yêu cầu)
  pdf.ts              dựng PDF bằng pdf-lib
  export.ts           PDF / PNG / JPG / ZIP, tải về, chia sẻ, lưu file
  zip.ts              ZIP writer "store" tối giản (tên file UTF-8)
  db.ts               IndexedDB, giữ tài liệu qua reload (schema v2)
  render-queue.ts     giới hạn số render đồng thời (chống tràn RAM trên iOS)
  paper.ts            khổ giấy, nhãn, trạng thái "hỗn hợp"
  types.ts            kiểu dữ liệu + hằng số dùng chung
  service-worker.js   cache offline
```

### Vài quyết định đáng biết

**Mọi thứ ở lại trên thiết bị.** IndexedDB giữ ảnh gốc (đã downscale), tính toán
chạy trên canvas/pixel buffer. Không có endpoint nào nhận ảnh.

**OpenCV và Tesseract tải theo yêu cầu.** Cả hai nặng vài MB đến vài chục MB, và
mỗi cái chỉ phục vụ một nút bấm. Chúng được `import()` bên trong hàm dùng chúng,
không import tĩnh — đổi lại thành import tĩnh là bundle khởi đầu của `/scan` phình
lên hàng chục MB.

**Render bị giới hạn số lượng.** Mỗi render giữ vài chục MB buffer không hiện trong
JS heap. `render-queue.ts` chặn ở 2 render đồng thời; `PagePreview` chỉ render
trang gần khung nhìn. Đừng bỏ hai thứ này.

**Warp chạy trên main thread.** Từng có bản chạy trong Web Worker, nhưng Turbopack
không compile `new Worker(new URL("./*.ts", import.meta.url))` — nó emit file
nguồn thành asset tĩnh (`video/mp2t`), worker không bao giờ khởi động và mọi
render lặng lẽ rơi về main thread. Nếu muốn đưa lại off-thread, phải kiểm tra
chunk emit ra đúng là JavaScript trước khi tin nó.

## Giới hạn đã biết

- Chưa có undo. Autosave ghi ngay sau mỗi thay đổi.
- Autosave ghi lại **toàn bộ** tài liệu mỗi lần sửa; tài liệu vài chục trang sẽ
  thấy độ trễ khi kéo slider.
- `takePhoto()` không có trên Safari/iOS, nên ảnh chụp từ iPhone lấy từ frame
  video (thường 1080p) — kém nét hơn ảnh từ Chrome Android.
- Không có test tự động.
