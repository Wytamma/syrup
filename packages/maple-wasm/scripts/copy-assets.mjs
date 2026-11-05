import { copyFile, mkdir } from 'node:fs/promises'

const repoRoot = new URL('../../../', import.meta.url)
const dist = new URL('../dist/', import.meta.url)

await mkdir(dist, { recursive: true })

const artifacts = ['cmaple-threaded.js', 'cmaple-threaded.wasm']
for (const artifact of artifacts) {
  await copyFile(new URL(`public/${artifact}`, repoRoot), new URL(artifact, dist))
}


console.log(`Copied ${artifacts.join(', ')} into ${dist.pathname}`)
