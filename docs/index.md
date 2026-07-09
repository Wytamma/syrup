# Syrup

Syrup is a browser app for running [CMAPLE](https://github.com/iqtree/cmaple/wiki/User-Manual) phylogenetic inference without installing command-line software. It accepts FASTA, PHYLIP, and MAPLE alignments, checks whether the data are suitable for CMAPLE, runs inference in WebAssembly, and shows the tree in the browser.

![Syrup landing page](assets/screenshots/landing.png)

## When to use Syrup

Use Syrup for exploratory, teaching, or privacy-sensitive analysis of closely related pathogen genomes. It is a good fit when you want to:

- infer a tree from an aligned FASTA, PHYLIP, or MAPLE file;
- check whether an alignment is suitable for CMAPLE;
- export an alignment in MAPLE format;
- test sample filtering or branch support settings;
- view and download the inferred tree.

For very large production runs, native CMAPLE is usually faster and exposes more command-line options.

For the full command-line option reference, see the [CMAPLE User Manual](https://github.com/iqtree/cmaple/wiki/User-Manual).

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
