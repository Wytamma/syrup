#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

import dendropy
from dendropy.calculate import treecompare


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare CLI and browser trees with extended RF metrics.")
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--replicate", required=True)
    parser.add_argument("--cli-tree", required=True)
    parser.add_argument("--browser-tree", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def read_tree(path: str, taxon_namespace: dendropy.TaxonNamespace) -> dendropy.Tree:
    tree = dendropy.Tree.get(
        path=path,
        schema="newick",
        taxon_namespace=taxon_namespace,
        preserve_underscores=True,
        rooting="force-unrooted",
    )
    for node in tree:
        if not node.is_leaf():
            node.label = None
    return tree


def collapse_zero_length_internal_edges(tree: dendropy.Tree, epsilon: float = 1e-12) -> int:
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


def strip_branch_lengths(tree: dendropy.Tree) -> None:
    for node in tree:
        node.edge.length = None


def main() -> int:
    args = parse_args()
    taxa = dendropy.TaxonNamespace()
    cli_tree = read_tree(args.cli_tree, taxa)
    browser_tree = read_tree(args.browser_tree, taxa)

    cli_labels = {taxon.label for taxon in cli_tree.taxon_namespace if taxon.label}
    browser_labels = {taxon.label for taxon in browser_tree.taxon_namespace if taxon.label}
    common_labels = cli_labels & browser_labels

    if len(common_labels) < 4:
        raise SystemExit("Need at least 4 common taxa for RF comparison.")

    cli_tree.retain_taxa_with_labels(common_labels)
    browser_tree.retain_taxa_with_labels(common_labels)
    cli_zero_length_internal_edges = collapse_zero_length_internal_edges(cli_tree)
    browser_zero_length_internal_edges = collapse_zero_length_internal_edges(browser_tree)
    strip_branch_lengths(cli_tree)
    strip_branch_lengths(browser_tree)
    cli_tree.encode_bipartitions()
    browser_tree.encode_bipartitions()

    false_positives, false_negatives = treecompare.false_positives_and_negatives(cli_tree, browser_tree)
    rf = false_positives + false_negatives
    denominator = 2 * (len(common_labels) - 3)
    normalized_rf = rf / denominator if denominator > 0 else 0

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        "\t".join(
            [
                "dataset",
                "replicate",
                "common_taxa",
                "rf_symmetric_difference",
                "normalized_rf",
                "false_positives",
                "false_negatives",
                "cli_zero_length_internal_edges_collapsed",
                "browser_zero_length_internal_edges_collapsed",
            ]
        )
        + "\n"
        + "\t".join(
            [
                args.dataset,
                args.replicate,
                str(len(common_labels)),
                str(rf),
                f"{normalized_rf:.8f}",
                str(false_positives),
                str(false_negatives),
                str(cli_zero_length_internal_edges),
                str(browser_zero_length_internal_edges),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
