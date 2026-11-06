#!/usr/bin/env python3
"""Simulate alignments with msprime for the benchmark.

The coalescent model is GTR with equal rates and equilibrium frequencies, so
the mutation rate controls divergence while ``n_eff`` controls the height of
the tree. Output is written as a CMAPLE MAPLE alignment by default (reference
sequence followed by one mutation list per sample); ``--format fasta`` writes a
full FASTA instead.
"""

from __future__ import annotations

import argparse
import csv
import datetime
import itertools
import os
import random
from pathlib import Path

import msprime


def _log_run(log_path: str, row: dict) -> None:
    """Append a run record to a TSV log, writing a header if the file is new."""
    write_header = not os.path.exists(log_path)
    with open(log_path, "a", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(row), delimiter="\t")
        if write_header:
            writer.writeheader()
        writer.writerow(row)


def _max_divergence(tree, exact: bool = False) -> float:
    """Return max divergence among samples. Exact is O(n^2); default uses 2*TMRCA."""
    if exact:
        samples = tree.tree_sequence.samples()
        return max(
            tree.distance_between(u, v)
            for u, v in itertools.combinations(samples, 2)
        )
    return 2 * tree.tree_sequence.node(tree.root).time


def _variable_site_count(ts) -> int:
    """Return the number of segregating sites in the simulated alignment."""
    return sum(1 for variant in ts.variants() if len(set(variant.genotypes)) > 1)


def _write_maple(ts, reference: str, path: Path) -> None:
    """Write a MAPLE alignment: reference sequence, then per-sample mutations.

    A record is a nucleotide and a 1-based position, tab separated, matching
    the MAPLE files used by CMAPLE. The simulated data has substitutions only.

    Records are accumulated as sparse arrays and sorted by sample index so
    large sample counts (hundreds of thousands) stay tractable.
    """
    import numpy as np

    # msprime picks an ancestral allele per site independently of the random
    # reference genome, so the MAPLE reference must carry those ancestral bases.
    reference_chars = np.frombuffer(reference.encode(), dtype=np.uint8).copy()
    for variant in ts.variants():
        reference_chars[int(variant.site.position)] = ord(variant.alleles[0])

    sample_parts: list[np.ndarray] = []
    position_parts: list[np.ndarray] = []
    base_parts: list[np.ndarray] = []
    for variant in ts.variants():
        alleles = variant.alleles
        ancestral = alleles[0]
        carriers = np.flatnonzero(variant.genotypes)
        if carriers.size == 0:
            continue
        allele_bytes = np.frombuffer("".join(alleles).encode(), dtype=np.uint8)
        bases = np.take(allele_bytes, variant.genotypes[carriers])
        keep = bases != ord(ancestral)
        if not keep.any():
            continue
        carriers = carriers[keep]
        sample_parts.append(carriers.astype(np.int32))
        position_parts.append(
            np.full(carriers.size, int(variant.site.position) + 1, dtype=np.int32)
        )
        base_parts.append(bases[keep])

    if sample_parts:
        sample_index = np.concatenate(sample_parts)
        positions = np.concatenate(position_parts)
        bases = np.concatenate(base_parts)
        order = np.argsort(sample_index, kind="stable")
        sample_index = sample_index[order]
        positions = positions[order]
        bases = bases[order]
        bounds = np.searchsorted(sample_index, np.arange(ts.num_samples + 1))
    else:
        positions = bases = None
        bounds = np.zeros(ts.num_samples + 1, dtype=np.int64)

    with open(path, "wb") as fh:
        fh.write(b">reference\n")
        fh.write(bytes(reference_chars).lower() + b"\n")
        for index in range(ts.num_samples):
            fh.write(f">sample_{index}\n".encode())
            start, end = int(bounds[index]), int(bounds[index + 1])
            if end > start:
                fh.write(
                    b"\n".join(
                        b"%c\t%d" % (base, position)
                        for base, position in zip(
                            bases[start:end].tolist(), positions[start:end].tolist()
                        )
                    )
                    + b"\n"
                )

