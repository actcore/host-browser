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

`jco` and `preview2-shim` are runtime dependencies; bundle them with your app or load via importmap.

## Quick start

```ts
import { runComponent } from '@actcore/host';

const wasm = new Uint8Array(await (await fetch('/time.wasm')).arrayBuffer());

const { toolProvider } = await runComponent(wasm, {
  // Where the @bytecodealliance/preview2-shim browser files live. Use a CDN,
  // your bundler's resolved path, or your dev-server alias.
  shimBase: 'https://esm.sh/@bytecodealliance/preview2-shim@0.17.0/lib/browser/',
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

See [`examples/basic.html`](examples/basic.html) for a runnable demo. Build once with `npm run build`, then `npm run example` and open `http://localhost:8765/basic.html`.

## How it works

`runComponent(bytes, options)`:

1. Calls `@bytecodealliance/jco/component`'s in-browser `transpile()` (~250ms for a 1MB component) with `asyncMode: jspi` and an explicit `map` pointing WASI specifiers at `preview2-shim` browser builds.
2. Patches the resulting JS to:
   - declare missing `STREAM_TABLES` / `FUTURE_TABLES` (jco 1.19 references them without declaring),
   - rewrite remaining bare specifiers to absolute URLs (blob: contexts can't see the page's importmap),
   - bypass `_liftFlatRecord` for `list-tools` and `call-tool` task-return, walking the wasip3-async flat-fields representation directly out of linear memory.
3. Materialises the patched JS + `.core.wasm` as blob URLs, dynamic-imports the entry module, and wraps the exported `toolProvider` so callers don't have to think about the lift dispatch.

The patches are stop-gaps for upstream jco issues; once they're fixed there, this package shrinks to a thin glue layer.

## Roadmap

- v0.2 — OCI pull and Sigstore (cosign) signature verification, via a shared `act-oci-verify` Rust crate compiled to both native (for `act-cli`) and `wasm32-wasip2` (loaded here, hash-pinned in source).
- v0.2 — Streaming tool results (`ToolResult::streaming`).
- v0.x — `act:sessions/session-provider` support.
- v0.x — Web Worker isolation (run components off the main thread).

## License

MIT OR Apache-2.0
