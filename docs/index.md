[![Syrup landing page](assets/logo.png)](https://syrup.cpg.org.au/)

[Syrup](https://syrup.cpg.org.au) is a browser app for running [CMAPLE](https://github.com/iqtree/cmaple/wiki/User-Manual) phylogenetic inference without installing command-line software. It accepts FASTA, PHYLIP, and MAPLE alignments, checks whether the data are suitable for CMAPLE, runs inference in WebAssembly, and shows the tree in the browser.

## When to use Syrup

Use Syrup when you need fast, installation-free phylogenetic inference for closely related pathogen genomes. It is designed for genomic surveillance, teaching, and privacy-sensitive analysis where you want to keep alignment data on your own computer while still using likelihood-based inference at large epidemiological scale.

Syrup is a good fit when you want to:

- run CMAPLE from an aligned FASTA, PHYLIP, or MAPLE file without installing command-line tools;
- check whether an alignment has the close relatedness and sparsity that make CMAPLE effective;
- infer trees with hundreds or thousands of samples directly in the browser;
- export an alignment in MAPLE format for downstream or command-line analysis;
- test sample filtering, starting trees, branch support, and other run settings;
- inspect the inferred tree interactively, then copy or download the result.

We provide several example workflows in the [Browser based workflows](workflows/phylogenetic-placement/) section of the documentation.

For very large production runs, native CMAPLE is usually faster and exposes more command-line options. For the full command-line option reference, see the [CMAPLE User Manual](https://github.com/iqtree/cmaple/wiki/User-Manual).

## Privacy

Syrup runs in your browser. Alignment and tree files are read locally and are not uploaded by the app.

## Browser requirements

Use a current version of Chrome, Edge, Firefox, or Safari. 

## Quick start

1. Open the [Syrup app](https://syrup.cpg.org.au/).
2. Drop an aligned FASTA, PHYLIP, or MAPLE file onto the page.
3. Review the preflight summary and warnings.
4. Choose a substitution model and branch support setting.
5. Select **Run**.
6. Copy or download the resulting tree.
