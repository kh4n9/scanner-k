"use client";
// Bundled Tesseract.js OCR. The JS module is loaded on demand (see `ocrImage`)
// and language data is downloaded on first use (cacheable). The document image is
// always processed entirely on the device — nothing is uploaded.

/** Run OCR on an image URL/data-URL and return the extracted text.
 *  `langs` uses Tesseract codes (e.g. "eng+vie"). The worker is terminated
 *  after each call to release the heavy WASM memory. */
export async function ocrImage(src: string, langs = "eng+vie"): Promise<string> {
  // Imported here rather than at module scope: Tesseract is megabytes of JS plus
  // a WASM blob, and it is reached only through the "extract text" button. A
  // static import put it in the initial /scan bundle, so every user paid for it
  // on first load whether or not they ever ran OCR.
  const { default: Tesseract } = await import("tesseract.js");
  const worker = await Tesseract.createWorker(langs, Tesseract.OEM.LSTM_ONLY, { logger: () => {} });
  try {
    const { data } = await worker.recognize(src);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
