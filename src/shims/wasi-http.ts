// Implementation of host-view's wasi:http p3 imports. Public API is the union
// of `client` + `types` exports — these are the symbols jco's transpile pulls
// off the URL we hand it via `map: ['wasi:http/*', shims/wasi-http.js#*]`.
//
// Gen-types (`src/generated/interfaces/wasi-http-{client,types}.d.ts`) drive
// the public shape; see the conformance check at the bottom of this file.

import {
  internalError,
  FIELD_VALUE_RE,
  FORBIDDEN,
  TOKEN_RE,
  type ErrorCode,
} from './wasi-http-internal.js';
import type {
  Duration,
  FieldName,
  FieldValue,
  Method,
  Scheme,
  StatusCode,
  Result,
} from '../generated/interfaces/wasi-http-types.js';

// Local aliases: at runtime, jco passes our concrete Fields class through
// for Headers/Trailers params (see fixture line 9484: `Request.new(rsc0, ...)`
// where rsc0 is the result of `Fields.fromList(...)`). gen-types' `Headers`
// is nominally distinct from our `Fields` because of class-private brands,
// so we use the concrete type here. The conformance check at the bottom of
// this file detects structural drift.
type Headers = Fields;
type Trailers = Fields;

const TEXT_DECODER = new TextDecoder();

function decodeFieldValue(v: FieldValue): string {
  // FieldValue is Uint8Array per WIT, but be lenient if a string slips in.
  return typeof v === 'string' ? (v as string) : TEXT_DECODER.decode(v);
}

export class Fields {
  #immutable = false;
  // Preserves insertion order + original casing for `copyAll`.
  #entries: [FieldName, FieldValue][] = [];
  // Lowercase-keyed view for `get`/`has`/`delete`/`set`. Each bucket holds
  // references to the same tuples stored in `#entries` so we can keep them
  // in sync.
  #table = new Map<string, [FieldName, FieldValue][]>();

  constructor() {}

  static fromList(entries: Array<[FieldName, FieldValue]>): Fields {
    const f = new Fields();
    for (const [k, v] of entries) f.append(k, v);
    return f;
  }

