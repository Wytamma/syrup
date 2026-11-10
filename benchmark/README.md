# syrup benchmark

Standalone benchmark suite for the published
[`@wytamma/maple-wasm`](https://www.npmjs.com/package/@wytamma/maple-wasm/v/0.1.1)
package (pinned to `0.1.1`) and the CMAPLE CLI.

The WASM package targets the browser, so each run is executed by
`wasm_runner.mjs`, which serves the package's `dist/` directory and the
alignment over a cross-origin-isolated local HTTP server and drives headless
Chrome directly. There is no Playwright or other browser-automation
dependency: the page imports the package and calls `MapleRuntime` itself.

## Benchmarks

| Command | Question | Method |
| --- | --- | --- |
| `equivalence` | Does syrup produce the same result as the CMAPLE CLI? | Run every alignment in `syrup-datasets/` with both engines. Report `log likelihood` delta and Robinson-Foulds distance. |
| `scale` | How does compute time scale with dataset size and divergence? | Simulate datasets with msprime at four mutation rates and sample counts centred on the reference alignment (5,818 samples x 29,903 sites). Report parse/inference time. |
| `threads` | How does thread count affect run time? | Run the reference alignment (`alignment_filtered2_masked3_subExample.maple`) with 1-8 threads on both engines. Report wall time and speedup. |

Branch support is disabled (`none`) in all three benchmarks because it
changes neither the log likelihood nor the topology, and it dominates run
time. The equivalence benchmark uses eight threads for both engines; the
thread benchmark fixes the dataset so only the thread count varies.

## Setup

Requirements: `pixi`, `npm`, and Chrome or Chromium. On macOS/Linux the
runner finds the standard application paths; otherwise set `CHROME_BIN`.

```sh
# Clone the submodule (cmaple)
git submodule update --init --recursive 

cd benchmark

# Python environment (msprime, tskit, dendropy, node)
pixi install --manifest-path pixi.toml

# Published package under test
pixi run npm install

# CMAPLE CLI (built from ../vendor/cmaple)
pixi run bash build_cmaple_cli.sh
```

`build_cmaple_cli.sh` accepts an alternative build directory, job count, and
output path (`CMAPLE_SOURCE` selects another source tree). Pass
`--cmaple PATH` to `run.py` to use a different binary.

## Running

```sh
pixi run equivalence
pixi run scale
pixi run threads
pixi run all
```

```sh
CHROME_BIN=/home/wwirth/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome pixi run all
```

Or call the script directly:

```sh
pixi run --manifest-path pixi.toml python run.py all
```

Useful overrides:

```sh
# One dataset, one thread
python run.py equivalence --datasets alignment_filtered2_masked3_subExample --threads 1

# Quick scale sweep
python run.py scale --sample-counts 100 500 --rates 1e-5 1e-4 --sequence-length 2000

# Thread sweep with two replicates
python run.py threads --thread-list 1 2 4 8 --repeats 2

# Re-run everything instead of reusing cached outputs
python run.py all --force
```

Results are cached: existing metrics JSON and tree files are reused unless
`--force` is given. Simulations are cached the same way under `work/`.

## Outputs

All results are TSV, written under `results/`:

| File | Contents |
| --- | --- |
| `equivalence/equivalence.tsv` | Per-dataset, per-replicate comparison: both log likelihoods, delta, RF and normalized RF. |
| `equivalence/equivalence-summary.tsv` | Per-dataset means and maxima, including mean inference time for each engine. |
| `scale/scale.tsv` | One row per (sample count, mutation rate, seed): simulated divergence, variable sites, parse/inference/wall seconds, log likelihood. |
| `scale/scale-summary.tsv` | Per (sample count, mutation rate): mean divergence and variable sites, median inference time across seeds. |
| `threads/threads.tsv` | One row per (tool, thread count, replicate): wall seconds, inference milliseconds, log likelihood. |
| `threads/threads-summary.tsv` | Median inference time, speedup vs one thread, and parallel efficiency. |

Logs, tree files, and the raw metrics JSON for each run live alongside the
TSVs.

Normalized RF is the symmetric difference of unrooted bipartitions divided by
`2 * (n - 3)`; zero-length internal edges are collapsed first. Log-likelihood
delta is `wasm - cli`.

Summaries compare inference time only. For the CLI, `infer_seconds` is the
`Runtime:` value CMAPLE reports in its log (it excludes process startup); for
WASM it is `infer_ms`, measured around `alignment.infer` and excluding Chrome
launch, runtime load, and parse. Raw `wall_seconds` remains in the detail TSVs
for audit. Run-to-run variance on a laptop is routinely 10-20%, so summaries
use the median of three replicates rather than a single run.

Thread scaling saturates once the requested threads occupy every core: the
browser, compositor, and OS still need CPU. On an 8-core (6 performance +
2 efficiency) machine, 7-8 threads are at or past saturation, so the curve
flattens and single-run noise can make 8 look slower than 7. Record
`hardwareConcurrency` and use `--thread-list` to extend the sweep on a
larger machine.

## Configuration

`config.json` holds dataset paths, thread counts, and the scale sweep:

- `scale.sample_counts`: `[50, 500, 5000, 50000]` — decade steps at the
  reference sequence length of 29,903.
- `scale.rates`: `[1e-6, 3e-6, 1e-5, 3e-5]` mutations per site per
  generation, which spans roughly 0.04%-1.2% maximum divergence with
  `n_eff = 100`. The reference dataset averages about 0.18% divergence.
- `scale.replicates`: `3`. Each replicate uses a different seed; realised
  TMRCA varies between simulations, so the summary reports the median
  inference time across seeds.
- `threads_benchmark.threads`: `1..8`.
