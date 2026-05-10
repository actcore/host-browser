#!/usr/bin/env bash
# Sync vendored WIT from a local act-spec checkout.
# Falls back to fetching from GitHub if no local checkout is present.
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="wit/deps"

# Try local sibling checkout first
for candidate in \
  "../act-spec/wit" \
  "../../act-spec/wit"; do
  if [ -d "$candidate" ]; then
    echo "Syncing WIT from $candidate"
    rm -rf "$DEST"
    mkdir -p "$DEST"
    cp -r "$candidate/act-core"     "$DEST/"
    cp -r "$candidate/act-tools"    "$DEST/"
    cp -r "$candidate/act-sessions" "$DEST/"
    exit 0
  fi
done

# Otherwise pull from GitHub
echo "No local act-spec checkout found; fetching from GitHub"
TMP=$(mktemp -d)
trap "rm -rf '$TMP'" EXIT
git clone --depth 1 https://github.com/actcore/act-spec "$TMP/act-spec"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$TMP/act-spec/wit/act-core"     "$DEST/"
cp -r "$TMP/act-spec/wit/act-tools"    "$DEST/"
cp -r "$TMP/act-spec/wit/act-sessions" "$DEST/"
echo "Synced WIT to $DEST"
