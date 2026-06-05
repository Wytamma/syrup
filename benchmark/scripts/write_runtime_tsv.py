#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


BENCH_FIELD_RE = re.compile(r"(?P<key>[A-Za-z0-9_.-]+)=(?P<value>\"[^\"]*\"|\S+)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Write a benchmark TSV with the intended runtime value.")
    parser.add_argument("--tool", choices=["cli", "browser"], required=True)
    parser.add_argument("--metrics", required=True)
    parser.add_argument("--log", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def parse_bench_fields(line: str) -> dict[str, str]:
    return {
        match.group("key"): match.group("value").strip('"')
        for match in BENCH_FIELD_RE.finditer(line)
    }


def browser_runtime_seconds(log_path: Path) -> float:
    for line in log_path.read_text(encoding="utf-8", errors="replace").splitlines():
        if "[CMAPLE bench]" not in line or "infer.done" not in line:
            continue
        fields = parse_bench_fields(line)
        if "totalMs" in fields:
            return float(fields["totalMs"]) / 1000
    raise SystemExit(f"Could not find browser infer.done totalMs in {log_path}")


def format_duration(seconds: float) -> str:
    rounded = int(round(seconds))
    hours, remainder = divmod(rounded, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}"


def main() -> int:
    args = parse_args()
    metrics = json.loads(Path(args.metrics).read_text(encoding="utf-8"))
    runtime_seconds = (
        browser_runtime_seconds(Path(args.log))
        if args.tool == "browser"
        else float(metrics["wall_seconds"])
    )
    max_rss_mib = float(metrics.get("max_rss_mib") or 0)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        "s\th:m:s\tmax_rss\tmax_vms\tmax_uss\tmax_pss\tio_in\tio_out\tmean_load\tcpu_time\n"
        f"{runtime_seconds:.2f}\t{format_duration(runtime_seconds)}\t{max_rss_mib:.2f}\t0\t0\t0\t0.00\t0.00\t0\t0\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
