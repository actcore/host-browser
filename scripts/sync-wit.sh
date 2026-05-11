#!/usr/bin/env bash
# Sync vendored WIT.
#   - ACT WITs (act-core, act-tools, act-sessions) come from act-spec, with a
#     local sibling checkout preferred and a GitHub clone as fallback.
#   - wasip3 WITs (wasi:http, wasi:clocks) come from bytecodealliance/wasi-rs,
#     pinned to `main` for now (switch to a tag in Phase 3 once they ship one).
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="wit/deps"

sync_act_wit() {
  # Try local sibling checkout first
  for candidate in \
    "../act-spec/wit" \
    "../../act-spec/wit"; do
    if [ -d "$candidate" ]; then
      echo "Syncing ACT WIT from $candidate"
      rm -rf "$DEST/act-core" "$DEST/act-tools" "$DEST/act-sessions"
      mkdir -p "$DEST"
      cp -r "$candidate/act-core"     "$DEST/"
      cp -r "$candidate/act-tools"    "$DEST/"
      cp -r "$candidate/act-sessions" "$DEST/"
      return 0
    fi
  done

  # Otherwise pull from GitHub
  echo "No local act-spec checkout found; fetching ACT WIT from GitHub"
  local tmp
  tmp=$(mktemp -d)
  trap "rm -rf '$tmp'" RETURN
  git clone --depth 1 https://github.com/actcore/act-spec "$tmp/act-spec"
  rm -rf "$DEST/act-core" "$DEST/act-tools" "$DEST/act-sessions"
  mkdir -p "$DEST"
  cp -r "$tmp/act-spec/wit/act-core"     "$DEST/"
  cp -r "$tmp/act-spec/wit/act-tools"    "$DEST/"
  cp -r "$tmp/act-spec/wit/act-sessions" "$DEST/"
  echo "Synced ACT WIT to $DEST"
}

sync_wasip3_wit() {
  # wasip3 WASI WITs from bytecodealliance/wasi-rs. http.wit pulls clocks.wit
  # (duration) and cli.wit (stderr/stdin types); cli.wit pulls filesystem,
  # random, and sockets. Vendor whatever the WIT graph transitively needs for
  # `jco types` to resolve. Source:
  #   github.com/bytecodealliance/wasi-rs/tree/main/crates/wasip3/wit/deps
  local raw="https://raw.githubusercontent.com/bytecodealliance/wasi-rs/main/crates/wasip3/wit/deps"
  local pkg
  for pkg in http clocks cli filesystem random sockets; do
    mkdir -p "$DEST/wasi-${pkg}-p3"
    curl -fsSL "$raw/${pkg}.wit" -o "$DEST/wasi-${pkg}-p3/${pkg}.wit"
  done
  echo "Synced wasip3 WIT from bytecodealliance/wasi-rs (pinned: main)"
}

sync_act_wit
sync_wasip3_wit
