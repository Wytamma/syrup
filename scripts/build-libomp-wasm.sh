#!/usr/bin/env bash
set -euo pipefail

LLVM_TAG="${LLVM_TAG:-llvmorg-21.1.8}"
LLVM_REPO="${LLVM_REPO:-https://github.com/llvm/llvm-project.git}"
LLVM_DIR="${LLVM_DIR:-build/llvm-project}"
BUILD_DIR="${LIBOMP_BUILD_DIR:-build/libomp-wasm}"
INSTALL_DIR="${LIBOMP_INSTALL_DIR:-build/libomp-wasm-install}"

for tool in git emcmake emmake cmake make; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool was not found. Run this through Pixi with: pixi run build-libomp" >&2
    exit 127
  fi
done

if [ ! -d "$LLVM_DIR/.git" ]; then
  mkdir -p "$(dirname "$LLVM_DIR")"
  git clone --depth 1 --branch "$LLVM_TAG" "$LLVM_REPO" "$LLVM_DIR"
fi

export CFLAGS="${CFLAGS:-} -pthread"
export CXXFLAGS="${CXXFLAGS:-} -pthread"


# https://github.com/abrown/wasm-openmp-examples
emcmake cmake \
  -S "$LLVM_DIR/openmp" \
  -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$INSTALL_DIR" \
  -DOPENMP_STANDALONE_BUILD=ON \
  -DOPENMP_ENABLE_OMPT_TOOLS=OFF \
  -DOPENMP_ENABLE_LIBOMPTARGET=OFF \
  -DLIBOMP_HAVE_OMPT_SUPPORT=OFF \
  -DLIBOMP_OMPT_SUPPORT=OFF \
  -DLIBOMP_OMPD_SUPPORT=OFF \
  -DLIBOMP_USE_DEBUGGER=OFF \
  -DLIBOMP_FORTRAN_MODULES=OFF \
  -DLIBOMP_ENABLE_SHARED=OFF \
  -DLIBOMP_ARCH=wasm32 \
  -DOPENMP_ENABLE_LIBOMPTARGET_PROFILING=OFF

emmake make -C "$BUILD_DIR" -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
emmake make -C "$BUILD_DIR" install

LIBOMP_A="$(find "$INSTALL_DIR" "$BUILD_DIR" -name libomp.a -print -quit)"
if [ -z "$LIBOMP_A" ]; then
  echo "libomp.a was not produced under $BUILD_DIR" >&2
  exit 1
fi

echo "$LIBOMP_A"
