#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import re
from collections import defaultdict
from pathlib import Path
from statistics import mean


BENCH_FIELD_RE = re.compile(r"(?P<key>[A-Za-z0-9_.-]+)=(?P<value>\"[^\"]*\"|\S+)")
CLI_LH_RE = re.compile(r"Tree log likelihood:\s*(?P<value>[-+0-9.eE]+)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Aggregate benchmark metrics and parsed logs.")
    parser.add_argument("--datasets", nargs="+", required=True)
    parser.add_argument("--replicates", nargs="+", required=True)
    parser.add_argument("--metrics-dir", required=True)
    parser.add_argument("--logs-dir", required=True)
    parser.add_argument("--rf", required=True)
    parser.add_argument("--summary-tsv", required=True)
    parser.add_argument("--summary-json", required=True)
    parser.add_argument("--final-tsv", required=True)
    return parser.parse_args()


def parse_bench_fields(line: str) -> dict[str, str]:
    return {
        match.group("key"): match.group("value").strip('"')
        for match in BENCH_FIELD_RE.finditer(line)
    }


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_browser_log(path: Path) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if "[CMAPLE bench]" not in line:
            continue
        fields = parse_bench_fields(line)
        if "preflight.done" in line:
            for key, value in fields.items():
                parsed[f"browser_preflight_{key}"] = value
        if "infer.done" in line:
            for key, value in fields.items():
                parsed[f"browser_infer_{key}"] = value
    return parsed


def parse_cli_log(path: Path) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = CLI_LH_RE.search(line)
        if match:
            parsed["cli_log_likelihood"] = match.group("value")
    return parsed


def browser_runtime_seconds(parsed_log: dict[str, str]) -> str:
    total_ms = parsed_log.get("browser_infer_totalMs")
    if not total_ms:
        return ""
    return f"{float(total_ms) / 1000:.6f}"


def read_rf_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle, delimiter="\t"))


def format_mean(values: list[float], digits: int = 6) -> str:
    if not values:
        return ""
    return f"{mean(values):.{digits}f}"


def mean_or_none(values: list[float]) -> float | None:
    return mean(values) if values else None


def format_float(value: float | None, digits: int = 6) -> str:
    if value is None:
        return ""
    return f"{value:.{digits}f}"


def format_ratio(value: float | None) -> str:
    if value is None:
        return ""
    return f"{value:.2f}x"


def format_integer_mean(values: list[float]) -> str:
    if not values:
        return ""
    return str(int(mean(values)))


def write_final_table(
    path: Path,
    datasets: list[str],
    summary_rows: list[dict[str, object]],
    rf_rows: list[dict[str, str]],
) -> None:
    rows_by_dataset_tool: dict[tuple[str, str], list[dict[str, object]]] = defaultdict(list)
    for row in summary_rows:
        rows_by_dataset_tool[(str(row["dataset"]), str(row["tool"]))].append(row)

    rf_by_dataset: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rf_rows:
        rf_by_dataset[row["dataset"]].append(row)

    def mean_tip_count(dataset: str) -> float:
        rows = rf_by_dataset[dataset]
        if not rows:
            return float("inf")
        return mean(float(row["common_taxa"]) for row in rows)

    datasets = sorted(datasets, key=lambda dataset: (mean_tip_count(dataset), dataset))

    table: list[tuple[str, list[str]]] = []
    table.append(("Dataset", datasets))
    table.append(
        (
            "Tips",
            [
                str(int(mean(float(row["common_taxa"]) for row in rf_by_dataset[dataset])))
                if rf_by_dataset[dataset]
                else ""
                for dataset in datasets
            ],
        )
    )
    table.append(
        (
            "Alignment length",
            [
                format_integer_mean(
                    [
                        float(row["browser_preflight_sequenceLength"])
                        for row in rows_by_dataset_tool[(dataset, "browser")]
                        if row.get("browser_preflight_sequenceLength") not in ("", None)
                    ]
                )
                for dataset in datasets
            ],
        )
    )

    table.append(
        (
            "Mean browser runtime (seconds)",
            [
                format_mean(
                    [
                        float(row["runtime_seconds"])
                        for row in rows_by_dataset_tool[(dataset, "browser")]
                        if row.get("runtime_seconds") not in ("", None)
                    ]
                )
                for dataset in datasets
            ],
        )
    )
    table.append(
        (
            "Mean browser slowdown",
            [
                format_ratio(
                    (
                        browser_runtime / cli_runtime
                        if (cli_runtime := mean_or_none(
                            [
                                float(row["runtime_seconds"])
                                for row in rows_by_dataset_tool[(dataset, "cli")]
                                if row.get("runtime_seconds") not in ("", None)
                            ]
                        )) not in (None, 0)
                        and (browser_runtime := mean_or_none(
                            [
                                float(row["runtime_seconds"])
                                for row in rows_by_dataset_tool[(dataset, "browser")]
                                if row.get("runtime_seconds") not in ("", None)
                            ]
                        )) is not None
                        else None
                    )
                )
                for dataset in datasets
            ],
        )
    )
    table.append(
        (
            "Mean log-likelihood delta (browser - CLI)",
            [
                format_float(
                    (
                        browser_likelihood - cli_likelihood
                        if (cli_likelihood := mean_or_none(
                            [
                                float(row["cli_log_likelihood"])
                                for row in rows_by_dataset_tool[(dataset, "cli")]
                                if row.get("cli_log_likelihood") not in ("", None)
                            ]
                        )) is not None
                        and (browser_likelihood := mean_or_none(
                            [
                                float(row["browser_infer_logLikelihood"])
                                for row in rows_by_dataset_tool[(dataset, "browser")]
                                if row.get("browser_infer_logLikelihood") not in ("", None)
                            ]
                        )) is not None
                        else None
                    )
                )
                for dataset in datasets
            ],
        )
    )
    table.append(
        (
            "Mean normalized generalized RF distance",
            [
                format_mean(
                    [
                        float(row["normalized_rf"])
                        for row in rf_by_dataset[dataset]
                        if row.get("normalized_rf") not in ("", None)
                    ],
                    digits=8,
                )
                for dataset in datasets
            ],
        )
    )

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "Metric\t" + "\t".join(datasets) + "\n"
        + "\n".join(metric + "\t" + "\t".join(values) for metric, values in table)
        + "\n",
        encoding="utf-8",
    )


