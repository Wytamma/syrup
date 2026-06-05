#!/usr/bin/env bash
set -euo pipefail

build_dir="${1:-benchmark/build/cmaple-cli}"
jobs="${2:-4}"

macos_version="0"
macos_major_version="0"
if command -v sw_vers >/dev/null 2>&1; then
  macos_version="$(sw_vers -productVersion)"
  macos_major_version="${macos_version%%.*}"
fi

mkdir -p "$build_dir"
cmake -S vendor/cmaple -B "$build_dir" \
  -DCMAKE_BUILD_TYPE=Release \
  -DINSTALL_CMAPLE=OFF \
  -DMACOS_MAJOR_VERSION="$macos_major_version" \
  -DMACOS_VERSION="$macos_version"
cmake --build "$build_dir" --target cmaple -j "$jobs"
test -x "$build_dir/cmaple"
