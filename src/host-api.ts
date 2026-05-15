import type {
  ListToolsResponse,
  ToolResult,
} from './generated/interfaces/act-tools-tool-provider.js';
import type { Cbor, Metadata } from './generated/interfaces/act-core-types.js';

import { transpileToBlobUrl } from './transpile.js';

/**
 * Typed mirror of the `act:tools/tool-provider@0.1.0` interface as exposed
 * by jco-transpiled modules. Matches the generated types in
 * `./generated/interfaces/act-tools-tool-provider.js`.
 */
export interface ToolProvider {
  listTools(metadata: Metadata): Promise<ListToolsResponse>;
  callTool(name: string, args: Cbor, metadata: Metadata): Promise<ToolResult>;
}

export interface ComponentInstance {
  /** `act:tools/tool-provider@0.1.0` if the component exports it. */
  toolProvider: ToolProvider;
}

export interface RunComponentOptions {
  /** Human-readable component name; used for output filenames during transpile. */
  name?: string;
  /**
   * Absolute base URL for the `@bytecodealliance/preview2-shim/lib/browser/`
   * directory. Required: jco's `transpile()` does not apply default WASI
   * specifier mappings via its programmatic API, so callers must point at a
   * concrete shim location (CDN, vendored copy, or bundler-resolved path).
   *
   * Example: `'https://cdn.jsdelivr.net/npm/@bytecodealliance/preview2-shim@0.17.0/lib/browser/'`
   */
  shimBase: string;
  /**
   * Optional absolute URL of `dist/shims/wasi-http.js` from `@actcore/host`.
   * Defaults to the bundled shim resolved relative to host-api's module URL.
   * Override when `@actcore/host` is loaded from one origin and you want the
   * wasi:http p3 shim served from another.
   */
  wasiHttpShimUrl?: string;
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
 *   `act-build pack` and exporting `act:tools/tool-provider@0.1.0`.
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
      'Component does not export act:tools/tool-provider@0.1.0',
    );
  }

  return { toolProvider: wrapToolProvider(mod.toolProvider) };
}

/**
 * jco's transpiled output uses `WebAssembly.compileStreaming(fetch(...))`,
 * which Chrome's strict MIME check rejects for blob: URLs in some
 * dev-server setups (Vite, etc.) where the blob's Content-Type is reported
 * as something other than exactly `application/wasm`. Wrap with a fallback
 * to non-streaming `compile()` that doesn't care.
 *
 * Idempotent — installs at most once per page load.
 */
function installCompileStreamingFallback(): void {
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

/**
 * Each `listTools` / `callTool` call hits `taskReturn` inside the transpiled
 * module, which we've patched to delegate to a custom lift selected by
 * `globalThis.__actcoreExpect`. This wrapper sets the flag for the duration
 * of one call so callers don't have to think about it.
 */
function wrapToolProvider(raw: ToolProvider): ToolProvider {
  const g = globalThis as unknown as Record<string, string | undefined>;
  return {
    async listTools(metadata) {
      const prev = g['__actcoreExpect'];
      g['__actcoreExpect'] = 'list-tools';
      try {
        return await raw.listTools(metadata);
      } finally {
        g['__actcoreExpect'] = prev;
      }
    },
    async callTool(name, args, metadata) {
      const prev = g['__actcoreExpect'];
      g['__actcoreExpect'] = 'call-tool';
      try {
        return await raw.callTool(name, args, metadata);
      } finally {
        g['__actcoreExpect'] = prev;
      }
    },
  };
}
