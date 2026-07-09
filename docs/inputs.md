# Inputs

## Alignment files

Syrup accepts aligned sequence files in:

- FASTA
- PHYLIP
- MAPLE

The input file must contain an alignment, not unaligned sequences. Syrup detects the format automatically.

## MAPLE export

After an alignment has loaded, select **Download MAPLE format** to export the parsed alignment as a MAPLE file. This is useful when you want a compressed version of a fasta input.

## Starting tree

In **Advanced Options**, add a starting tree when you want CMAPLE to place new samples onto an existing tree or start the search from a known topology.

Supported tree file extensions include `.nwk`, `.newick`, `.tree`, `.tre`, `.nex`, and `.nexus`.

When a starting tree is selected, Syrup also allows an optional starting alignment. Use this when the starting tree was inferred from a different alignment and the new input contains additional samples to place.

See the [phylogenetic placement workflow](workflows/phylogenetic-placement.md) for a complete example.

## URL parameters

Syrup can preload publicly available files from URLs:

```text
/?alignment=/B.1.429.maple
/?alignment=/samples/SRR13689667.maple&startingTree=/refs/B.1.429-ref.nwk&startingAlignment=/refs/B.1.429-ref.maple
```

Supported parameters are:

- `alignment`: alignment file URL;
- `startingTree`: starting tree file URL;
- `startingAlignment`: starting alignment file URL.

The browser must be allowed to fetch the URLs.

See [Sharing](sharing.md) for a URL builder and hosting notes.
