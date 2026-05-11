# jco transpile contract — http-client.wasm

Snapshot of `/tmp/claude/jco-out/http-client.js` import shape and host-trampoline
obligations. Regenerate via the command in Task 2 of
`docs/superpowers/plans/2026-05-15-wasi-http-p3-shim.md`.

Source component: `components/http-client/target/wasm32-wasip2/release/component_http_client.wasm`
(~603 KB). Transpile options:

```js
transpile(bytes, {
  name: 'http-client',
  asyncMode: { tag: 'jspi', val: { imports: [], exports: [] } },
  map: [['wasi:http/*', 'http.js#*']],
});
```

## Entry-module imports (top of `http-client.js`)

```js
"use components";
import { client, types } from 'http.js';
// ...
import { Error as Error$1 } from 'wasi:io/error';
import { Pollable } from 'wasi:io/poll';
import { InputStream, OutputStream } from 'wasi:io/streams';
// ...
const { send } = client;
// jco then null-checks `send` and stamps `send._isHostProvided = true`.
const { Fields,
  Request,
  RequestOptions,
  Response } = types;
// jco null-checks each, then stamps `<Class>._isHostProvided = true`.
```

Note: `Error$1` (resource-dropped only by jco) comes from `wasi:io/error`, **not**
from the `http.js` shim. The shim only owes `client.send` and the four classes
under `types`.

## Instantiate map — `wasi:http/client@0.3.0-rc-2026-03-15` (line 15534)

```js
'wasi:http/client@0.3.0-rc-2026-03-15': {
  '[async-lower]send': exports0['22'],
},
```

`exports0['22']` resolves to `trampoline69` (entry `'22': trampoline69` in the
core-module import object, line 15624). `trampoline69` is the host wrapper that
calls `send(rsc0)` on the JS class (see `_trampoline69`, line 10127:
`fn: () => send(rsc0)`).

## Instantiate map — `wasi:http/types@0.3.0-rc-2026-03-15` (line 15537, verbatim)

```js
'wasi:http/types@0.3.0-rc-2026-03-15': {
  '[async-lower][future-read-1][static]request.new': exports0['17'],
  '[async-lower][future-read-2][static]request.new': exports0['19'],
  '[async-lower][future-write-1][static]request.new': exports0['16'],
  '[async-lower][future-write-2][static]request.new': exports0['18'],
  '[async-lower][stream-read-0][static]request.new': exports0['21'],
  '[async-lower][stream-write-0][static]request.new': exports0['20'],
  '[constructor]request-options': trampoline11,
  '[future-cancel-read-1][static]request.new': trampoline29,
  '[future-cancel-read-2][static]request.new': trampoline33,
  '[future-cancel-write-1][static]request.new': trampoline28,
  '[future-cancel-write-2][static]request.new': trampoline32,
  '[future-drop-readable-1][static]request.new': trampoline31,
  '[future-drop-readable-2][static]request.new': trampoline14,
  '[future-drop-writable-1][static]request.new': trampoline30,
  '[future-drop-writable-2][static]request.new': trampoline34,
  '[future-new-1][static]request.new': trampoline10,
  '[future-new-2][static]request.new': trampoline8,
  '[method]fields.copy-all': exports0['6'],
  '[method]request-options.set-between-bytes-timeout': exports0['10'],
  '[method]request-options.set-connect-timeout': exports0['8'],
  '[method]request-options.set-first-byte-timeout': exports0['9'],
  '[method]request.set-authority': exports0['14'],
  '[method]request.set-method': exports0['12'],
  '[method]request.set-path-with-query': exports0['15'],
  '[method]request.set-scheme': exports0['13'],
  '[method]response.get-headers': trampoline6,
  '[method]response.get-status-code': trampoline7,
  '[resource-drop]fields': trampoline15,
  '[resource-drop]request': trampoline16,
  '[resource-drop]request-options': trampoline12,
  '[resource-drop]response': trampoline17,
  '[static]fields.from-list': exports0['5'],
  '[static]request.new': exports0['11'],
  '[static]response.consume-body': exports0['7'],
  '[stream-cancel-read-0][static]request.new': trampoline26,
  '[stream-cancel-write-0][static]request.new': trampoline25,
  '[stream-drop-readable-0][static]request.new': trampoline13,
  '[stream-drop-writable-0][static]request.new': trampoline27,
  '[stream-new-0][static]request.new': trampoline9,
},
```

`exports0[N]` indices resolve through the core-module import object further
down the file (line 15606), e.g. `'5': trampoline52`, `'6': trampoline53`,
`'7': trampoline54`, `'8': trampoline55`, `'9': trampoline56`,
`'10': trampoline57`, `'11': trampoline58`, `'12': trampoline59`,
`'13': trampoline60`, `'14': trampoline61`, `'15': trampoline62`,
`'22': trampoline69`.

