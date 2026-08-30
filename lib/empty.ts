// Empty module referenced from `next.config.ts` via `turbopack.resolveAlias`.
// OpenCV.js (Emscripten) asks the bundler for Node native modules `fs`, `path`
// and `crypto`, which do not exist in the browser. Those code paths are only
// reached under Node and never run in the browser, so we point the browser
// bundle at this no-op module instead of failing the build.
export {};
