#!/usr/bin/env bash
set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$BENCH_DIR")"
SOURCE_DIR="${CMAPLE_SOURCE:-$REPO_ROOT/vendor/cmaple}"
BUILD_DIR="${1:-$BENCH_DIR/build/cmake}"
JOBS="${2:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"
OUTPUT="${3:-$BENCH_DIR/build/cmaple}"

if [ ! -d "$SOURCE_DIR" ]; then
  echo "CMAPLE source not found at $SOURCE_DIR. Set CMAPLE_SOURCE." >&2
  exit 1
fi

macos_version="0"
macos_major_version="0"
if command -v sw_vers >/dev/null 2>&1; then
  macos_version="$(sw_vers -productVersion)"
  macos_major_version="${macos_version%%.*}"
fi

cmake -S "$SOURCE_DIR" -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DINSTALL_CMAPLE=OFF \
  -DMACOS_MAJOR_VERSION="$macos_major_version" \
  -DMACOS_VERSION="$macos_version"
cmake --build "$BUILD_DIR" --target cmaple -j "$JOBS"

mkdir -p "$(dirname "$OUTPUT")"
cp "$BUILD_DIR/cmaple" "$OUTPUT"
test -x "$OUTPUT"
echo "CMAPLE CLI written to $OUTPUT"