## Calls jco trampolines make on host-provided values

These are the actual JS method names the trampolines invoke on the classes the
shim must export. Each line is a verbatim grep from `http-client.js`:

```
 7567:  fn: () => rsc0.getHeaders()                    // Response.getHeaders
 7651:  fn: () => rsc0.getStatusCode()                 // Response.getStatusCode
 7717:  fn: () => new RequestOptions()                 // RequestOptions constructor (no args)
 8258:  fn: () => Fields.fromList(result2)             // Fields.fromList — static, returns Fields
 8402:  fn: () => rsc0.copyAll()                       // Fields.copyAll — returns list<tuple<string, list<u8>>>
 8685:  fn: () => Response.consumeBody(rsc0, futureResult3)
                                                       //   Response.consumeBody — static, returns [stream, futureValue]
 8824:  fn: () => rsc0.setConnectTimeout(variant3)     // RequestOptions
 8969:  fn: () => rsc0.setFirstByteTimeout(variant3)
 9114:  fn: () => rsc0.setBetweenBytesTimeout(variant3)
 9484:  fn: () => Request.new(rsc0, variant4, futureResult5, variant9)
                                                       //   Request.new — static; args: headers, body (option<stream>),
                                                       //   trailers (option<future<headers>>), options
 9639:  fn: () => rsc0.setMethod(variant4)             // Request
 9781:  fn: () => rsc0.setScheme(variant5)
 9898:  fn: () => rsc0.setAuthority(variant4)
10015:  fn: () => rsc0.setPathWithQuery(variant4)
10127:  fn: () => send(rsc0)                           // client.send — top-level, async (JSPI)
```

### `Response.consumeBody` shape (load-bearing for Task 7)

The trampoline at `_trampoline54` (line 8643) expects `consumeBody` to return a
tuple `[stream, futureValue]`. jco then probes the stream:

```js
let [tuple4_0, tuple4_1] = ret;
if (!(symbolAsyncIterator in tuple4_0)
&& !(symbolIterator in tuple4_0)
&& !(tuple4_0 instanceof _PlatformReadableStream)) {
  throw new Error('unrecognized stream object (no supported stream protocol)');
}
// then prefers asyncIterator over iterator over ReadableStream.getReader().
```

So the shim's `Response.consumeBody(rsc, _futureResult)` MUST return
`[asyncIterable<Uint8Array> | Iterable<Uint8Array> | ReadableStream, futureLikeValue]`.
The `_PlatformReadableStream` symbol is the platform's `ReadableStream`
(`globalThis.ReadableStream`), so returning `fetchResponse.body` from `fetch()`
satisfies it directly.

## What the shim must provide directly (via `http.js`)

- `client.send: async (request: Request) => Response` — host-async (JSPI), promoted by jco.
- `types.Fields` class with:
  - static `fromList(list<tuple<string, list<u8>>>) -> Fields`
  - instance `copyAll() -> list<tuple<string, list<u8>>>`
  - (other WIT methods like `get`, `has`, `set`, `delete`, `append`, `clone` are
    not invoked by *this* component but should be present for spec conformance)
- `types.Request` class with:
  - static `new(headers, body, trailers, options) -> Request`
  - instance setters: `setMethod`, `setScheme`, `setAuthority`, `setPathWithQuery`
  - (getters and `getOptions`/`getHeaders` not exercised here)
- `types.Response` class with:
  - instance `getHeaders() -> Fields`
  - instance `getStatusCode() -> u16`
  - static `consumeBody(response, futureTrailers) -> [body, futureValue]`
- `types.RequestOptions` class with:
  - constructor `new RequestOptions()` (no args)
  - instance `setConnectTimeout(option<duration>)`, `setFirstByteTimeout(...)`,
    `setBetweenBytesTimeout(...)`

## What jco emits and we don't have to provide

The following appear in the `wasi:http/types` instantiate map but jco wires
them to its own `trampolineNN` functions (resource-drop / stream-and-future
lifecycle), not to host-provided exports:

- All `[resource-drop]<type>` entries (`fields`, `request`, `request-options`, `response`)
- All `[stream-*]` / `[future-*]` lifecycle hooks attached to `[static]request.new`
  (cancel / drop / new / async-lower variants of stream-write-0, stream-read-0,
  future-write-1/2, future-read-1/2)
- `[constructor]request-options` is wrapped in `trampoline11` which calls
  `new RequestOptions()` — the shim only owes the class with a zero-arg constructor.

The full list of jco-supplied trampolines for `wasi:http/types` is the block
above — every entry whose value is `trampolineNN` rather than `exports0[N]`.
