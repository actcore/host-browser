import { applyPatches, rewriteBareImports } from './patches.js';
import type { RunComponentOptions } from './host-api.js';

// The in-browser transpiler. jco 1.24.x moved transpile logic into the
// `@bytecodealliance/jco-transpile` package, whose high-level `transpileBytes`
// statically imports node: builtins (node:child_process / node:os / node:fs)
// and `terser`, so it cannot load under native ESM in a browser. jco's own
// `@bytecodealliance/jco/component` browser entry is also unusable in 1.24.3:
// it imports an `obj/` glue module that the published tarball omits
// (`files: ["lib","src","types"]`). The one browser-safe artifact jco ships is
// the vendored, componentized js-component-bindgen — the same `generate()` jco's
// browser entry called under the hood in earlier releases — which loads its
// core wasm via `fetch` + `import.meta.url` and only touches node:fs when
// `fetch` is absent. We call it directly. The specifier is exports-map-gated by
// jco-transpile (no `./vendor/*` export), so consumers map it via importmap
// (see examples/) or a bundler alias; tsc is satisfied by src/jco-bindgen.d.ts.
const JCO_BINDGEN =
  '@bytecodealliance/jco-transpile/vendor/js-component-bindgen-component.js';

const DEFAULT_NAME = 'component';

/**
 * Run jco transpile in-page, patch the output, and return a blob: URL
 * pointing at the entry ES module. Caller does `await import(url)` to load.
 */
export async function transpileToBlobUrl(
  bytes: Uint8Array,
  options: RunComponentOptions,
): Promise<string> {
  // Dynamic import keeps the bindgen (~5MB of wasm) out of the initial bundle
  // for callers that lazy-load.
  const { generate, $init } = await import(/* @vite-ignore */ JCO_BINDGEN);
  await $init;

  const shimBase = normalizeShimBase(options.shimBase);
  const name = options.name ?? DEFAULT_NAME;
  // Host-view exports wasi:http p3 from our own shim (see wit/host-view.wit
  // and src/shims/wasi-http.ts). preview2-shim's http.js doesn't carry the
  // `client` or p3-shaped `types` exports a wasip3 component imports, so
  // wasi:http resolves to a separate URL than the rest of WASI. Defaults to
  // the bundled shim sibling-to-dist/index.js; callers can override (useful
  // when dist/ is served from a different origin than preview2-shim).
  const wasiHttpShimUrl = options.wasiHttpShimUrl
    ?? new URL('./shims/wasi-http.js', import.meta.url).href;

  // We call the low-level bindgen `generate()` directly, so we own the WASI
  // specifier map outright. This deliberately sidesteps jco-transpile's default
  // `wasiShim` map, which (as of jco 1.24) over-populates p3-versioned WASI
  // interfaces onto the Node-only `@bytecodealliance/preview3-shim` — useless
  // in a browser. Our map routes p3 wasi:http at our browser shim and the rest
  // at preview2-shim's browser builds; unversioned `wasi:foo/*` keys match
  // every version the component imports (p2 0.2.x and p3 0.3.0 alike). The `#*`
  // expansion preserves the trailing interface name jco emits per-interface.
  const result = generate(bytes, {
    name,
    asyncMode: { tag: 'jspi', val: { imports: [], exports: [] } },
    map: [
      ['wasi:cli/*', shimBase + 'cli.js#*'],
      ['wasi:clocks/*', shimBase + 'clocks.js#*'],
      ['wasi:filesystem/*', shimBase + 'filesystem.js#*'],
      ['wasi:http/*', wasiHttpShimUrl + '#*'],
      ['wasi:io/*', shimBase + 'io.js#*'],
      ['wasi:random/*', shimBase + 'random.js#*'],
      ['wasi:sockets/*', shimBase + 'sockets.js#*'],
    ],
  });

  return buildBlobModuleGraph(result.files, name, shimBase);
}

/**
 * Take jco's `files` output and assemble a graph of blob: URLs so the
 * entry module can be `import()`-ed. Each .js file has its bare-import
 * specifiers rewritten to absolute URLs (blob: contexts have no importmap),
 * each .wasm file becomes its own blob, and the entry module gets the
 * runtime patches applied (STREAM_TABLES decl + custom lifts).
 */
function buildBlobModuleGraph(
  files: Array<[string, Uint8Array]>,
  name: string,
  shimBase: string,
): string {
  const decoder = new TextDecoder();
  const fileMap = new Map<string, Uint8Array>(files);

  // 1. Blob-ify all .wasm files first; rewrite refs to those.
  const wasmUrls: Record<string, string> = {};
  for (const [path, bytes] of files) {
    if (path.endsWith('.wasm')) {
      wasmUrls[path] = URL.createObjectURL(
        new Blob([bytes as BlobPart], { type: 'application/wasm' }),
      );
    }
  }

  // 2. Sub-modules in interfaces/. Rewrite bare imports then blob-ify; index
  //    them by their relative path so the entry can refer to them.
  const subUrls: Record<string, string> = {};
  for (const [path, bytes] of files) {
    if (!path.endsWith('.js') || !path.includes('/')) continue;
    const src = rewriteBareImports(decoder.decode(bytes), shimBase);
    subUrls[path] = URL.createObjectURL(
      new Blob([src], { type: 'application/javascript' }),
    );
  }

  // 3. Entry .js — apply runtime patches (future/stream drop guard), bare-import
  //    and relative-import rewrites. Returns a single blob URL.
  const entryFilename = `${name}.js`;
  const entryBytes = fileMap.get(entryFilename);
  if (!entryBytes) {
    throw new Error(`jco transpile output missing entry module ${entryFilename}`);
  }

  let entrySrc = decoder.decode(entryBytes);
  entrySrc = applyPatches(entrySrc);
  entrySrc = rewriteBareImports(entrySrc, shimBase);

  // jco emits `new URL('./X.core.wasm', import.meta.url)` for core wasm refs.
  // When the entry module loads from a blob: URL, that URL constructor resolves
  // to the page origin's root — which 404s. Rewrite the whole expression to
  // the absolute blob URL of our core-wasm blob.
  for (const [path, blobUrl] of Object.entries(wasmUrls)) {
    const pattern = new RegExp(
      String.raw`new\s+URL\s*\(\s*(['"\`])\.\/` +
        path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        String.raw`\1\s*,\s*import\.meta\.url\s*\)`,
      'g',
    );
    entrySrc = entrySrc.replace(pattern, JSON.stringify(blobUrl));
    entrySrc = replaceAllSpec(entrySrc, `./${path}`, blobUrl);
  }
  // Final sanity check.
  const stragglers = entrySrc.match(/['"`][^'"`]*\.core\.wasm['"`]/g);
  if (stragglers) {
    console.warn('[@actcore/host] unmatched .core.wasm references:', stragglers);
  }
  for (const [path, blobUrl] of Object.entries(subUrls)) {
    entrySrc = replaceAllSpec(entrySrc, `./${path}`, blobUrl);
  }

  return URL.createObjectURL(
    new Blob([entrySrc], { type: 'application/javascript' }),
  );
}

function replaceAllSpec(src: string, from: string, to: string): string {
  return src.replaceAll(`'${from}'`, `'${to}'`).replaceAll(`"${from}"`, `"${to}"`);
}

function normalizeShimBase(base: string): string {
  return base.endsWith('/') ? base : base + '/';
}
