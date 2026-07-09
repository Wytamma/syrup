#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path


BENCH_FIELD_RE = re.compile(r"(?P<key>[A-Za-z0-9_.-]+)=(?P<value>\"[^\"]*\"|\S+)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Aggregate WASM simulation scaling benchmark results.")
    parser.add_argument("--samples", nargs="+", required=True)
    parser.add_argument("--sequence-lengths", nargs="+", required=True)
    parser.add_argument("--diversity-rates", nargs="+", required=True)
    parser.add_argument("--baseline-sample-count", required=True)
    parser.add_argument("--baseline-sequence-length", required=True)
    parser.add_argument("--baseline-rate", required=True)
    parser.add_argument("--threads", nargs="+", required=True)
    parser.add_argument("--replicates", nargs="+", required=True)
    parser.add_argument("--dataset-dir", required=True)
    parser.add_argument("--metrics-dir", required=True)
    parser.add_argument("--logs-dir", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def parse_bench_fields(line: str) -> dict[str, str]:
    return {
        match.group("key"): match.group("value").strip('"')
        for match in BENCH_FIELD_RE.finditer(line)
    }


def parse_browser_log(path: Path) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if "[CMAPLE bench]" not in line:
            continue
        fields = parse_bench_fields(line)
        if "preflight.done" in line:
            for key, value in fields.items():
                parsed[f"preflight_{key}"] = value
        if "infer.start" in line:
            for key, value in fields.items():
                parsed[f"infer_start_{key}"] = value
        if "infer.done" in line:
            for key, value in fields.items():
                parsed[f"infer_{key}"] = value
    return parsed


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def read_simulation_metadata(path: Path) -> dict[str, str]:
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle, delimiter="\t"))
    if not rows:
        raise ValueError(f"No simulation metadata rows found in {path}")
    return rows[-1]


def simulation_cases(args: argparse.Namespace) -> list[tuple[str, str, str, str]]:
    return [
        ("samples", samples, args.baseline_sequence_length, args.baseline_rate)
        for samples in args.samples
    ] + [
        ("seq-length", args.baseline_sample_count, seq_length, args.baseline_rate)
        for seq_length in args.sequence_lengths
    ] + [
        ("diversity", args.baseline_sample_count, args.baseline_sequence_length, rate)
        for rate in args.diversity_rates
    ]


def main() -> int:
    args = parse_args()
    dataset_dir = Path(args.dataset_dir)
    metrics_dir = Path(args.metrics_dir)
    logs_dir = Path(args.logs_dir)
    rows: list[dict[str, object]] = []

    for feature, samples, seq_length, rate in simulation_cases(args):
        sim_log_path = (
            dataset_dir
            / feature
            / f"n-{samples}"
            / f"l-{seq_length}"
            / f"r-{rate}"
            / "rep-{replicate}.log"
        )
        for threads in args.threads:
            for replicate in args.replicates:
                metrics_path = (
                    metrics_dir
                    / "simulation-wasm"
                    / feature
                    / f"n-{samples}"
                    / f"l-{seq_length}"
                    / f"r-{rate}"
                    / f"threads-{threads}"
                    / f"rep-{replicate}.json"
                )
                log_path = (
                    logs_dir
                    / "simulation-wasm"
                    / feature
                    / f"n-{samples}"
                    / f"l-{seq_length}"
                    / f"r-{rate}"
                    / f"threads-{threads}"
                    / f"rep-{replicate}.log"
                )
                metrics = read_json(metrics_path)
                parsed_log = parse_browser_log(log_path)
                sim_metadata = read_simulation_metadata(Path(str(sim_log_path).format(replicate=replicate)))
                infer_total_ms = parsed_log.get("infer_totalMs", "")
                rows.append(
                    {
                        "feature": feature,
                        "samples": samples,
                        "seq_length": seq_length,
                        "rate": rate,
                        "n_eff": sim_metadata.get("n_eff", ""),
                        "variable_sites": sim_metadata.get("variable_sites", ""),
                        "num_mutations": sim_metadata.get("num_mutations", ""),
                        "max_divergence": sim_metadata.get("max_divergence", ""),
                        "tmrca": sim_metadata.get("tmrca", ""),
                        "seed": sim_metadata.get("seed", ""),
                        "used_seed": sim_metadata.get("used_seed", ""),
                        "threads": threads,
                        "replicate": replicate,
                        "runtime_seconds": f"{float(infer_total_ms) / 1000:.6f}" if infer_total_ms else "",
                        "runtime_source": "infer_totalMs",
                        "process_wall_seconds": metrics.get("wall_seconds", ""),
                        "max_rss_mib": metrics.get("max_rss_mib", ""),
                        "returncode": metrics.get("returncode", ""),
                        "simulation_log": str(sim_log_path).format(replicate=replicate),
                        "log": str(log_path),
                        **parsed_log,
                    }
                )

    keys = [
        "feature",
        "samples",
        "seq_length",
        "rate",
        "n_eff",
        "variable_sites",
        "num_mutations",
        "max_divergence",
        "tmrca",
        "seed",
        "used_seed",
        "threads",
        "replicate",
        "runtime_seconds",
        "runtime_source",
        "process_wall_seconds",
        "max_rss_mib",
        "returncode",
        "preflight_sequenceLength",
        "preflight_analyzeMs",
        "preflight_nativeMs",
        "preflight_totalMs",
        "preflight_sequenceCount",
        "infer_start_requestedThreads",
        "infer_start_cpus",
        "infer_start_branchSupportMethod",
        "infer_inferMs",
        "infer_totalMs",
        "infer_logLikelihood",
        "infer_newickChars",
        "simulation_log",
        "log",
    ]

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=keys, delimiter="\t", extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
