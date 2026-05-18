#!/usr/bin/env bash
set -euo pipefail

VERSION="${BINARYEN_VERSION:-123}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_ROOT="${PROJECT_ROOT}/.tools/binaryen-version_${VERSION}"
WASM_OPT="${INSTALL_ROOT}/bin/wasm-opt"

if [[ -x "${WASM_OPT}" ]] && [[ "$("${WASM_OPT}" --version)" == wasm-opt\ version\ ${VERSION}* ]]; then
  echo "Binaryen ${VERSION} already installed at ${INSTALL_ROOT}"
  exit 0
fi

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)
    ASSET="binaryen-version_${VERSION}-arm64-macos.tar.gz"
    ;;
  Darwin-x86_64)
    ASSET="binaryen-version_${VERSION}-x86_64-macos.tar.gz"
    ;;
  Linux-aarch64 | Linux-arm64)
    ASSET="binaryen-version_${VERSION}-aarch64-linux.tar.gz"
    ;;
  Linux-x86_64)
    ASSET="binaryen-version_${VERSION}-x86_64-linux.tar.gz"
    ;;
  *)
    echo "Unsupported platform for Binaryen ${VERSION}: $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac

URL="https://github.com/WebAssembly/binaryen/releases/download/version_${VERSION}/${ASSET}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "Installing Binaryen ${VERSION} from ${URL}"
curl --fail --location --show-error --output "${TMP_DIR}/${ASSET}" "${URL}"

rm -rf "${INSTALL_ROOT}"
mkdir -p "$(dirname "${INSTALL_ROOT}")"
tar -xzf "${TMP_DIR}/${ASSET}" -C "${TMP_DIR}"
mv "${TMP_DIR}/binaryen-version_${VERSION}" "${INSTALL_ROOT}"

if [[ "$("${WASM_OPT}" --version)" != wasm-opt\ version\ ${VERSION}* ]]; then
  echo "Installed wasm-opt did not report Binaryen ${VERSION}" >&2
  exit 1
fi

echo "Binaryen ${VERSION} installed at ${INSTALL_ROOT}"
