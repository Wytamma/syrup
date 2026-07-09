# Simulate large trees with low diversity

import argparse
import csv
import datetime
import itertools
import os
import random
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
    """Return max divergence among samples. Exact is O(n²); default is 2*TMRCA upper bound."""
    if exact:
        samples = tree.tree_sequence.samples()
        return max(
            tree.distance_between(u, v)
            for u, v in itertools.combinations(samples, 2)
        )
    return 2 * tree.tree_sequence.node(tree.root).time


def _variable_site_count(ts) -> int:
    """Return the number of segregating sites in the simulated alignment."""
    return sum(
        1
        for variant in ts.variants()
        if len(set(variant.genotypes)) > 1
    )


def simulate_low_diversity_tree(
    n_samples=100_000,
    seq_length=10_000,
    n_eff=1_000,
    rate=1e-6,
    seed=42,
    fasta_path="out.fasta",
    newick_path=None,
    exact_divergence=False,
    min_variable_sites=0,
    max_attempts=100,
    quiet=False,
):
    """Simulate a coalescent process, saving the sequences and optionally the tree."""
    if min_variable_sites < 0:
        min_variable_sites = 0
    if max_attempts < 1:
        max_attempts = 1

    mut_model = msprime.GTR(
        relative_rates=[1, 1, 1, 1, 1, 1],
        equilibrium_frequencies=[0.25, 0.25, 0.25, 0.25],
    )

    ts = None
    variable_sites = 0
    used_seed = seed
    for attempt in range(max_attempts):
        used_seed = seed + attempt
        # Simulate a single ancestry tree (branch lengths in generations)
        ts = msprime.sim_ancestry(
            samples=n_samples,
            ploidy=1,
            sequence_length=seq_length,
            population_size=n_eff,
            random_seed=used_seed,
        )

        # Attach a random ACGT reference sequence so unmutated positions aren't written as N
        rng = random.Random(used_seed)
        ref_seq = "".join(rng.choices("ACGT", k=int(seq_length)))
        tables = ts.dump_tables()
        tables.reference_sequence.data = ref_seq
        ts = tables.tree_sequence()

        # Place mutations along branches using the chosen substitution model
        ts = msprime.sim_mutations(ts, rate=rate, model=mut_model, random_seed=used_seed)
        variable_sites = _variable_site_count(ts)
        if variable_sites >= min_variable_sites:
            break

    if ts is None or variable_sites < min_variable_sites:
        raise RuntimeError(
            f"Could not simulate at least {min_variable_sites} variable site"
            f"{'' if min_variable_sites == 1 else 's'} after {max_attempts} attempts."
        )

    # Report tree statistics
    tree = ts.first()
    tmrca = ts.node(tree.root).time
    max_div = _max_divergence(tree, exact=exact_divergence) * rate
    div_label = "Max divergence (exact)" if exact_divergence else "Max divergence (est.) "

    if not quiet:
        print(f"Tips:                    {ts.num_samples:,}")
        print(f"TMRCA:                   {tmrca:.0f} generations")
        print(f"{div_label}:  {max_div:.4%}")
        print(f"Mutations:               {ts.num_mutations:,}")
        print(f"Variable sites:          {variable_sites:,}")

    log_path = os.path.splitext(fasta_path)[0] + ".log"
    _log_run(log_path, {
        "timestamp":       datetime.datetime.now().isoformat(timespec="seconds"),
        "n_samples":       n_samples,
        "seq_length": seq_length,
        "n_eff": n_eff,
        "rate":   rate,
        "seed":     seed,
        "used_seed": used_seed,
        "tmrca": tmrca,
        "max_divergence": max_div,
        "num_mutations": ts.num_mutations,
        "variable_sites": variable_sites,
    })
    if not quiet:
        print(f"Run logged to '{log_path}'")

    # Write FASTA
    with open(fasta_path, "w") as f:
        ts.write_fasta(f)
    if not quiet:
        print(f"FASTA written to '{fasta_path}'")

    # Optionally write Newick tree
    if newick_path is not None:
        with open(newick_path, "w") as f:
            f.write(tree.as_newick() + "\n")
        if not quiet:
            print(f"Newick tree written to '{newick_path}'")

    return ts


def main():
    parser = argparse.ArgumentParser(
        description="""
        Simulate a coalescent process, saving the sequences and optionally the tree.
        Simulation specs are saved in a tsv log file with the same base name as the output FASTA.
        Substitution model is GTR with equal rates and  base frequencies.
        For more similarity, decrease population size and mutation rate.
        """
    )
    parser.add_argument(
        "-n", "--n-samples", type=int, default=10_000,
        metavar="N", help="Number of tips (default: 10000)"
    )
    parser.add_argument(
        "-l", "--seq-length", type=int, default=10_000,
        metavar="L", help="Alignment length in bp (default: 10000)"
    )
    parser.add_argument(
        "-N", "--n-eff", type=int, default=100,
        metavar="Ne", help="Effective population size (default: 100)"
    )
    parser.add_argument(
        "-r", "--rate", type=float, default=1e-6,
        metavar="MU", help="Mutation rate per per generation (default: 1e-6)"
    )
    parser.add_argument(
        "--n-sims", type=int, default=1,
        metavar="K", help="Number of simulations to run (default: 1)"
    )
    parser.add_argument(
        "-s", "--seed", type=int, default=42,
        metavar="SEED", help="Random seed (default: 42)"
    )
    parser.add_argument(
        "-o", "--output", default="out.fasta",
        metavar="FILE", help="Output FASTA file (default: out.fasta)"
    )
    parser.add_argument(
        "-v", "--screenlog", action="store_true",
        help="Suppress all printed output (default: false)"
    )
    parser.add_argument(
        "--save-tree", action="store_true",
        help="Save the Newick tree alongside the FASTA (default: False)"
    )
    parser.add_argument(
        "--exact-divergence", action="store_true",
        help="Compute exact max pairwise divergence (O(n²)); default is fast 2*TMRCA*mu upper bound (default: False )"
    )
    parser.add_argument(
        "--min-variable-sites", type=int, default=0,
        metavar="M", help="Minimum segregating sites required before writing output (default: 0)"
    )
    parser.add_argument(
        "--max-attempts", type=int, default=100,
        metavar="A", help="Maximum simulation attempts when enforcing --min-variable-sites (default: 100)"
    )
    args = parser.parse_args()

    base = os.path.splitext(args.output)[0]

    for i in range(1, args.n_sims + 1):
        suffix = str(i) if args.n_sims > 1 else ""
        fasta_path = f"{base}{suffix}.fasta"
        newick_path = f"{base}{suffix}.nwk" if args.save_tree else None

        if not args.screenlog and args.n_sims > 1:
            print(f"--- Simulation {i}/{args.n_sims} ---")

        simulate_low_diversity_tree(
            n_samples=args.n_samples,
            seq_length=args.seq_length,
            n_eff=args.n_eff,
            rate=args.rate,
            seed=args.seed + i - 1,
            fasta_path=fasta_path,
            newick_path=newick_path,
            exact_divergence=args.exact_divergence,
            min_variable_sites=args.min_variable_sites,
            max_attempts=args.max_attempts,
            quiet=not args.screenlog,
        )


if __name__ == "__main__":
    main()
