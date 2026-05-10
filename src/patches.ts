import { customLiftSource } from './lift.js';

/**
 * Apply runtime patches to a transpiled entry-module source string.
 *
 * Patches:
 *
 * 1. `STREAM_TABLES` is referenced unconditionally but never declared by jco
 *    1.19 for wasip3-async components. Inject the declarations near the top.
 *
 * 2. Replace the body of `taskReturn`'s "lift results from memory" block with
 *    custom code that handles wasip3-async task-return — see `lift.ts`. jco's
 *    `_liftFlatRecord(useDirectParams: true)` assumes `params[0]` is a struct
 *    pointer and reads fields from memory; the actual wasip3-async ABI passes
 *    record/variant fields *flat* in params. The custom lift reads the flat
 *    representation and walks `tool-definition` / `tool-event` records out
 *    of linear memory directly.
 */
export function applyPatches(src: string): string {
  let out = src;

  if (out.includes('STREAM_TABLES[0]') && !/const\s+STREAM_TABLES/.test(out)) {
    out = out.replace(
      'const instantiateCore = WebAssembly.instantiate;',
      [
        'const instantiateCore = WebAssembly.instantiate;',
        'const STREAM_TABLES = {};',
        'const FUTURE_TABLES = {};',
      ].join('\n'),
    );
  }

  const liftAnchor =
    'let liftCtx = { memory, useDirectParams, params, componentIdx, stringEncoding };';
  if (out.includes(liftAnchor)) {
    out = out.replace(liftAnchor, customLiftSource() + '\n    ' + liftAnchor);
  }

  return out;
}

/**
 * Bare-specifier imports for `@bytecodealliance/preview2-shim/*` are emitted
 * by jco's transpile (matching the `map` option we pass), but ES modules
 * loaded from blob: URLs can't see the document's importmap. Rewrite to
 * absolute URLs in-place.
 */
export function rewriteBareImports(src: string, shimBase: string): string {
  const base = shimBase.endsWith('/') ? shimBase : shimBase + '/';
  const mapping: Record<string, string> = {
    '@bytecodealliance/preview2-shim/cli': base + 'cli.js',
    '@bytecodealliance/preview2-shim/clocks': base + 'clocks.js',
    '@bytecodealliance/preview2-shim/io': base + 'io.js',
    '@bytecodealliance/preview2-shim/filesystem': base + 'filesystem.js',
    '@bytecodealliance/preview2-shim/http': base + 'http.js',
    '@bytecodealliance/preview2-shim/random': base + 'random.js',
    '@bytecodealliance/preview2-shim/sockets': base + 'sockets.js',
  };

  let out = src;
  for (const [spec, url] of Object.entries(mapping)) {
    out = out.replaceAll(`'${spec}'`, `'${url}'`).replaceAll(`"${spec}"`, `"${url}"`);
  }
  return out;
}
