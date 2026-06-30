import type {
  ListToolsResponse,
  ToolResult,
} from './generated/interfaces/act-tools-tool-provider.js';
import type { Cbor, Metadata } from './generated/interfaces/act-core-types.js';

import { transpileToBlobUrl } from './transpile.js';
import { installCompileStreamingFallback } from './streaming-fallback.js';

/**
 * Typed mirror of the `act:tools/tool-provider@0.2.0` interface as exposed
 * by jco-transpiled modules. Matches the generated types in
 * `./generated/interfaces/act-tools-tool-provider.js`.
 */
export interface ToolProvider {
  listTools(metadata: Metadata): Promise<ListToolsResponse>;
  callTool(name: string, args: Cbor, metadata: Metadata): Promise<ToolResult>;
}

export interface ComponentInstance {
  /** `act:tools/tool-provider@0.2.0` if the component exports it. */
  toolProvider: ToolProvider;
}

export interface RunComponentOptions {
  /** Human-readable component name; used for output filenames during transpile. */
  name?: string;
  /**
   * Absolute base URL for the `@bytecodealliance/preview2-shim` browser-build
   * directory (`dist/browser/` as of preview2-shim 0.19; it was `lib/browser/`
   * before). Required: we drive jco's low-level bindgen `generate()` directly
   * and pass our own WASI specifier map, so callers must point at a concrete
   * shim location (CDN, vendored copy, or bundler-resolved path).
   *
   * Example: `'https://cdn.jsdelivr.net/npm/@bytecodealliance/preview2-shim@0.19.0/dist/browser/'`
   */
  shimBase: string;
  /**
   * Optional absolute URL of `dist/shims/wasi-http.js` from `@actcore/host`.
   * Defaults to the bundled shim resolved relative to host-api's module URL.
   * Override when `@actcore/host` is loaded from one origin and you want the
   * wasi:http p3 shim served from another.
   */
  wasiHttpShimUrl?: string;
  /**
   * Persist + reuse the jco transpile output in IndexedDB, keyed by
   * `@actcore/host`'s version and the SHA-256 of the component bytes. Defaults
   * to `true`. Set `false` to always transpile fresh (e.g. when debugging the
   * transpiler). No effect where IndexedDB / `crypto.subtle` is unavailable —
   * the cache silently disables itself there. See {@link clearTranspileCache}.
   */
  cache?: boolean;
}

/**
 * Transpile and instantiate an ACT wasm component in the current page,
 * returning a typed handle to its exported provider interfaces.
 *
 * Requires:
 * - `WebAssembly.promising` (JSPI). Available by default in Chrome 137+,
 *   in Firefox Nightly 152+, and in Safari Tech Preview 243+. Tracking
 *   issue: Interop 2026 focus area #10.
 * - The component must be a `wasip3`-style ACT component packed via
 *   `act-build pack` and exporting `act:tools/tool-provider@0.2.0`.
 */
export async function runComponent(
  bytes: Uint8Array,
  options: RunComponentOptions,
): Promise<ComponentInstance> {
  if (typeof (WebAssembly as unknown as { promising?: unknown }).promising !== 'function') {
    throw new Error(
      '@actcore/host requires JSPI (WebAssembly.promising). Use Chrome 137+ ' +
        '(stable), Firefox Nightly 152+, or Safari Technology Preview 243+. ' +
        'Per Interop 2026 commitment, stable Firefox/Safari ship JSPI in 2026.',
    );
  }

  installCompileStreamingFallback();

  const entryBlobUrl = await transpileToBlobUrl(bytes, options);

  // Dynamic import from blob: URL is supported in all browsers with ESM modules.
  const mod = (await import(/* @vite-ignore */ entryBlobUrl)) as {
    toolProvider?: ToolProvider;
  };

  if (!mod.toolProvider) {
    throw new Error(
      'Component does not export act:tools/tool-provider@0.2.0',
    );
  }

  return { toolProvider: mod.toolProvider };
}

