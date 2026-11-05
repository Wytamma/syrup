import { access } from 'node:fs/promises'

const repoRoot = new URL('../../../', import.meta.url)
const required = [
  'public/cmaple-threaded.js',
  'public/cmaple-threaded.wasm',
  'packages/maple-wasm/LICENSE',
]

for (const file of required) {
  try {
    await access(new URL(file, repoRoot))
  } catch {
    throw new Error(
      `Missing ${file}. Run \`pixi run build-wasm\` before packaging @wytamma/maple-wasm.`,
    )
  }
}