def simulate_low_diversity_tree(
    n_samples=10_000,
    seq_length=10_000,
    n_eff=100,
    rate=1e-6,
    seed=42,
    output_path="out.maple",
    newick_path=None,
    exact_divergence=False,
    min_variable_sites=0,
    max_attempts=100,
    output_format="maple",
    quiet=False,
) -> dict:
    """Simulate a coalescent process and write the alignment.

    Returns a dict of run statistics (also appended to ``<output>.log``).
    """
    if min_variable_sites < 0:
        min_variable_sites = 0
    if max_attempts < 1:
        max_attempts = 1

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    mut_model = msprime.GTR(
        relative_rates=[1, 1, 1, 1, 1, 1],
        equilibrium_frequencies=[0.25, 0.25, 0.25, 0.25],
    )

    ts = None
    variable_sites = 0
    used_seed = seed
    reference = ""
    for attempt in range(max_attempts):
        used_seed = seed + attempt
        ts = msprime.sim_ancestry(
            samples=n_samples,
            ploidy=1,
            sequence_length=seq_length,
            population_size=n_eff,
            random_seed=used_seed,
        )

        # Attach a random ACGT reference so unmutated positions are not written as N.
        rng = random.Random(used_seed)
        reference = "".join(rng.choices("ACGT", k=int(seq_length)))
        tables = ts.dump_tables()
        tables.reference_sequence.data = reference
        ts = tables.tree_sequence()

        ts = msprime.sim_mutations(ts, rate=rate, model=mut_model, random_seed=used_seed)
        variable_sites = _variable_site_count(ts)
        if variable_sites >= min_variable_sites:
            break

    if ts is None or variable_sites < min_variable_sites:
        raise RuntimeError(
            f"Could not simulate at least {min_variable_sites} variable site"
            f"{'' if min_variable_sites == 1 else 's'} after {max_attempts} attempts."
        )

    tree = ts.first()
    tmrca = ts.node(tree.root).time
    max_div = _max_divergence(tree, exact=exact_divergence) * rate

    if output_format == "maple":
        _write_maple(ts, reference, output_path)
    elif output_format == "fasta":
        with open(output_path, "w") as fh:
            ts.write_fasta(fh)
    else:
        raise ValueError(f"Unsupported output format: {output_format}")

    if newick_path is not None:
        Path(newick_path).write_text(tree.as_newick() + "\n")

    stats = {
        "timestamp": datetime.datetime.now().isoformat(timespec="seconds"),
        "n_samples": n_samples,
        "seq_length": int(seq_length),
        "n_eff": n_eff,
        "rate": rate,
        "seed": seed,
        "used_seed": used_seed,
        "tmrca": tmrca,
        "max_divergence": _max_divergence(tree, exact=exact_divergence) * rate,
        "num_mutations": ts.num_mutations,
        "variable_sites": variable_sites,
        "output_format": output_format,
    }
    _log_run(str(output_path.with_suffix(".log")), {
        key: stats[key]
        for key in (
            "timestamp",
            "n_samples",
            "seq_length",
            "n_eff",
            "rate",
            "seed",
            "used_seed",
            "tmrca",
            "max_divergence",
            "num_mutations",
            "variable_sites",
        )
    })

    if not quiet:
        print(f"Tips:                    {ts.num_samples:,}")
        print(f"TMRCA:                   {ts.node(ts.first().root).time:.0f} generations")
        print(f"Max divergence (est.):   {max_div:.4%}")
        print(f"Mutations:               {ts.num_mutations:,}")
        print(f"Variable sites:          {variable_sites:,}")
        print(f"Alignment written to '{output_path}'")

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-n", "--n-samples", type=int, default=10_000)
    parser.add_argument("-l", "--seq-length", type=int, default=10_000)
    parser.add_argument("-N", "--n-eff", type=int, default=100)
    parser.add_argument("-r", "--rate", type=float, default=1e-6)
    parser.add_argument("-s", "--seed", type=int, default=42)
    parser.add_argument("-o", "--output", default="out.maple")
    parser.add_argument("--format", choices=["maple", "fasta"], default="maple")
    parser.add_argument("--save-tree", action="store_true")
    parser.add_argument("--exact-divergence", action="store_true")
    parser.add_argument("--min-variable-sites", type=int, default=0)
    parser.add_argument("--max-attempts", type=int, default=100)
    parser.add_argument("-q", "--quiet", action="store_true")
    args = parser.parse_args()

    simulate_low_diversity_tree(
        n_samples=args.n_samples,
        seq_length=args.seq_length,
        n_eff=args.n_eff,
        rate=args.rate,
        seed=args.seed,
        output_path=args.output,
        newick_path=args.output.rsplit(".", 1)[0] + ".nwk" if args.save_tree else None,
        exact_divergence=args.exact_divergence,
        min_variable_sites=args.min_variable_sites,
        max_attempts=args.max_attempts,
        output_format=args.format,
        quiet=args.quiet,
    )


if __name__ == "__main__":
    main()
