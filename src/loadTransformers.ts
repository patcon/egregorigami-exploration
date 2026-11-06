/**
 * Lazy-load transformers.js with ONNX Runtime's WebAssembly loaded from jsDelivr,
 * pinned to the installed transformers.js version. The ~22 MB .wasm is never
 * bundled into our app (see the `drop-bundled-ort-wasm` plugin in vite.config.ts),
 * which keeps every deploy target well under static-asset size limits.
 */
export async function loadTransformers() {
  const transformers = await import('@huggingface/transformers')
  const wasm = transformers.env.backends.onnx.wasm
  if (wasm) wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${transformers.env.version}/dist/`
  return transformers
}
