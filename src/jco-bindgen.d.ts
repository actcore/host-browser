/**
 * Ambient types for jco 1.24.x's vendored, componentized js-component-bindgen.
 *
 * Why a hand-written ambient declaration instead of importing jco's own types:
 * `@bytecodealliance/jco-transpile` does not expose `./vendor/*` in its
 * package `exports`, so `moduleResolution: bundler` (and Node) refuse to
 * resolve the subpath for typing. We import the module at runtime anyway (it
 * is the only browser-safe transpiler entry jco 1.24.x ships — see
 * `transpile.ts`), so we declare the small slice of its surface we use here.
 *
 * Mirrors `node_modules/@bytecodealliance/jco-transpile/vendor/
 * js-component-bindgen-component.d.ts` (`generate`, `$init`, `GenerateOptions`,
 * `AsyncMode`, `Transpiled`). Keep in sync if the bindgen ABI changes.
 */
declare module '@bytecodealliance/jco-transpile/vendor/js-component-bindgen-component.js' {
  /** Resolves once the bindgen's own core wasm has been instantiated. */
  export const $init: Promise<void>;

  export interface AsyncImportsExports {
    imports: string[];
    exports: string[];
  }
  export type AsyncMode =
    | { tag: 'sync' }
    | { tag: 'jspi'; val: AsyncImportsExports };

  /** `wasi:cli/*` → `shim#*` import remaps, as a list of tuples. */
  export type Maps = Array<[string, string]>;

  export interface GenerateOptions {
    name: string;
    map?: Maps;
    asyncMode?: AsyncMode;
    instantiation?: { tag: 'async' | 'sync' };
    importBindings?: { tag: 'js' | 'optimized' | 'hybrid' | 'direct-optimized' };
    validLiftingOptimization?: boolean;
    tracing?: boolean;
    noNodejsCompat?: boolean;
    noTypescript?: boolean;
    tlaCompat?: boolean;
    base64Cutoff?: number;
    noNamespacedExports?: boolean;
    multiMemory?: boolean;
    strict?: boolean;
  }

  export type ExportType = 'function' | 'instance';
  export interface Transpiled {
    /** `[filename, bytes]` pairs: the entry `.js`, `.core.wasm`, sub-modules. */
    files: Array<[string, Uint8Array]>;
    imports: string[];
    exports: Array<[string, ExportType]>;
  }

  export function generate(component: Uint8Array, options: GenerateOptions): Transpiled;
}
