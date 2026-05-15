import { applyPatches, rewriteBareImports } from './patches.js';
import type { RunComponentOptions } from './host-api.js';

/** Subset of jco's browser-entry API we depend on. */
interface JcoBrowserApi {
  transpile(
    bytes: Uint8Array,
    options: {
      name: string;
      asyncMode?: { tag: 'sync' } | { tag: 'jspi'; val: { imports: string[]; exports: string[] } };
      map?: Array<[string, string]>;
    },
  ): Promise<{ files: Array<[string, Uint8Array]> }>;
}

const DEFAULT_NAME = 'component';

/**
 * Run jco transpile in-page, patch the output, and return a blob: URL
 * pointing at the entry ES module. Caller does `await import(url)` to load.
 */
export async function transpileToBlobUrl(
  bytes: Uint8Array,
  options: RunComponentOptions,
): Promise<string> {
  // Dynamic import keeps jco out of the initial bundle for callers that may
  // tree-shake or lazy-load. jco itself is ~5MB, dominated by its wasm-tools.
  const { transpile } = (await import(
    '@bytecodealliance/jco/component'
  )) as unknown as JcoBrowserApi;

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

  // jco's browser API doesn't apply the CLI's default WASI specifier map, so
  // we pass one explicitly pointing at absolute browser-shim URLs. The `#*`
  // expansion preserves the trailing interface name jco emits per-interface.
  const result = await transpile(bytes, {
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

  // 3. Entry .js — apply STREAM_TABLES decl, lift patches, bare-import and
  //    relative-import rewrites. Returns a single blob URL.
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
