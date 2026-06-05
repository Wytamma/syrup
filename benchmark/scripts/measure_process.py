#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

import psutil


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a command and record wall time plus peak RSS.")
    parser.add_argument("--metrics", required=True, help="Path to write JSON metrics.")
    parser.add_argument("--log", required=True, help="Path to write combined stdout/stderr log.")
    parser.add_argument("command", nargs=argparse.REMAINDER, help="Command after --.")
    args = parser.parse_args()
    if args.command and args.command[0] == "--":
        args.command = args.command[1:]
    if not args.command:
        parser.error("missing command after --")
    return args


def process_tree_rss(root: psutil.Process) -> int:
    processes = [root]
    try:
        processes.extend(root.children(recursive=True))
    except psutil.Error:
        pass

    rss = 0
    for process in processes:
        try:
            rss += process.memory_info().rss
        except psutil.Error:
            continue
    return rss


def main() -> int:
    args = parse_args()
    metrics_path = Path(args.metrics)
    log_path = Path(args.log)
    metrics_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    started = time.perf_counter()
    max_rss = 0

    with log_path.open("w", encoding="utf-8") as log_file:
        log_file.write(f"$ {' '.join(args.command)}\n")
        log_file.flush()

        process = subprocess.Popen(
            args.command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        ps_process = psutil.Process(process.pid)

        def copy_output() -> None:
            if process.stdout is None:
                return
            for line in process.stdout:
                log_file.write(line)
                log_file.flush()
                sys.stdout.write(line)
                sys.stdout.flush()

        output_thread = threading.Thread(target=copy_output, daemon=True)
        output_thread.start()

        while process.poll() is None:
            max_rss = max(max_rss, process_tree_rss(ps_process))
            time.sleep(0.1)

        output_thread.join(timeout=5)
        max_rss = max(max_rss, process_tree_rss(ps_process))
        return_code = process.returncode

    finished = time.perf_counter()
    metrics = {
        "command": args.command,
        "returncode": return_code,
        "wall_seconds": finished - started,
        "max_rss_bytes": max_rss,
        "max_rss_mib": max_rss / (1024 * 1024),
        "log": str(log_path),
    }
    metrics_path.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    return return_code


if __name__ == "__main__":
    raise SystemExit(main())
