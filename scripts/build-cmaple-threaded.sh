#!/usr/bin/env bash
set -euo pipefail

if ! command -v em++ >/dev/null 2>&1; then
  echo "em++ was not found. Install and activate Emscripten before running this script." >&2
  echo "Example: source /path/to/emsdk/emsdk_env.sh" >&2
  exit 127
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PINNED_BINARYEN_ROOT="${PROJECT_ROOT}/.tools/binaryen-version_123"
if [ -x "${PINNED_BINARYEN_ROOT}/bin/wasm-opt" ]; then
  export EM_BINARYEN_ROOT="${EM_BINARYEN_ROOT:-${PINNED_BINARYEN_ROOT}}"
fi

LIBOMP_A="${LIBOMP_A:-build/libomp-wasm-install/lib/libomp.a}"
if [ ! -f "$LIBOMP_A" ]; then
  bash scripts/build-libomp-wasm.sh
fi
if [ ! -f "$LIBOMP_A" ]; then
  LIBOMP_A="$(find build/libomp-wasm-install build/libomp-wasm -name libomp.a -print -quit)"
fi
if [ -z "${LIBOMP_A:-}" ] || [ ! -f "$LIBOMP_A" ]; then
  echo "libomp.a was not found. Run: pixi run build-libomp" >&2
  exit 1
fi

LIBOMP_INCLUDE_DIR="${LIBOMP_INCLUDE_DIR:-$(dirname "$(dirname "$LIBOMP_A")")/include}"
CMAPLE_COMPILE_OPT_LEVEL="${CMAPLE_COMPILE_OPT_LEVEL:--O3}"
CMAPLE_LINK_OPT_LEVEL="${CMAPLE_LINK_OPT_LEVEL:--O3}"
CMAPLE_SIMD_FLAG="${CMAPLE_SIMD_FLAG:--msimd128}"
OBJECT_DIR="${CMAPLE_OBJECT_DIR:-build/cmaple-wasm-objects}"
# 1.5 GiB avoids repeated WASM heap growth on larger benchmark alignments.
CMAPLE_INITIAL_MEMORY_BYTES="${CMAPLE_INITIAL_MEMORY_BYTES:-1610612736}"
CMAPLE_MAXIMUM_MEMORY_BYTES="${CMAPLE_MAXIMUM_MEMORY_BYTES:-2147483648}"
CMAPLE_PROFILE_LOGS="${CMAPLE_PROFILE_LOGS:-0}"

sources=(
  src/wasm/cmaple_wasm.cpp
  vendor/cmaple/alignment/mutation.cpp
  vendor/cmaple/alignment/seqregion.cpp
  vendor/cmaple/alignment/seqregions.cpp
  vendor/cmaple/alignment/seqregionsmem.cpp
  vendor/cmaple/alignment/sequence.cpp
  vendor/cmaple/alignment/alignment.cpp
  vendor/cmaple/model/model.cpp
  vendor/cmaple/model/modelbase.cpp
  vendor/cmaple/model/model_dna.cpp
  vendor/cmaple/model/model_aa.cpp
  vendor/cmaple/model/model_dna_rate_variation.cpp
  vendor/cmaple/tree/tree.cpp
  vendor/cmaple/tree/updatingnode.cpp
  vendor/cmaple/tree/traversingnode.cpp
  vendor/cmaple/tree/phylonode.cpp
  vendor/cmaple/utils/tools.cpp
  vendor/cmaple/utils/operatingsystem.cpp
  vendor/cmaple/libraries/ncl/nxsblock.cpp
  vendor/cmaple/libraries/ncl/nxsexception.cpp
  vendor/cmaple/libraries/ncl/nxsreader.cpp
  vendor/cmaple/libraries/ncl/nxsstring.cpp
  vendor/cmaple/libraries/ncl/nxstoken.cpp
  vendor/cmaple/libraries/nclextra/modelsblock.cpp
)

common_flags=(
  -std=c++20
  -DNDEBUG
  -DNUM_STATES=4
  -pthread
  -fopenmp=libomp
  -fexceptions
  "$CMAPLE_SIMD_FLAG"
  -I src/wasm
  -I vendor/cmaple
  -I vendor/cmaple/libraries/SIMDe
  -I "$LIBOMP_INCLUDE_DIR"
  -Wno-nullability-completeness
  -Wno-deprecated-declarations
  -Wno-error=date-time
)

if [ "$CMAPLE_PROFILE_LOGS" = "1" ]; then
  common_flags+=(-DCMAPLE_WASM_PROFILE_LOGS=1)
fi

mkdir -p public "$OBJECT_DIR"

objects=()
for index in "${!sources[@]}"; do
  source="${sources[$index]}"
  object="$OBJECT_DIR/${index}_$(basename "${source%.cpp}").o"
  objects+=("$object")
  if [ ! -f "$object" ] || [ "$source" -nt "$object" ] || [ "$0" -nt "$object" ]; then
    em++ "${common_flags[@]}" "$CMAPLE_COMPILE_OPT_LEVEL" -c "$source" -o "$object"
  fi
done

em++ \
  "$CMAPLE_LINK_OPT_LEVEL" \
  -pthread \
  -fopenmp=libomp \
  "${objects[@]}" \
  "$LIBOMP_A" \
  -sUSE_PTHREADS=1 \
  -sPTHREAD_POOL_SIZE=navigator.hardwareConcurrency \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createCmapleThreadedModule \
  -sENVIRONMENT=web,worker \
  -sNO_EXIT_RUNTIME=1 \
  -sDISABLE_EXCEPTION_CATCHING=0 \
  -sASSERTIONS=0 \
  -sINITIAL_MEMORY="$CMAPLE_INITIAL_MEMORY_BYTES" \
  -sALLOW_MEMORY_GROWTH=1 \
  -sMAXIMUM_MEMORY="$CMAPLE_MAXIMUM_MEMORY_BYTES" \
  -sEXPORTED_FUNCTIONS='["_cmaple_alloc","_cmaple_free","_cmaple_release","_cmaple_analyze","_cmaple_infer","_cmaple_infer_loaded","_cmaple_warning_summary","_cmaple_export_maple"]' \
  -sEXPORTED_RUNTIME_METHODS='["HEAPU8"]' \
  -o public/cmaple-threaded.js
