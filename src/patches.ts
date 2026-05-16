import { customLiftSource } from './lift.js';

/**
 * Apply runtime patches to a transpiled entry-module source string.
 *
 * Patches:
 *
 * 1. `STREAM_TABLES` is referenced unconditionally but never declared by jco
 *    1.19 for wasip3-async components. Inject the declarations near the top.
 *
 * 2. `HostFuture` class + `FUTURES` rep-table are referenced (at
 *    `futureNewFromLift`) but never emitted by jco 1.19 — components importing
 *    wasi:http p3 hit this via `request.new(headers, body, trailers, options)`
 *    where `trailers` is a `future<...>`. Inject minimal stubs near the top:
 *    a HostFuture class that holds the args and exposes the methods jco's
 *    machinery calls (setRep, setGlobalFutureMapRep, createUserFuture, etc.),
 *    plus a FUTURES table with the small RepTable surface jco uses (insert,
 *    get, remove). The user-facing future is a thenable that resolves to
 *    undefined — sufficient for any code path that just constructs a future
 *    and never reads it (the typical trailers case).
 *
 * 3. Replace the body of `taskReturn`'s "lift results from memory" block with
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

  if (out.includes('new HostFuture(') && !/class\s+HostFuture/.test(out)) {
    out = out.replace(
      'const instantiateCore = WebAssembly.instantiate;',
      [
        'const instantiateCore = WebAssembly.instantiate;',
        '// @actcore/host: HostFuture polyfill — jco 1.19 references `new HostFuture({...})`',
        '// at futureNewFromLift but never emits the class. FUTURES is already declared',
        '// in the entry module via `new RepTable(...)`, so only the class needs stubbing.',
        'class HostFuture {',
        '  constructor(args) { this._args = args || {}; this._rep = null; this._userFuture = null; }',
        '  setRep(rep) { this._rep = rep; }',
        '  setGlobalFutureMapRep(rep) { this._rep = rep; }',
        '  getFutureEndWaitableIdx() { return this._args.futureEndWaitableIdx; }',
        '  getRep() { return this._rep; }',
        '  createUserFuture() {',
        '    if (this._userFuture) return this._userFuture;',
        '    // Thenable resolving to undefined. Sufficient for trailers-style',
        '    // futures that the host never reads from (the typical case for',
        '    // wasi:http request.new trailers parameter).',
        '    const p = Promise.resolve(undefined);',
        '    this._userFuture = {',
        '      then: p.then.bind(p),',
        '      catch: p.catch.bind(p),',
        '      finally: p.finally.bind(p),',
        '    };',
        '    return this._userFuture;',
        '  }',
        '}',
      ].join('\n'),
    );
  }

  const liftAnchor =
    'let liftCtx = { memory, useDirectParams, params, componentIdx, stringEncoding };';
  if (out.includes(liftAnchor)) {
    out = out.replace(liftAnchor, customLiftSource() + '\n    ' + liftAnchor);
  }

  // wit-bindgen Rust's future destructor emits `future-drop-{readable,writable}(idx)`
  // even after the future end has been transferred (e.g., into request.new
  // trailers param), at which point the wasm-side handle is 0. jco's
  // futureDropReadable/futureDropWritable then crash on the missing handle.
  // Short-circuit drops with idx=0 — the host already owns the future (or
  // the end never existed), nothing to drop on the wasm side. Same for streams.
  const fnEarlyReturn = (anchor: string) => {
    if (!out.includes(anchor)) return;
    out = out.replace(anchor, anchor + '\n    if (!arguments[1]) return;');
  };
  fnEarlyReturn('function futureDropReadable(ctx, futureEndWaitableIdx) {');
  fnEarlyReturn('function futureDropWritable(ctx, futureEndWaitableIdx) {');
  fnEarlyReturn('function streamDropReadable(ctx, streamEndWaitableIdx) {');
  fnEarlyReturn('function streamDropWritable(ctx, streamEndWaitableIdx) {');

  // Replace jco's "throw" stubs in `_lowerFlatOwn` lowerFn slots with a
  // no-op returning a sentinel handle 0. jco emits these stubs when it
  // can't generate a real resource-handle lower for a host-imported
  // resource (e.g., wasi:io/error stream-error variant) — the throw
  // crashes the lowering even on success paths that incidentally touch
  // a resource type the host doesn't expose. Returning 0 gives the wasm
  // side an invalid handle which it likely never reads (these paths are
  // typically error-case lowering that won't be exercised).
  // jco's `_lowerImport` calls these lowerFns to convert host-side resource
  // instances back into wasm-side handles. jco emits throw-stubs when it
  // couldn't auto-register a resource type — the wasm then receives no valid
  // handle and crashes downstream (`Resource error: Not a valid "X" resource`).
  // Replace with a per-class registrar that uses the matching captureTable.
  // The replacement runs inside $init so it has access to captureTableN,
  // captureCntN, handleTableN, symbolRscHandle, symbolRscRep, rscTableCreateOwn.
  // Resource → table mapping observed via grep of jco's emitted code:
  //   Error$1 → captureTable1/handleTable1
  //   Fields  → captureTable4/handleTable4
  //   Response → captureTable5/handleTable5
  //   RequestOptions → captureTable6/handleTable6
  //   Request → captureTable7/handleTable7
  out = out.replaceAll(
    "lowerFn: () => { throw new Error('missing/invalid resource metadata'); }",
    "lowerFn: (obj) => { const _dbg = (globalThis.__actcoreLowerFn ||= []); if (!obj || typeof obj !== 'object') { _dbg.push({reason: 'no-obj', t: typeof obj}); return 0; } if (obj[symbolRscHandle]) { _dbg.push({reason: 'has-handle', h: obj[symbolRscHandle], cls: obj.constructor?.name}); return obj[symbolRscHandle]; } if (typeof Response !== 'undefined' && obj instanceof Response) { const rep = obj[symbolRscRep] || ++captureCnt5; captureTable5.set(rep, obj); const h = rscTableCreateOwn(handleTable5, rep); _dbg.push({reason: 'Response', rep, handle: h}); return h; } if (typeof Fields !== 'undefined' && obj instanceof Fields) { const rep = obj[symbolRscRep] || ++captureCnt4; captureTable4.set(rep, obj); const h = rscTableCreateOwn(handleTable4, rep); _dbg.push({reason: 'Fields', rep, handle: h}); return h; } _dbg.push({reason: 'unknown', cls: obj.constructor?.name}); return 0; }",
  );

  // DIAGNOSTIC: trace what handle the wasm passes to getHeaders.
  out = out.replaceAll(
    "throw new TypeError('Resource error: Not a valid \\\"Headers\\\" resource.');",
    "(globalThis.__actcoreHdrCheck ||= []).push({handle1, rep2, hasRsc: !!rsc0, rscHasHeaders: rsc0 && 'headers' in rsc0, hdrs: typeof rsc0?.headers, retIsUndef: ret === undefined, ct5Size: captureTable5.size, ht5Snapshot: handleTable5.slice(0, 10)}); throw new TypeError('Resource error: Not a valid \\\"Headers\\\" resource.');",
  );

  // DIAGNOSTIC: trace all setUint32 writes via ctx.memory.
  out = out.replaceAll(
    "new DataView(ctx.memory.buffer).setUint32(ctx.storagePtr, ctx.vals[0], true);",
    "{ const _dv = new DataView(ctx.memory.buffer); _dv.setUint32(ctx.storagePtr, ctx.vals[0], true); (globalThis.__actcoreU32 ||= []).push({ptr: ctx.storagePtr, val: ctx.vals[0], stack: new Error().stack?.split('\\n').slice(1, 4).join(' | ')}); }",
  );


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
