# @actcore/host

> Browser host for [ACT](https://actcore.dev) — runs signed wasm agent tools in a browser tab.

The whole agent stack, no server:

| | Where it lives |
|---|---|
| LLM | wherever you want — remote API, or local via [WebLLM](https://github.com/mlc-ai/web-llm) |
| **Tools** | **the browser, via this package** |
| User data | the browser (IndexedDB, OPFS) |

ACT components are sandboxed wasm modules signed by their author and distributed via OCI registries. This package loads one in a browser tab using [jco](https://github.com/bytecodealliance/jco)'s in-browser transpiler — no server, no Node, no `npm install` required for the *tool*. The end user opens a page; the tool runs in their tab.

## Status

Experimental (`0.1.0-alpha`). The runtime works end-to-end for `act:tools/tool-provider@0.1.0`. Streaming results, OCI pull, and Sigstore verification are scheduled for follow-up versions.

## Browser support

Requires [JSPI (JavaScript Promise Integration)](https://github.com/WebAssembly/js-promise-integration) for WebAssembly:

| Browser | JSPI status (2026-05) | Source |
|---|---|---|
| Chrome 137+ stable / Edge | **shipped by default** | [Interop 2026 #10](https://webkit.org/blog/17818/announcing-interop-2026/) |
| Firefox Nightly 152+ | 93% WPT pass rate | [wpt.fyi](https://wpt.fyi/results/wasm/jsapi/jspi?label=master&label=experimental&aligned&view=interop&q=label%3Ainterop-2026-jspi-for-wasm) |
| Safari Tech Preview 243+ | 93% WPT pass rate | wpt.fyi |
| Firefox stable / Safari stable | shipping during 2026 per [Interop 2026 pledge](https://webkit.org/blog/17818/announcing-interop-2026/) | — |

All four major browsers committed to JSPI parity in Interop 2026.

## Install

```sh
npm install @actcore/host @bytecodealliance/jco @bytecodealliance/preview2-shim
```

`jco` (which pulls in `@bytecodealliance/jco-transpile`) and `preview2-shim` are
runtime dependencies; bundle them with your app or load via importmap.

> **jco 1.24 browser note.** jco 1.24's documented browser entry
> (`@bytecodealliance/jco/component`) is broken in the published package — the
> `obj/` glue it imports is gitignored out of the tarball — and
> `@bytecodealliance/jco-transpile`'s `.` export statically imports node:
> builtins, so it can't load under native ESM. This package therefore drives the
> one browser-safe artifact jco ships: the vendored, componentized bindgen at
> `@bytecodealliance/jco-transpile/vendor/js-component-bindgen-component.js`
> (the same `generate()` jco's browser entry wraps). That subpath is not in
> jco-transpile's `exports` map, so map it explicitly in your importmap (see
> [`examples/basic.html`](examples/basic.html)) or add a bundler resolve alias.

## Quick start

```ts
import { runComponent } from '@actcore/host';

const wasm = new Uint8Array(await (await fetch('/time.wasm')).arrayBuffer());

const { toolProvider } = await runComponent(wasm, {
  // Where the @bytecodealliance/preview2-shim browser files live. Use a CDN,
  // your bundler's resolved path, or your dev-server alias. preview2-shim 0.19
  // serves its browser build from dist/browser/ (it was lib/browser/ before).
  shimBase: 'https://esm.sh/@bytecodealliance/preview2-shim@0.19.0/dist/browser/',
});

const { tools } = await toolProvider.listTools([]);
console.log(tools); // [{ name: 'get_current_time', description: ..., parametersSchema: ... }]

const result = await toolProvider.callTool(
  'get_current_time',
  new Uint8Array([0xa0]),  // CBOR {} — empty args
  [],
);

if (result.tag === 'immediate') {
  for (const ev of result.val) {
    if (ev.tag === 'content') {
      console.log(new TextDecoder().decode(ev.val.data));  // → "2026-05-11T15:13:23.464+00:00"
    }
  }
}
```

See [`examples/basic.html`](examples/basic.html) for a runnable demo. From a fresh
clone, `npm run sync-wit` once to fetch the WIT deps (via [`wkg`](https://github.com/bytecodealliance/wasm-pkg-tools); see [`wit/README.md`](wit/README.md)), then `npm run build`. Run the demo with `npm run example` (serves the package root so the importmap's `/node_modules/…` paths resolve) and open `http://localhost:8765/examples/basic.html`.

## How it works

`runComponent(bytes, options)`:

1. Calls jco's low-level bindgen `generate()` (~250ms for a 1MB component) with `asyncMode: jspi` and an explicit `map` pointing WASI specifiers at `preview2-shim` browser builds (and `wasi:http` p3 at the bundled shim). Driving `generate()` directly — rather than `transpileBytes` — keeps the transpiler node-free and lets us own the WASI map, sidestepping jco 1.24's default map that routes p3 WASI onto the Node-only `preview3-shim`.
2. Applies a thin patch to the emitted JS:
   - rewrite bare `preview2-shim` specifiers to absolute URLs (blob: contexts can't see the page's importmap),
   - short-circuit future/stream drops whose wasm-side end was already transferred (a wit-bindgen Rust quirk on the wasi:http path).
3. Materialises the patched JS + `.core.wasm` as blob URLs, dynamic-imports the entry module, and returns the exported `toolProvider`.

The wasip3-async lift bugs that needed heavy patching under jco 1.19 (STREAM_TABLES/FUTURE_TABLES declarations, `HostFuture`, host-resource lowering, `_liftFlatRecord` task-return, storageLen accounting) are all fixed upstream as of jco 1.24 (bindgen 2.0.3) — jco lifts `list-tools` / `call-tool` results natively. This package is now a thin glue layer.

## Roadmap

- v0.2 — OCI pull and Sigstore (cosign) signature verification, via a shared `act-oci-verify` Rust crate compiled to both native (for `act-cli`) and `wasm32-wasip2` (loaded here, hash-pinned in source).
- v0.2 — Streaming tool results (`ToolResult::streaming`).
- v0.x — `act:sessions/session-provider` support.
- v0.x — Web Worker isolation (run components off the main thread).

## License

MIT OR Apache-2.0