  get(name: FieldName): Array<FieldValue> {
    return (this.#table.get(name.toLowerCase()) ?? []).map(([, v]) => v);
  }

  has(name: FieldName): boolean {
    return this.#table.has(name.toLowerCase());
  }

  set(name: FieldName, value: Array<FieldValue>): void {
    if (this.#immutable) throw { tag: 'immutable' };
    if (!TOKEN_RE.test(name)) throw { tag: 'invalid-syntax' };
    const lower = name.toLowerCase();
    if (FORBIDDEN.has(lower)) throw { tag: 'forbidden' };
    for (const v of value) {
      if (!FIELD_VALUE_RE.test(decodeFieldValue(v))) {
        throw { tag: 'invalid-syntax' };
      }
    }
    // Drop existing entries for this name (preserving insertion order for
    // other names).
    const existing = this.#table.get(lower);
    if (existing && existing.length > 0) {
      this.#entries = this.#entries.filter((e) => !existing.includes(e));
      existing.length = 0;
    } else if (!existing) {
      this.#table.set(lower, []);
    }
    const bucket = this.#table.get(lower)!;
    for (const v of value) {
      const entry: [FieldName, FieldValue] = [name, v];
      this.#entries.push(entry);
      bucket.push(entry);
    }
  }

  'delete'(name: FieldName): void {
    if (this.#immutable) throw { tag: 'immutable' };
    const lower = name.toLowerCase();
    const bucket = this.#table.get(lower);
    if (bucket && bucket.length > 0) {
      this.#entries = this.#entries.filter((e) => !bucket.includes(e));
    }
    this.#table.delete(lower);
  }

  getAndDelete(name: FieldName): Array<FieldValue> {
    const out = this.get(name);
    if (out.length > 0) this.delete(name);
    return out;
  }

  append(name: FieldName, value: FieldValue): void {
    if (this.#immutable) throw { tag: 'immutable' };
    if (!TOKEN_RE.test(name)) throw { tag: 'invalid-syntax' };
    if (!FIELD_VALUE_RE.test(decodeFieldValue(value))) {
      throw { tag: 'invalid-syntax' };
    }
    const lower = name.toLowerCase();
    if (FORBIDDEN.has(lower)) throw { tag: 'forbidden' };
    const entry: [FieldName, FieldValue] = [name, value];
    this.#entries.push(entry);
    const bucket = this.#table.get(lower);
    if (bucket) bucket.push(entry);
    else this.#table.set(lower, [entry]);
  }

  copyAll(): Array<[FieldName, FieldValue]> {
    return this.#entries.map(([k, v]) => [
      k,
      typeof v === 'string' ? v : v.slice(),
    ]);
  }

  clone(): Fields {
    return Fields.fromList(this.#entries);
  }

  // Internal: response headers are immutable per WIT spec.
  _lockInternal(): void {
    this.#immutable = true;
  }
}

export class RequestOptions {
  #connect: Duration | undefined;
  #firstByte: Duration | undefined;
  #betweenBytes: Duration | undefined;
  #immutable = false;

  constructor() {}

  getConnectTimeout(): Duration | undefined {
    return this.#connect;
  }
  setConnectTimeout(duration: Duration | undefined): void {
    this.#guard();
    this.#connect = duration;
  }
  getFirstByteTimeout(): Duration | undefined {
    return this.#firstByte;
  }
  setFirstByteTimeout(duration: Duration | undefined): void {
    this.#guard();
    this.#firstByte = duration;
  }
  getBetweenBytesTimeout(): Duration | undefined {
    return this.#betweenBytes;
  }
  setBetweenBytesTimeout(duration: Duration | undefined): void {
    this.#guard();
    this.#betweenBytes = duration;
  }

  clone(): RequestOptions {
    const c = new RequestOptions();
    c.#connect = this.#connect;
    c.#firstByte = this.#firstByte;
    c.#betweenBytes = this.#betweenBytes;
    return c;
  }

  #guard(): void {
    if (this.#immutable) throw { tag: 'immutable' };
  }

  _lockInternal(): void {
    this.#immutable = true;
  }
}

export class Request {
  // Public for shim internals (used by client.send) but jco only touches the
  // setter / getter methods below.
  method: Method = { tag: 'get' };
  pathWithQuery: string | undefined = undefined;
  scheme: Scheme | undefined = undefined;
  authority: string | undefined = undefined;
  headers: Fields;
  body: ReadableStream<number> | undefined = undefined;
  trailers: Promise<Result<Trailers | undefined, ErrorCode>>;
  options: RequestOptions | undefined = undefined;

  // gen-types models the resource constructor as `private constructor()`; the
  // public way to make one is `Request.new(...)`. We can't make the
  // constructor strictly private without breaking the static factory below,
  // but discourage external use by name-prefixing the params.
  private constructor(
    headers: Headers,
    body: ReadableStream<number> | undefined,
    trailers: Promise<Result<Trailers | undefined, ErrorCode>>,
    options: RequestOptions | undefined,
  ) {
    this.headers = headers;
    this.body = body;
    this.trailers = trailers;
    this.options = options;
  }

  static 'new'(
    headers: Headers,
    contents: ReadableStream<number> | undefined,
    trailers: Promise<Result<Trailers | undefined, ErrorCode>>,
    options: RequestOptions | undefined,
  ): [Request, Promise<Result<void, ErrorCode>>] {
    const req = new Request(headers, contents, trailers, options);
    // Per WIT: headers/options accessed via getters are immutable.
    headers._lockInternal();
    options?._lockInternal();
    // The future resolves to the outcome of transmission. For a freshly
    // constructed request that hasn't been handed off yet, we resolve with
    // ok(); client.send replaces this when it actually sends.
    const future: Promise<Result<void, ErrorCode>> = Promise.resolve({
      tag: 'ok',
      val: undefined,
    });
    return [req, future];
  }

  getMethod(): Method {
    return this.method;
  }
  setMethod(method: Method): void {
    this.method = method;
  }
  getPathWithQuery(): string | undefined {
    return this.pathWithQuery;
  }
  setPathWithQuery(pathWithQuery: string | undefined): void {
    this.pathWithQuery = pathWithQuery;
  }
  getScheme(): Scheme | undefined {
    return this.scheme;
  }
  setScheme(scheme: Scheme | undefined): void {
    this.scheme = scheme;
  }
  getAuthority(): string | undefined {
    return this.authority;
  }
  setAuthority(authority: string | undefined): void {
    this.authority = authority;
  }
  getOptions(): RequestOptions | undefined {
    return this.options;
  }
  getHeaders(): Headers {
    return this.headers;
  }

  static consumeBody(
    this_: Request,
    _res: Promise<Result<void, ErrorCode>>,
  ): [
    ReadableStream<number>,
    Promise<Result<Trailers | undefined, ErrorCode>>,
  ] {
    const body =
      this_.body ??
      new ReadableStream<number>({
        start(controller) {
          controller.close();
        },
      });
    return [body, this_.trailers];
  }
}

export class Response {
  statusCode: StatusCode = 200;
  headers: Fields;
  body: ReadableStream<number> | undefined = undefined;
  trailers: Promise<Result<Trailers | undefined, ErrorCode>>;

  private constructor(
    headers: Headers,
    body: ReadableStream<number> | undefined,
    trailers: Promise<Result<Trailers | undefined, ErrorCode>>,
  ) {
    this.headers = headers;
    this.body = body;
    this.trailers = trailers;
  }

  static 'new'(
    headers: Headers,
    contents: ReadableStream<number> | undefined,
    trailers: Promise<Result<Trailers | undefined, ErrorCode>>,
  ): [Response, Promise<Result<void, ErrorCode>>] {
    const resp = new Response(headers, contents, trailers);
    headers._lockInternal();
    const future: Promise<Result<void, ErrorCode>> = Promise.resolve({
      tag: 'ok',
      val: undefined,
    });
    return [resp, future];
  }

  getStatusCode(): StatusCode {
    return this.statusCode;
  }
  setStatusCode(statusCode: StatusCode): void {
    if (statusCode < 100 || statusCode > 999) {
      // WIT spec says "fails if the status-code given is not a valid http
      // status code". Surface as a plain Error since this method has no
      // typed error in the WIT.
      throw new Error('status-code out of range');
    }
    this.statusCode = statusCode;
  }
  getHeaders(): Headers {
    return this.headers;
  }

  static consumeBody(
    this_: Response,
    _res: Promise<Result<void, ErrorCode>>,
  ): [
    ReadableStream<number>,
    Promise<Result<Trailers | undefined, ErrorCode>>,
  ] {
    // Task 7 wires this to the real `fetch()` response.body. For now return
    // an empty stream + ok trailers so the surface compiles.
    const body =
      this_.body ??
      new ReadableStream<number>({
        start(controller) {
          controller.close();
        },
      });
    return [body, this_.trailers];
  }
}

export const types = {
  Fields,
  Request,
  RequestOptions,
  Response,
};

export const client = {
  async send(_request: Request): Promise<Response> {
    throw internalError('wasi:http/client send not implemented yet');
  },
};

export type { ErrorCode };

// ---------------------------------------------------------------------------
// Compile-time conformance check against jco-generated types.
//
// Goal: when host-view.wit is bumped and gen-types regenerated, drift in the
// shape of `client.send` or the class shapes in `types.*` should fail
// `npm run typecheck`.
//
// Design notes:
// - Plain `type _X = T extends U ? true : never` aliases combined with
//   `true as _X` are silently accepted on drift because `true as never` is
//   a valid cast. Instead we use `satisfies` on a typed const so the value
//   must literally be assignable to the conditional's result. When the
//   condition is true the type is `true` (a literal we satisfy). When the
//   condition is `never`, the literal `true` is NOT assignable to `never`
//   and tsc errors out.
// - For instance shape: `InstanceType<typeof OurClass>` vs
//   `InstanceType<typeof GenTypes.XXX>` ignores private-constructor brands
//   that would otherwise make `typeof` constructor comparisons fail.
//   Static members are checked separately.
// - `Partial<typeof GenClient>` permits the shim to omit gen-types members
//   we don't ship, while still requiring that anything we DO ship matches.
// ---------------------------------------------------------------------------
import type * as GenClient from '../generated/interfaces/wasi-http-client.js';
import type * as GenTypes from '../generated/interfaces/wasi-http-types.js';

type AssertExtends<A, B> = A extends B ? true : never;

// `satisfies true` forces the conditional to resolve to `true`. If drift
// makes the conditional resolve to `never`, the literal `true` is not
// assignable to `never` and tsc errors at that line.
//
// For `client.send` we only check the member exists and is callable —
// nominal class brands (private constructor() in gen-types' Request /
// Response) prevent direct param/return assignability even though the
// runtime objects are the same. The class checks below give us drift
// detection on the actual shape.
const _checkClient = true satisfies AssertExtends<
  keyof typeof client,
  keyof typeof GenClient
>;
const _checkClientSendArity = true satisfies AssertExtends<
  Parameters<typeof client.send>['length'],
  Parameters<typeof GenClient.send>['length']
>;
const _checkFieldsInstance = true satisfies AssertExtends<
  Fields,
  Pick<
    GenTypes.Fields,
    'get' | 'has' | 'set' | 'delete' | 'getAndDelete' | 'append' | 'copyAll' | 'clone'
  >
>;
const _checkFieldsStatic = true satisfies AssertExtends<
  Pick<typeof Fields, 'fromList'>,
  Pick<typeof GenTypes.Fields, 'fromList'>
>;
const _checkRequestInstance = true satisfies AssertExtends<
  Request,
  Pick<
    GenTypes.Request,
    'getMethod' | 'setMethod' | 'getPathWithQuery' | 'setPathWithQuery'
    | 'getScheme' | 'setScheme' | 'getAuthority' | 'setAuthority'
    | 'getOptions' | 'getHeaders'
  >
>;
const _checkRequestStatic = true satisfies AssertExtends<
  Pick<typeof Request, 'new' | 'consumeBody'>,
  Pick<typeof GenTypes.Request, 'new' | 'consumeBody'>
>;
const _checkRequestOptionsInstance = true satisfies AssertExtends<
  RequestOptions,
  Pick<
    GenTypes.RequestOptions,
    'getConnectTimeout' | 'setConnectTimeout' | 'getFirstByteTimeout'
    | 'setFirstByteTimeout' | 'getBetweenBytesTimeout'
    | 'setBetweenBytesTimeout' | 'clone'
  >
>;
const _checkResponseInstance = true satisfies AssertExtends<
  Response,
  Pick<
    GenTypes.Response,
    'getStatusCode' | 'setStatusCode' | 'getHeaders'
  >
>;
const _checkResponseStatic = true satisfies AssertExtends<
  Pick<typeof Response, 'new' | 'consumeBody'>,
  Pick<typeof GenTypes.Response, 'new' | 'consumeBody'>
>;
void [
  _checkClient,
  _checkClientSendArity,
  _checkFieldsInstance,
  _checkFieldsStatic,
  _checkRequestInstance,
  _checkRequestStatic,
  _checkRequestOptionsInstance,
  _checkResponseInstance,
  _checkResponseStatic,
];
