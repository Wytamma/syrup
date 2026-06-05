#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


def parse_bool(value: str) -> bool:
    return value.lower() in {"1", "true", "yes", "on"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run compiled CMAPLE CLI for one benchmark replicate.")
    parser.add_argument("--cmaple", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--output-prefix", required=True)
    parser.add_argument("--format", choices=["FASTA", "MAPLE"], default="FASTA")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--branch-support", default="true")
    parser.add_argument("--branch-support-method", choices=["none", "sprta", "sh-alrt"], default="sprta")
    parser.add_argument("--replicates", type=int, default=1000)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    prefix = Path(args.output_prefix)
    prefix.parent.mkdir(parents=True, exist_ok=True)

    command = [
        args.cmaple,
        "-aln",
        args.dataset,
        "--format",
        args.format,
        "-nt",
        str(args.threads),
        "--prefix",
        str(prefix),
        "--overwrite",
    ]

    branch_support_method = args.branch_support_method if parse_bool(args.branch_support) else "none"
    if branch_support_method == "sprta":
        command.append("--sprta")
    elif branch_support_method == "sh-alrt":
        command.extend(["--alrt", "--replicates", str(args.replicates)])

    print("CLI_COMMAND\t" + " ".join(command), flush=True)
    completed = subprocess.run(command, check=False)
    treefile = Path(str(prefix) + ".treefile")
    if completed.returncode == 0 and not treefile.exists():
        raise SystemExit(f"CMAPLE completed but did not write expected treefile: {treefile}")
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