def main() -> int:
    args = parse_args()
    metrics_dir = Path(args.metrics_dir)
    logs_dir = Path(args.logs_dir)

    rows: list[dict[str, object]] = []
    for dataset in args.datasets:
        for replicate in args.replicates:
            for tool in ["cli", "browser"]:
                metrics_path = metrics_dir / tool / dataset / f"rep-{replicate}.json"
                log_path = logs_dir / tool / dataset / f"rep-{replicate}.log"
                metrics = read_json(metrics_path)
                parsed_log = parse_cli_log(log_path) if tool == "cli" else parse_browser_log(log_path)
                process_wall_seconds = metrics.get("wall_seconds", "")
                runtime_seconds = (
                    process_wall_seconds
                    if tool == "cli"
                    else browser_runtime_seconds(parsed_log)
                )
                row: dict[str, object] = {
                    "dataset": dataset,
                    "replicate": replicate,
                    "tool": tool,
                    "runtime_seconds": runtime_seconds,
                    "runtime_source": "process_wall_seconds" if tool == "cli" else "browser_infer_totalMs",
                    "process_wall_seconds": process_wall_seconds,
                    "wall_seconds": runtime_seconds,
                    "max_rss_mib": metrics.get("max_rss_mib", ""),
                    "returncode": metrics.get("returncode", ""),
                    "log": str(log_path),
                }
                row.update(parsed_log)
                rows.append(row)

    all_keys = [
        "dataset",
        "replicate",
        "tool",
        "runtime_seconds",
        "runtime_source",
        "process_wall_seconds",
        "wall_seconds",
        "max_rss_mib",
        "returncode",
        "cli_log_likelihood",
        "browser_preflight_sequenceLength",
        "browser_preflight_analyzeMs",
        "browser_preflight_nativeMs",
        "browser_preflight_totalMs",
        "browser_infer_inferMs",
        "browser_infer_totalMs",
        "browser_infer_logLikelihood",
        "browser_infer_newickChars",
        "log",
    ]

    summary_tsv = Path(args.summary_tsv)
    summary_json = Path(args.summary_json)
    summary_tsv.parent.mkdir(parents=True, exist_ok=True)
    summary_tsv.write_text(
        "\t".join(all_keys)
        + "\n"
        + "\n".join("\t".join(str(row.get(key, "")) for key in all_keys) for row in rows)
        + "\n",
        encoding="utf-8",
    )
    summary_json.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
    write_final_table(Path(args.final_tsv), args.datasets, rows, read_rf_rows(Path(args.rf)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
