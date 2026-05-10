# WIT vendored from act-spec

`deps/` contains a snapshot of the relevant interfaces from
[actcore/act-spec](https://github.com/actcore/act-spec). Update with:

```sh
pnpm run sync-wit
```

(see `scripts/sync-wit.sh`)

`host-view.wit` is local to this repo — a tiny synthetic world that drives
`jco types` codegen so TypeScript users get strongly-typed `ToolProvider` /
`SessionProvider` clients. It is **not** implemented by any wasm component;
it exists purely for build-time type generation.
