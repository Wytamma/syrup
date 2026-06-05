#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Concatenate TSV files with identical headers.")
    parser.add_argument("--output", required=True)
    parser.add_argument("inputs", nargs="+")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    header = None
    rows: list[str] = []
    for input_path in args.inputs:
        lines = Path(input_path).read_text(encoding="utf-8").splitlines()
        if not lines:
            continue
        if header is None:
            header = lines[0]
        elif lines[0] != header:
            raise SystemExit(f"Header mismatch in {input_path}")
        rows.extend(line for line in lines[1:] if line)

    output.write_text((header or "") + "\n" + "\n".join(rows) + ("\n" if rows else ""), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
