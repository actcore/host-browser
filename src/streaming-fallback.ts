/**
 * jco's transpiled output (and jco's own bindgen) load wasm via
 * `WebAssembly.compileStreaming(fetch(...))` / `instantiateStreaming`. Chrome's
 * strict MIME check rejects those for blob: URLs and for some dev-server setups
 * (Vite, etc.) where the response Content-Type isn't exactly `application/wasm`.
 * Wrap the streaming APIs with a fallback to the non-streaming variants, which
 * don't MIME-check.
 *
 * Lives in its own module because it must run in two realms: the page (see
 * host-api.ts) and the transpile Web Worker (see transpile.worker.ts), whose
 * bindgen `$init` compiles a ~9 MB core wasm and would otherwise fail in dev.
 *
 * Idempotent — installs at most once per realm.
 */
export function installCompileStreamingFallback(): void {
  const w = WebAssembly as unknown as {
    compileStreaming?: (source: Response | Promise<Response>) => Promise<WebAssembly.Module>;
    instantiateStreaming?: (
      source: Response | Promise<Response>,
      imports?: WebAssembly.Imports,
    ) => Promise<WebAssembly.WebAssemblyInstantiatedSource>;
    __actcoreStreamingPatched?: boolean;
  };
  if (w.__actcoreStreamingPatched) return;
  w.__actcoreStreamingPatched = true;

  const origCompile = w.compileStreaming?.bind(WebAssembly);
  if (origCompile) {
    w.compileStreaming = async function (source) {
      try {
        return await origCompile(source);
      } catch (err) {
        const msg = String((err as Error).message || err);
        if (!/MIME|Content-Type/i.test(msg)) throw err;
        const resp = source instanceof Response ? source : await source;
        return WebAssembly.compile(await resp.arrayBuffer());
      }
    };
  }

  const origInstantiate = w.instantiateStreaming?.bind(WebAssembly);
  if (origInstantiate) {
    w.instantiateStreaming = async function (source, imports) {
      try {
        return await origInstantiate(source, imports);
      } catch (err) {
        const msg = String((err as Error).message || err);
        if (!/MIME|Content-Type/i.test(msg)) throw err;
        const resp = source instanceof Response ? source : await source;
        const buf = await resp.arrayBuffer();
        return WebAssembly.instantiate(buf, imports);
      }
    };
  }
}
