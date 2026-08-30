"use client";
// Bundled Tesseract.js OCR. The JS module is part of the app bundle; language
// data is downloaded on first use (cacheable). The document image is always
// processed entirely on the device — nothing is uploaded.
import Tesseract from "tesseract.js";

/** Run OCR on an image URL/data-URL and return the extracted text.
 *  `langs` uses Tesseract codes (e.g. "eng+vie"). The worker is terminated
 *  after each call to release the heavy WASM memory. */
export async function ocrImage(src: string, langs = "eng+vie"): Promise<string> {
  const worker = await Tesseract.createWorker(langs, Tesseract.OEM.LSTM_ONLY, { logger: () => {} });
  try {
    const { data } = await worker.recognize(src);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
