# Settings

Syrup exposes the CMAPLE settings that are most useful in the browser. For the complete command-line reference, see the [CMAPLE User Manual](https://github.com/iqtree/cmaple/wiki/User-Manual).

## Substitution model

Syrup selects models based on the detected sequence type.

### DNA models

| Model | Explanation |
| --- | --- |
| `JC` or `JC69` | Equal substitution rates and equal base frequencies ([Jukes and Cantor, 1969](http://doi.org/10.1016/B978-1-4832-3211-9.50009-7)). |
| `GTR` | General time reversible model with unequal rates and unequal base frequencies ([Tavare, 1986](http://www.damtp.cam.ac.uk/user/st321/CV_&_Publications_files/STpapers-pdf/T86.pdf)). |
| `UNREST` | Unrestricted model with non-reversible, unequal rates and unequal base frequencies. |

### Amino-acid models

Protein models include `LG`, `WAG`, `JTT`, `GTR20`, `NONREV`, and the empirical protein models exposed in the app. CMAPLE supports the non-mixture amino-acid models listed in the [IQ-TREE substitution model documentation](http://www.iqtree.org/doc/Substitution-Models#amino-acid-exchange-rate-matrices).

See [Amino acid phylogenetics with MUSCLE](workflows/amino-acid-muscle.md) for a browser-based protein alignment and tree workflow.

## Branch support

Branch support can be disabled or computed with:

- `SPRTA`;
- `SH-aLRT`.

For `SH-aLRT`, Syrup also exposes replicates and epsilon.

## Inference threads

Syrup can use multiple browser threads for CMAPLE inference. Use the **Threads** slider to choose how many threads to use; the available range depends on the hardware and browser. Increasing the number of threads can reduce runtime, particularly for large alignments.

Threaded execution requires the browser page to be cross-origin isolated. If the required browser security headers are unavailable, Syrup disables the thread control and runs with one thread.

## Tree search type

Syrup exposes the CMAPLE tree search modes:

- `FAST`: placement only;
- `NORMAL`: the default search;
- `EXHAUSTIVE`: broader SPR search.

`NORMAL` is the recommended default for most browser runs.

## Starting tree options

When a starting tree is selected, two additional options are available:

- **No reroot**: keep CMAPLE from rerooting the starting tree.
- **Branch lengths fixed**: keep starting tree branch lengths unchanged when applicable.

## Constant sites

Use constant-site counts when your alignment has been reduced to variable sites and you know the omitted `A`, `C`, `G`, and `T` site counts. Enter the values in `A, C, G, T` order.

This option is for DNA alignments.

## Divergence and quality filter

The divergence filter removes samples above the selected divergence or missing-data threshold before inference. Use it to test whether outlying or low-quality samples are driving warnings or long runtimes.
