# Outputs

## Tree viewer

After inference, Syrup displays the inferred tree in an interactive viewer. The toolbar shows the input file name and the rounded log-likelihood when available.

The viewer controls can:

- show or hide inferred mutations above their branches when viewing a mutation-annotated tree
- show or hide internal labels
- show or hide leaf labels
- copy the Newick tree
- download the tree
- open the tree and MAPLE alignment in MicrobeTrace
- return to run settings

## Newick tree

For standard runs, Syrup downloads a `.nwk` file. The same Newick text can also be copied to the clipboard.

## Mutation-annotated tree

If **Infer mutations along each branch and output a mutation-annotated tree (MAT)** is enabled, Syrup downloads a `.mat.nex` file when CMAPLE returns NEXUS output.
The interactive viewer displays inferred mutations on both internal and terminal branches. Copied Newick output retains the annotation comments used for these labels.

![](assets/screenshots/mat-dark.png)

## MAPLE alignment

The **Download MAPLE format** link exports the loaded alignment in MAPLE format. This is available after preflight completes and before inference starts.

## Open in MicrobeTrace

After inference, select **Open in MicrobeTrace** to send the inferred Newick tree and the retained MAPLE alignment to MicrobeTrace. Syrup stages the files briefly in same-origin browser storage and opens the tree library page without cross-origin isolation. Select **Open in MicrobeTrace** there to complete the handoff.

The confirmation is required because Syrup uses cross-origin isolation for threaded WebAssembly, while MicrobeTrace's approved partner handoff uses a popup relationship. The staged export expires after five minutes and is deleted when the handoff begins. Files remain in the browser throughout this process.
