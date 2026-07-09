#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import html
import statistics
from collections import defaultdict
from pathlib import Path


FEATURE_CONFIG = {
    "samples": {
        "key": "samples",
        "label": "Samples",
        "title": "WASM Syrup sample-count scaling",
        "format": lambda value: f"{int(value):,}",
    },
    "seq-length": {
        "key": "seq_length",
        "label": "Sequence length (bp)",
        "title": "WASM Syrup sequence-length scaling",
        "format": lambda value: f"{int(value):,}",
    },
    "diversity": {
        "key": "rate",
        "label": "Mutation rate",
        "title": "WASM Syrup diversity scaling",
        "format": lambda value: f"{value:g}",
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Plot WASM simulation scaling benchmark results as SVG.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--feature", choices=sorted(FEATURE_CONFIG), required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def format_ms(value: float) -> str:
    return f"{value:.1f}" if value < 100 else f"{value:.0f}"


def read_rows(path: Path, feature: str) -> list[dict[str, int | float | str]]:
    rows: list[dict[str, int | float | str]] = []
    config = FEATURE_CONFIG[feature]
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            if row.get("feature") != feature or not row.get("runtime_seconds"):
                continue
            rows.append(
                {
                    "feature": feature,
                    "samples": int(row["samples"]),
                    "seq_length": int(row["seq_length"]),
                    "rate": float(row["rate"]),
                    "threads": int(row["threads"]),
                    "replicate": int(row["replicate"]),
                    "runtime_ms": float(row["runtime_seconds"]) * 1000,
                    "variable_sites": int(row["variable_sites"]) if row.get("variable_sites") else "",
                    "max_divergence": float(row["max_divergence"]) if row.get("max_divergence") else "",
                    "x_value": float(row[config["key"]]),
                }
            )
    return rows


def describe_fixed_values(rows: list[dict[str, int | float | str]], feature: str) -> str:
    parts: list[str] = []
    if feature != "samples":
        values = sorted({int(row["samples"]) for row in rows})
        if len(values) == 1:
            parts.append(f"n={values[0]:,}")
    if feature != "seq-length":
        values = sorted({int(row["seq_length"]) for row in rows})
        if len(values) == 1:
            parts.append(f"length={values[0]:,} bp")
    if feature != "diversity":
        values = sorted({float(row["rate"]) for row in rows})
        if len(values) == 1:
            parts.append(f"rate={values[0]:g}")
    threads = sorted({int(row["threads"]) for row in rows})
    if len(threads) == 1:
        parts.append(f"threads={threads[0]}")
    return " - ".join(parts)


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)
    rows = read_rows(input_path, args.feature)
    if not rows:
        raise SystemExit(f"No plottable rows found for feature {args.feature!r} in {input_path}")

    feature_config = FEATURE_CONFIG[args.feature]
    x_values = sorted({float(row["x_value"]) for row in rows})
    threads = sorted({int(row["threads"]) for row in rows})
    by_x_threads: dict[tuple[float, int], list[float]] = defaultdict(list)
    for row in rows:
        by_x_threads[(float(row["x_value"]), int(row["threads"]))].append(float(row["runtime_ms"]))

    width, height = 980, 560
    margin_left, margin_right, margin_top, margin_bottom = 86, 46, 74, 88
    plot_width = width - margin_left - margin_right
    plot_height = height - margin_top - margin_bottom
    y_min = 0.0
    y_max = max(float(row["runtime_ms"]) for row in rows) * 1.18
    if y_max < 1:
        y_max = 1.0

    x_positions = {
        value: margin_left + (plot_width * index / max(1, len(x_values) - 1))
        for index, value in enumerate(x_values)
    }

    def y_pos(value: float) -> float:
        return margin_top + plot_height - ((value - y_min) / (y_max - y_min)) * plot_height

    colors = ["#2563eb", "#c2410c", "#059669", "#7c3aed", "#0f766e", "#be123c"]
    color_for_thread = {
        thread: colors[index % len(colors)]
        for index, thread in enumerate(threads)
    }
    fixed_note = describe_fixed_values(rows, args.feature)

    svg: list[str] = []
    svg.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">')
    svg.append('<rect width="100%" height="100%" fill="#ffffff"/>')
    svg.append(
        '<style>'
        'text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#111827}'
        '.muted{fill:#6b7280}.axis{stroke:#374151;stroke-width:1}.grid{stroke:#e5e7eb;stroke-width:1}'
        '.mean{fill:none;stroke-width:3}.dot{stroke:#ffffff;stroke-width:1.5}.rep{opacity:.42}'
        '.err{stroke-width:2}.tick{font-size:13px}.title{font-size:22px;font-weight:700}'
        '.subtitle{font-size:14px}.label{font-size:14px;font-weight:600}'
        '</style>'
    )
    svg.append(f'<text class="title" x="{margin_left}" y="34">{feature_config["title"]}</text>')
    svg.append(
        f'<text class="subtitle muted" x="{margin_left}" y="56">'
        f'Source: {html.escape(str(input_path))} - {len(rows)} rows'
        f'{(" - " + fixed_note) if fixed_note else ""}'
        '</text>'
    )

    for index in range(6):
        value = y_min + (y_max - y_min) * index / 5
        y = y_pos(value)
        svg.append(f'<line class="grid" x1="{margin_left}" y1="{y:.2f}" x2="{width - margin_right}" y2="{y:.2f}"/>')
        svg.append(f'<text class="tick muted" x="{margin_left - 12}" y="{y + 4:.2f}" text-anchor="end">{format_ms(value)}</text>')

    svg.append(f'<line class="axis" x1="{margin_left}" y1="{margin_top}" x2="{margin_left}" y2="{height - margin_bottom}"/>')
    svg.append(f'<line class="axis" x1="{margin_left}" y1="{height - margin_bottom}" x2="{width - margin_right}" y2="{height - margin_bottom}"/>')

    for x_value in x_values:
        x = x_positions[x_value]
        label = feature_config["format"](x_value)
        svg.append(f'<line class="axis" x1="{x:.2f}" y1="{height - margin_bottom}" x2="{x:.2f}" y2="{height - margin_bottom + 6}"/>')
        svg.append(f'<text class="tick" x="{x:.2f}" y="{height - margin_bottom + 28}" text-anchor="middle">{label}</text>')

    svg.append(f'<text class="label" x="{margin_left + plot_width / 2:.2f}" y="{height - 26}" text-anchor="middle">{feature_config["label"]}</text>')
    svg.append(f'<text class="label" transform="translate(24 {margin_top + plot_height / 2:.2f}) rotate(-90)" text-anchor="middle">Inference runtime (ms)</text>')

    for thread in threads:
        color = color_for_thread[thread]
        points: list[tuple[float, float]] = []
        for x_value in x_values:
            runtimes = by_x_threads.get((x_value, thread), [])
            if not runtimes:
                continue
            mean_ms = statistics.mean(runtimes)
            sd_ms = statistics.pstdev(runtimes) if len(runtimes) > 1 else 0.0
            x = x_positions[x_value]
            y = y_pos(mean_ms)
            points.append((x, y))
            if sd_ms:
                y1 = y_pos(mean_ms - sd_ms)
                y2 = y_pos(mean_ms + sd_ms)
                svg.append(f'<line class="err" x1="{x:.2f}" y1="{y1:.2f}" x2="{x:.2f}" y2="{y2:.2f}" stroke="{color}" opacity="0.65"/>')
                svg.append(f'<line class="err" x1="{x - 5:.2f}" y1="{y1:.2f}" x2="{x + 5:.2f}" y2="{y1:.2f}" stroke="{color}" opacity="0.65"/>')
                svg.append(f'<line class="err" x1="{x - 5:.2f}" y1="{y2:.2f}" x2="{x + 5:.2f}" y2="{y2:.2f}" stroke="{color}" opacity="0.65"/>')
            for index, runtime_ms in enumerate(runtimes):
                jitter = (index - (len(runtimes) - 1) / 2) * 8
                tooltip = (
                    f'{feature_config["label"]}={feature_config["format"](x_value)}, '
                    f'threads={thread}, runtime={runtime_ms:.1f} ms'
                )
                svg.append(
                    f'<circle class="dot rep" cx="{x + jitter:.2f}" cy="{y_pos(runtime_ms):.2f}" r="4.5" fill="{color}">'
                    f'<title>{html.escape(tooltip)}</title></circle>'
                )
        if len(points) > 1:
            point_text = " ".join(f"{x:.2f},{y:.2f}" for x, y in points)
            svg.append(f'<polyline class="mean" points="{point_text}" stroke="{color}"/>')
        for x, y in points:
            svg.append(f'<circle class="dot" cx="{x:.2f}" cy="{y:.2f}" r="5.8" fill="{color}"/>')

    legend_x, legend_y = width - 250, margin_top + 8
    svg.append(f'<rect x="{legend_x - 14}" y="{legend_y - 24}" width="220" height="{42 + len(threads) * 24}" rx="6" fill="#f9fafb" stroke="#e5e7eb"/>')
    svg.append(f'<text class="label" x="{legend_x}" y="{legend_y}">Mean +/- population SD</text>')
    for index, thread in enumerate(threads):
        y = legend_y + 26 + index * 24
        color = color_for_thread[thread]
        svg.append(f'<line x1="{legend_x}" y1="{y}" x2="{legend_x + 24}" y2="{y}" stroke="{color}" stroke-width="3"/>')
        svg.append(f'<circle cx="{legend_x + 12}" cy="{y}" r="5" fill="{color}" stroke="#fff"/>')
        svg.append(f'<text class="tick" x="{legend_x + 34}" y="{y + 4}">threads={thread}</text>')

    mean_summaries: list[str] = []
    for x_value in x_values:
        values = []
        for thread in threads:
            runtimes = by_x_threads.get((x_value, thread), [])
            if runtimes:
                values.append(f"{thread}: {statistics.mean(runtimes):.1f} ms")
        mean_summaries.append(f'{feature_config["format"](x_value)} means - ' + "; ".join(values))
    svg.append(f'<text class="subtitle muted" x="{margin_left}" y="{height - 8}">{html.escape(" | ".join(mean_summaries))}</text>')
    svg.append("</svg>")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(svg) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
