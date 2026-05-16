# WIT dependencies

`deps/` is **not** committed — it is fetched from package registries by
[`wkg`](https://github.com/bytecodealliance/wasm-pkg-tools) and pinned by
`../wkg.lock`. Populate (or refresh) it with:

```sh
npm run sync-wit
```

which runs `wkg wit fetch` against the registries in `../wkg-registry.toml`
(`act:*` → actcore.dev, `wasi:*` → wasi.dev), resolving the full dependency
graph of `host-view.wit`. Run this once after cloning, before `npm run build`.

`host-view.wit` is local to this repo — a tiny synthetic world that drives
`jco types` codegen so TypeScript users get strongly-typed `ToolProvider` /
`SessionProvider` clients, and so the WASI shim implementations are typed
against the same interfaces. It is **not** implemented by any wasm component;
it exists purely for build-time type generation. Its imports are the single
source of truth for which packages `wkg` fetches.
