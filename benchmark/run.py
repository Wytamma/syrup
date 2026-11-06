#!/usr/bin/env python3
"""Standalone benchmarks for syrup's phylogenetic inference.

Three benchmarks are provided:

``equivalence``
    Run every real-world alignment in ``syrup-datasets`` with both the CMAPLE
    CLI and the published ``@wytamma/maple-wasm`` package, then report the
    log-likelihood delta and the Robinson-Foulds distance between the trees.

``scale``
    Simulate alignments with msprime at four mutation rates and dataset sizes
    centred on the reference alignment (5,818 samples x 29,903 sites), and
    report how inference time scales.

``threads``
    Run the reference alignment with 1-8 threads using both the CMAPLE CLI and
    ``@wytamma/maple-wasm``, and report wall time and speedup.

Results are written as TSV files under ``results/``. WASM runs use headless
Chrome directly (see ``wasm_runner.mjs``); no browser automation library is
involved.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from statistics import mean, median

import dendropy
from dendropy.calculate import treecompare

ROOT = Path(__file__).resolve().parent
PACKAGE_DIST = ROOT / "node_modules" / "@wytamma" / "maple-wasm" / "dist"
CLI_LL_RE = re.compile(
    r"Tree log likelihood:\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)"
)
DATASET_EXTENSIONS = (".maple", ".fa", ".fasta", ".fna", ".phy", ".phylip")

DEFAULTS = {
    "cmaple": "build/cmaple",
    "node": "node",
    "datasets_dir": "syrup-datasets",
    "results_dir": "results",
    "work_dir": "work",
    "threads": 8,
    "timeout_seconds": 3600,
    "branch_support_replicates": 1000,
    "equivalence": {"repeats": 1, "branch_support": "none"},
    "scale": {
        "sample_counts": [1455, 2909, 5818, 11636],
        "sequence_length": 29903,
        "rates": [1e-6, 3e-6, 1e-5, 3e-5],
        "n_eff": 100,
        "seed": 42,
        "threads": 8,
        "min_variable_sites": 1,
        "max_attempts": 100,
    },
    "threads_benchmark": {
        "dataset": "syrup-datasets/alignment_filtered2_masked3_subExample.maple",
        "threads": [1, 2, 3, 4, 5, 6, 7, 8],
        "repeats": 3,
        "branch_support": "none",
    },
}


# ---------------------------------------------------------------------------
# Configuration and I/O helpers
# ---------------------------------------------------------------------------


def deep_update(base: dict, override: dict) -> dict:
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            deep_update(base[key], value)
        else:
            base[key] = value
    return base


def load_config(path: Path) -> dict:
    config = json.loads(path.read_text())
    return deep_update(json.loads(json.dumps(DEFAULTS)), config)


def bench_path(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def detect_format(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".maple":
        return "MAPLE"
    if suffix in {".fa", ".fasta", ".fna"}:
        return "FASTA"
    if suffix in {".phy", ".phylip"}:
        return "PHYLIP"
    return "FASTA"


def fmt(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return f"{value:.10g}"
    return str(value)


def write_tsv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("")
        return
    fieldnames: list[str] = []
    for row in rows:
        for key in row:
            if key not in fieldnames:
                fieldnames.append(key)
    lines = ["\t".join(fieldnames)]
    for row in rows:
        lines.append("\t".join(fmt(row.get(key)) for key in fieldnames))
    path.write_text("\n".join(lines) + "\n")


def log(message: str) -> None:
    print(message, flush=True)


def short_error(error: Exception) -> str:
    return str(error).strip().splitlines()[0][:300]


def discover_datasets(config: dict, selected: list[str] | None) -> list[Path]:
    dataset_dir = bench_path(config["datasets_dir"])
    paths: list[Path] = []
    for extension in DATASET_EXTENSIONS:
        paths.extend(dataset_dir.glob(f"*{extension}"))
    paths = sorted(set(paths))
    if selected:
        wanted = {name.lower() for name in selected}
        paths = [path for path in paths if path.stem.lower() in wanted]
    return paths


def verify_wasm(config: dict) -> None:
    if not (PACKAGE_DIST / "index.js").exists():
        raise SystemExit(
            f"{PACKAGE_DIST} is missing. Run `npm install` in {ROOT} first."
        )


def verify_cmaple(config: dict) -> None:
    cmaple = bench_path(config["cmaple"])
    if not cmaple.exists():
        raise SystemExit(
            f"CMAPLE CLI not found at {cmaple}. Build it with "
            "`bash benchmark/build_cmaple_cli.sh` or pass --cmaple."
        )


# ---------------------------------------------------------------------------
# Running the two inference engines
# ---------------------------------------------------------------------------


def cli_branch_support_args(method: str, replicates: int) -> list[str]:
    if method == "sprta":
        return ["--sprta"]
    if method == "sh-alrt":
        return ["--alrt", "--replicates", str(replicates)]
    if method in {"none", ""}:
        return []
    raise ValueError(f"Unsupported branch support method: {method}")


def run_cli(
    config: dict,
    dataset: Path,
    metrics_path: Path,
    tree_path: Path,
    threads: int,
    branch_support: str,
    replicates: int,
    force: bool,
) -> dict:
    if metrics_path.exists() and tree_path.exists() and not force:
        return json.loads(metrics_path.read_text())

    cmaple = bench_path(config["cmaple"])
    metrics_path.parent.mkdir(parents=True, exist_ok=True)
    tree_path.parent.mkdir(parents=True, exist_ok=True)
    prefix = tree_path.with_suffix("")
    log_path = metrics_path.with_suffix(".stdout.log")
    command = [
        str(cmaple),
        "-aln",
        str(dataset),
        "--format",
        detect_format(dataset),
        "-nt",
        str(threads),
        "--prefix",
        str(prefix),
        "--overwrite",
        *cli_branch_support_args(branch_support, replicates),
    ]

    started = time.perf_counter()
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=config.get("timeout_seconds", 3600),
    )
    wall_seconds = time.perf_counter() - started
    log_path.write_text(completed.stdout + completed.stderr)

    match = CLI_LL_RE.search(completed.stdout) or CLI_LL_RE.search(completed.stderr)
    status = "ok" if completed.returncode == 0 and tree_path.exists() else "error"
    metrics = {
        "tool": "cli",
        "dataset": str(dataset),
        "threads": threads,
        "branch_support": branch_support,
        "status": status,
        "returncode": completed.returncode,
        "wall_seconds": wall_seconds,
        "log_likelihood": float(match.group(1)) if match else None,
        "tree": str(tree_path),
        "log": str(log_path),
        "command": command,
    }
    metrics_path.write_text(json.dumps(metrics, indent=2) + "\n")
    return metrics


def run_wasm(
    config: dict,
    dataset: Path,
    metrics_path: Path,
    newick_path: Path,
    threads: int,
    branch_support: str,
    replicates: int,
    force: bool,
) -> dict:
    if metrics_path.exists() and newick_path.exists() and not force:
        return json.loads(metrics_path.read_text())

    metrics_path.parent.mkdir(parents=True, exist_ok=True)
    newick_path.parent.mkdir(parents=True, exist_ok=True)
    log_path = metrics_path.with_suffix(".runner.log")
    timeout = int(config.get("timeout_seconds", 3600))
    command = [
        config.get("node", "node"),
        str(ROOT / "wasm_runner.mjs"),
        "--dataset",
        str(dataset),
        "--threads",
        str(threads),
        "--format",
        "auto",
        "--branch-support",
        branch_support,
        "--branch-support-replicates",
        str(replicates),
        "--tree-search",
        "normal",
        "--out-json",
        str(metrics_path),
        "--out-newick",
        str(newick_path),
        "--timeout-seconds",
        str(timeout),
    ]
    completed = subprocess.run(
        command, capture_output=True, text=True, timeout=timeout + 120
    )
    log_path.write_text(completed.stdout + completed.stderr)
    if completed.returncode != 0 or not metrics_path.exists():
        message = (completed.stderr or completed.stdout).strip()
        lines = [line for line in message.splitlines() if "WASM_RUNNER_ERROR" in line]
        detail = lines[-1] if lines else (message.splitlines()[-1] if message else "no output")
        raise RuntimeError(f"maple-wasm run failed for {dataset.name}: {detail}")
    return json.loads(metrics_path.read_text())


# ---------------------------------------------------------------------------
# Tree comparison
# ---------------------------------------------------------------------------


def collapse_zero_length_internal_edges(
    tree: dendropy.Tree, epsilon: float = 1e-12
) -> int:
    collapsed = 0
    for edge in list(tree.postorder_edge_iter()):
        if edge.tail_node is None or edge.head_node is None:
            continue
        if edge.head_node.is_leaf():
            continue
        if edge.length is not None and abs(edge.length) <= epsilon:
            edge.collapse()
            collapsed += 1
    return collapsed


def compare_trees(cli_tree_path: Path, wasm_tree_path: Path) -> dict:
    taxa = dendropy.TaxonNamespace()
    cli_tree = dendropy.Tree.get(
        path=str(cli_tree_path),
        schema="newick",
        taxon_namespace=taxa,
        preserve_underscores=True,
        rooting="force-unrooted",
    )
    wasm_tree = dendropy.Tree.get(
        path=str(wasm_tree_path),
        schema="newick",
        taxon_namespace=taxa,
        preserve_underscores=True,
        rooting="force-unrooted",
    )

    for tree in (cli_tree, wasm_tree):
        for node in tree:
            if not node.is_leaf():
                node.label = None

    cli_labels = {leaf.taxon.label for leaf in cli_tree.leaf_node_iter()}
    wasm_labels = {leaf.taxon.label for leaf in wasm_tree.leaf_node_iter()}
    common_labels = cli_labels & wasm_labels
    if len(common_labels) < 4:
        raise ValueError("Need at least 4 common taxa for an RF comparison.")

    cli_tree.retain_taxa_with_labels(common_labels)
    wasm_tree.retain_taxa_with_labels(common_labels)
    cli_collapsed = collapse_zero_length_internal_edges(cli_tree)
    wasm_collapsed = collapse_zero_length_internal_edges(wasm_tree)

    for tree in (cli_tree, wasm_tree):
        for node in tree:
            node.edge.length = None
        tree.encode_bipartitions()

    false_positives, false_negatives = treecompare.false_positives_and_negatives(
        cli_tree, wasm_tree
    )
    rf = false_positives + false_negatives
    denominator = 2 * (len(common_labels) - 3)
    normalized_rf = rf / denominator if denominator > 0 else 0.0

    return {
        "common_taxa": len(common_labels),
        "rf": rf,
        "normalized_rf": normalized_rf,
        "rf_false_positives": false_positives,
        "rf_false_negatives": false_negatives,
        "cli_zero_length_internal_edges_collapsed": cli_collapsed,
        "wasm_zero_length_internal_edges_collapsed": wasm_collapsed,
    }


# ---------------------------------------------------------------------------
# Benchmark 1: CLI equivalence
# ---------------------------------------------------------------------------


def benchmark_equivalence(config: dict, args: argparse.Namespace) -> None:
    eq_config = config["equivalence"]
    repeats = args.repeats if args.repeats is not None else int(eq_config["repeats"])
    threads = args.threads if args.threads is not None else int(config["threads"])
    branch_support = args.branch_support or eq_config.get("branch_support", "none")
    replicates = int(config["branch_support_replicates"])

    datasets = discover_datasets(config, args.datasets)
    if not datasets:
        raise SystemExit("No datasets found.")
    verify_cmaple(config)
    verify_wasm(config)

    out_dir = bench_path(config["results_dir"]) / "equivalence"
    rows: list[dict] = []

    for dataset in datasets:
        log(f"[equivalence] {dataset.name}")
        for replicate in range(1, repeats + 1):
            row = {
                "benchmark": "equivalence",
                "dataset": dataset.stem,
                "replicate": replicate,
                "threads": threads,
            }
            cli_metrics_path = out_dir / "cli" / dataset.stem / f"rep-{replicate}.json"
            cli_tree = out_dir / "cli" / dataset.stem / f"rep-{replicate}.treefile"
            wasm_metrics_path = out_dir / "wasm" / dataset.stem / f"rep-{replicate}.json"
            wasm_tree = out_dir / "wasm" / dataset.stem / f"rep-{replicate}.nwk"

            cli_metrics = None
            wasm_metrics = None
            try:
                cli_metrics = run_cli(
                    config,
                    dataset,
                    cli_metrics_path,
                    cli_tree,
                    threads,
                    branch_support,
                    replicates,
                    args.force,
                )
                row["cli_status"] = cli_metrics["status"]
                row["cli_log_likelihood"] = cli_metrics.get("log_likelihood")
                row["cli_wall_seconds"] = cli_metrics.get("wall_seconds")
            except Exception as error:  # noqa: BLE001 - recorded per run
                row["cli_status"] = "error"
                row["error"] = short_error(error)
                log(f"[equivalence]   CLI failed: {short_error(error)}")

            try:
                wasm_metrics = run_wasm(
                    config,
                    dataset,
                    wasm_metrics_path,
                    wasm_tree,
                    threads,
                    branch_support,
                    replicates,
                    args.force,
                )
                row["wasm_status"] = "ok"
                row["wasm_log_likelihood"] = wasm_metrics.get("log_likelihood")
                row["wasm_wall_seconds"] = wasm_metrics.get("wall_seconds")
                row["wasm_infer_ms"] = wasm_metrics.get("infer_ms")
                row["wasm_package_version"] = wasm_metrics.get("package_version")
                stats = wasm_metrics.get("stats") or {}
                row["sample_count"] = stats.get("sequenceCount")
                row["sequence_length"] = stats.get("sequenceLength")
            except Exception as error:  # noqa: BLE001
                row["wasm_status"] = "error"
                row["error"] = short_error(error)
                log(f"[equivalence]   wasm failed: {short_error(error)}")

            if (
                row.get("cli_status") == "ok"
                and row.get("wasm_status") == "ok"
                and row.get("cli_log_likelihood") is not None
                and row.get("wasm_log_likelihood") is not None
            ):
                delta = row["wasm_log_likelihood"] - row["cli_log_likelihood"]
                row["delta_log_likelihood"] = delta
                row["abs_delta_log_likelihood"] = abs(delta)
                try:
                    row.update(compare_trees(cli_tree, wasm_tree))
                except Exception as error:  # noqa: BLE001
                    row["rf_status"] = "error"
                    row["rf_error"] = short_error(error)
                    log(f"[equivalence]   RF failed: {short_error(error)}")

            rows.append(row)
            if row.get("rf_status", "") != "error":
                log(
                    "[equivalence]   "
                    f"delta_ll={fmt(row.get('delta_log_likelihood'))} "
                    f"nrf={fmt(row.get('normalized_rf'))}"
                )

    write_tsv(out_dir / "equivalence.tsv", rows)
    summary = summarize_equivalence(rows)
    write_tsv(out_dir / "equivalence-summary.tsv", summary)
    log(f"[equivalence] wrote {out_dir / 'equivalence.tsv'}")


def summarize_equivalence(rows: list[dict]) -> list[dict]:
    groups: dict[str, list[dict]] = {}
    for row in rows:
        groups.setdefault(row["dataset"], []).append(row)

    summary: list[dict] = []
    for dataset, group in sorted(groups.items()):
        usable = [
            row
            for row in group
            if row.get("cli_status") == "ok"
            and row.get("wasm_status") == "ok"
            and row.get("delta_log_likelihood") is not None
        ]
        if not usable:
            summary.append({"dataset": dataset, "replicates": 0, "status": "error"})
            continue
        deltas = [row["delta_log_likelihood"] for row in usable]
        absolute = [abs(value) for value in deltas]
        rfs = [row["normalized_rf"] for row in usable if row.get("normalized_rf") is not None]
        summary.append(
            {
                "dataset": dataset,
                "sample_count": usable[0].get("sample_count"),
                "sequence_length": usable[0].get("sequence_length"),
                "replicates": len(usable),
                "mean_wasm_log_likelihood": mean(
                    row["wasm_log_likelihood"] for row in usable
                ),
                "mean_delta_log_likelihood": mean(deltas),
                "max_abs_delta_log_likelihood": max(absolute),
                "mean_normalized_rf": mean(rfs) if rfs else None,
                "max_normalized_rf": max(rfs) if rfs else None,
                "mean_cli_wall_seconds": mean(
                    row["cli_wall_seconds"] for row in usable
                ),
                "mean_wasm_wall_seconds": mean(
                    row["wasm_wall_seconds"] for row in usable
                ),
            }
        )
    return summary


# ---------------------------------------------------------------------------
# Benchmark 2: scaling with simulated datasets
# ---------------------------------------------------------------------------


def benchmark_scale(config: dict, args: argparse.Namespace) -> None:
    scale_config = config["scale"]
    sample_counts = (
        args.sample_counts
        if args.sample_counts is not None
        else [int(value) for value in scale_config["sample_counts"]]
    )
    rates = (
        [float(value) for value in args.rates]
        if args.rates is not None
        else [float(value) for value in scale_config["rates"]]
    )
    sequence_length = (
        args.sequence_length
        if args.sequence_length is not None
        else int(scale_config["sequence_length"])
    )
    threads = (
        args.threads if args.threads is not None else int(scale_config["threads"])
    )
    repeats = (
        args.repeats if args.repeats is not None else int(scale_config.get("replicates", 1))
    )
    base_seed = args.seed if args.seed is not None else int(scale_config["seed"])

    verify_wasm(config)

    sys.path.insert(0, str(ROOT))
    from simulate import simulate_low_diversity_tree

    work_dir = bench_path(config["work_dir"]) / "simulated"
    out_dir = bench_path(config["results_dir"]) / "scale"
    rows: list[dict] = []

    for sample_count in sample_counts:
        for rate in rates:
            rate_label = f"{rate:g}"
            for replicate in range(1, repeats + 1):
                seed = base_seed + replicate - 1
                simulation_dir = (
                    work_dir
                    / f"n-{sample_count}"
                    / f"l-{sequence_length}"
                    / f"r-{rate_label}"
                    / f"rep-{replicate}"
                )
                dataset = simulation_dir / "dataset.maple"
                stats_path = simulation_dir / "dataset.stats.json"

                if not dataset.exists() or not stats_path.exists() or args.force:
                    log(
                        f"[scale] simulating n={sample_count} "
                        f"l={sequence_length} rate={rate_label} seed={seed}"
                    )
                    stats = simulate_low_diversity_tree(
                        n_samples=sample_count,
                        seq_length=sequence_length,
                        n_eff=int(scale_config["n_eff"]),
                        rate=rate,
                        seed=seed,
                        output_path=str(dataset),
                        min_variable_sites=int(scale_config["min_variable_sites"]),
                        max_attempts=int(scale_config["max_attempts"]),
                        output_format="maple",
                        quiet=True,
                    )
                    stats_path.write_text(json.dumps(stats, indent=2) + "\n")
                else:
                    stats = json.loads(stats_path.read_text())

                run_dir = out_dir / f"n-{sample_count}" / f"r-{rate_label}"
                row = {
                    "benchmark": "scale",
                    "sample_count": sample_count,
                    "sequence_length": sequence_length,
                    "rate": rate,
                    "replicate": replicate,
                    "seed": seed,
                    "variable_sites": stats.get("variable_sites"),
                    "max_divergence": stats.get("max_divergence"),
                    "tmrca": stats.get("tmrca"),
                    "threads": threads,
                }
                log(
                    f"[scale] n={sample_count} rate={rate_label} rep={replicate} "
                    f"variable_sites={stats.get('variable_sites')} "
                    f"tmrca={fmt(stats.get('tmrca'))}"
                )
                try:
                    wasm_metrics = run_wasm(
                        config,
                        dataset,
                        run_dir / f"rep-{replicate}.json",
                        run_dir / f"rep-{replicate}.nwk",
                        threads,
                        "none",
                        int(config["branch_support_replicates"]),
                        args.force,
                    )
                    row.update(
                        {
                            "status": "ok",
                            "wall_seconds": wasm_metrics.get("wall_seconds"),
                            "infer_ms": wasm_metrics.get("infer_ms"),
                            "parse_ms": wasm_metrics.get("parse_ms"),
                            "log_likelihood": wasm_metrics.get("log_likelihood"),
                            "wasm_package_version": wasm_metrics.get("package_version"),
                        }
                    )
                    log(
                        f"[scale]   infer={fmt(wasm_metrics.get('infer_ms', 0) / 1000)}s "
                        f"wall={fmt(wasm_metrics.get('wall_seconds'))}s"
                    )
                except Exception as error:  # noqa: BLE001
                    row["status"] = "error"
                    row["error"] = short_error(error)
                    log(f"[scale]   failed: {short_error(error)}")
                rows.append(row)

    write_tsv(out_dir / "scale.tsv", rows)
    summary = summarize_scale(rows)
    write_tsv(out_dir / "scale-summary.tsv", summary)
    log(f"[scale] wrote {out_dir / 'scale.tsv'} and scale-summary.tsv")


def summarize_scale(rows: list[dict]) -> list[dict]:
    groups: dict[tuple[int, float], list[dict]] = {}
    for row in rows:
        if row.get("status") != "ok":
            continue
        groups.setdefault((int(row["sample_count"]), float(row["rate"])), []).append(row)

    summary: list[dict] = []
    for (sample_count, rate), group in sorted(groups.items()):
        infer = [row["infer_ms"] for row in group if row.get("infer_ms") is not None]
        summary.append(
            {
                "sample_count": sample_count,
                "sequence_length": group[0]["sequence_length"],
                "rate": rate,
                "replicates": len(group),
                "mean_variable_sites": mean(
                    row["variable_sites"] for row in group if row.get("variable_sites") is not None
                ),
                "mean_max_divergence": mean(
                    row["max_divergence"] for row in group if row.get("max_divergence") is not None
                ),
                "median_infer_ms": median(infer) if infer else None,
                "min_infer_ms": min(infer) if infer else None,
                "max_infer_ms": max(infer) if infer else None,
                "median_wall_seconds": median(row["wall_seconds"] for row in group),
                "threads": group[0]["threads"],
            }
        )
    return summary


# ---------------------------------------------------------------------------
# Benchmark 3: thread scaling against the CLI
# ---------------------------------------------------------------------------


def benchmark_threads(config: dict, args: argparse.Namespace) -> None:
    thread_config = config["threads_benchmark"]
    dataset = bench_path(thread_config["dataset"])
    thread_list = (
        [int(value) for value in args.thread_list]
        if args.thread_list is not None
        else [int(value) for value in thread_config["threads"]]
    )
    repeats = (
        args.repeats if args.repeats is not None else int(thread_config["repeats"])
    )
    branch_support = args.branch_support or thread_config.get("branch_support", "none")
    replicates = int(config["branch_support_replicates"])

    if not dataset.exists():
        raise SystemExit(f"Thread benchmark dataset not found: {dataset}")
    verify_cmaple(config)
    verify_wasm(config)

    out_dir = bench_path(config["results_dir"]) / "threads"
    rows: list[dict] = []

    for threads in thread_list:
        for replicate in range(1, repeats + 1):
            for tool in ("cli", "wasm"):
                row = {
                    "benchmark": "threads",
                    "tool": tool,
                    "dataset": dataset.stem,
                    "threads": threads,
                    "replicate": replicate,
                }
                metrics_path = (
                    out_dir / tool / f"threads-{threads}" / f"rep-{replicate}.json"
                )
                if tool == "cli":
                    tree_path = (
                        out_dir / "cli" / f"threads-{threads}" / f"rep-{replicate}.treefile"
                    )
                    try:
                        metrics = run_cli(
                            config,
                            dataset,
                            metrics_path,
                            tree_path,
                            threads,
                            branch_support,
                            replicates,
                            args.force,
                        )
                        row.update(
                            {
                                "status": metrics["status"],
                                "wall_seconds": metrics.get("wall_seconds"),
                                "log_likelihood": metrics.get("log_likelihood"),
                            }
                        )
                    except Exception as error:  # noqa: BLE001
                        row["status"] = "error"
                        row["error"] = short_error(error)
                else:
                    newick_path = (
                        out_dir / "wasm" / f"threads-{threads}" / f"rep-{replicate}.nwk"
                    )
                    try:
                        metrics = run_wasm(
                            config,
                            dataset,
                            metrics_path,
                            newick_path,
                            threads,
                            branch_support,
                            replicates,
                            args.force,
                        )
                        row.update(
                            {
                                "status": "ok",
                                "wall_seconds": metrics.get("wall_seconds"),
                                "infer_ms": metrics.get("infer_ms"),
                                "parse_ms": metrics.get("parse_ms"),
                                "log_likelihood": metrics.get("log_likelihood"),
                                "wasm_package_version": metrics.get("package_version"),
                            }
                        )
                    except Exception as error:  # noqa: BLE001
                        row["status"] = "error"
                        row["error"] = short_error(error)
                log(
                    f"[threads] {tool} t={threads} rep={replicate} "
                    f"status={row['status']} wall={fmt(row.get('wall_seconds'))}s "
                    f"infer={fmt(row.get('infer_ms'))}ms"
                )
                rows.append(row)

    write_tsv(out_dir / "threads.tsv", rows)
    summary = summarize_threads(rows)
    write_tsv(out_dir / "threads-summary.tsv", summary)
    log(f"[threads] wrote {out_dir / 'threads.tsv'}")


def summarize_threads(rows: list[dict]) -> list[dict]:
    groups: dict[tuple[str, int], list[dict]] = {}
    for row in rows:
        if row.get("status") != "ok" or row.get("wall_seconds") is None:
            continue
        groups.setdefault((row["tool"], int(row["threads"])), []).append(row)

    baseline = {
        tool: median(
            row["wall_seconds"]
            for row in group
        )
        for (tool, threads), group in groups.items()
        if threads == 1
    }

    summary: list[dict] = []
    for (tool, threads), group in sorted(groups.items()):
        walls = [row["wall_seconds"] for row in group]
        infer_values = [
            row["infer_ms"] / 1000 for row in group if row.get("infer_ms") is not None
        ]
        median_wall = median(walls)
        speedup = baseline.get(tool, median_wall) / median_wall if median_wall else None
        summary.append(
            {
                "tool": tool,
                "threads": threads,
                "runs": len(group),
                "median_wall_seconds": median_wall,
                "min_wall_seconds": min(walls),
                "max_wall_seconds": max(walls),
                "median_infer_seconds": median(infer_values) if infer_values else None,
                "speedup_vs_1_thread": speedup,
                "parallel_efficiency": speedup / threads if speedup else None,
            }
        )
    return summary


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=["equivalence", "scale", "threads", "all"],
        help="Benchmark to run.",
    )
    parser.add_argument(
        "--config", type=Path, default=ROOT / "config.json", help="Config file."
    )
    parser.add_argument("--force", action="store_true", help="Re-run cached results.")
    parser.add_argument("--cmaple", help="Path to the CMAPLE CLI binary.")
    parser.add_argument("--node", help="Path to the node executable.")
    parser.add_argument(
        "--datasets",
        nargs="+",
        help="Dataset stems to run for the equivalence benchmark (default: all).",
    )
    parser.add_argument("--repeats", type=int, help="Replicates per configuration.")
    parser.add_argument("--threads", type=int, help="Threads for equivalence/scale.")
    parser.add_argument(
        "--thread-list", type=int, nargs="+", help="Thread counts for the threads benchmark."
    )
    parser.add_argument(
        "--sample-counts", type=int, nargs="+", help="Sample counts for the scale benchmark."
    )
    parser.add_argument(
        "--rates", type=float, nargs="+", help="Mutation rates for the scale benchmark."
    )
    parser.add_argument("--sequence-length", type=int, help="Sequence length for scale.")
    parser.add_argument("--seed", type=int, help="Simulation seed.")
    parser.add_argument(
        "--branch-support",
        choices=["none", "sprta", "sh-alrt"],
        help="Branch support method (default: none).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = load_config(args.config)
    if args.cmaple:
        config["cmaple"] = args.cmaple
    if args.node:
        config["node"] = args.node

    started = time.perf_counter()
    if args.command in {"equivalence", "all"}:
        benchmark_equivalence(config, args)
    if args.command in {"scale", "all"}:
        benchmark_scale(config, args)
    if args.command in {"threads", "all"}:
        benchmark_threads(config, args)
    log(f"Done in {time.perf_counter() - started:.1f}s")


if __name__ == "__main__":
    main()
