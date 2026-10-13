// One shared limit on how many page renders may be in flight at once.
//
// Every render holds a full-resolution decoded source, a source canvas and an
// ImageData copy of the whole source — on the order of 15-20 MB each, and none of
// it shows up in the JS heap. Rendering every page at once is fine for a handful
// of pages and fatal past a couple of dozen: a 53-page document put ~100 renders
// in flight (the grid and the document preview each render every page), which
// killed the tab on iOS — in both Chrome and Safari, since both are WebKit there.
// The tab reloaded, restored the document, rendered everything again, and could
// never finish loading.
//
// With the limit, peak memory no longer depends on how long the document is. The
// cost is that a long document renders in waves instead of all at once, which
// only matters for pages nobody is looking at.
const MAX_CONCURRENT_RENDERS = 2;

let active = 0;
const waiting: Array<() => void> = [];

/** Run `work` once fewer than MAX_CONCURRENT_RENDERS renders are in flight. */
export async function withRenderSlot<T>(work: () => Promise<T>): Promise<T> {
  while (active >= MAX_CONCURRENT_RENDERS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
  try {
    return await work();
  } finally {
    active--;
    waiting.shift()?.();
  }
}
