# Molecular clock with Clockor2

[https://clockor2.github.io](https://clockor2.github.io) fits a root-to-tip regression in the browser and can search for the best-fitting root. This workflow follows on from the example of building a pathogen tree from the [Nextclade workflow](pathogen-nextclade.md). 

## Prepare the tree

1. Complete the [Pathogen phylogenetics with Nextclade](pathogen-nextclade.md) workflow.
2. In Syrup, download the inferred Newick tree.
3. Confirm that tip labels contain dates. In the influenza example, tips look like `A/Pennsylvania/144/2020`.

For this example, the date is the final field in the tip label. Split each tip label on `/` and use position `-1`, which gives `2020`, `2021`, and so on.

## Send the tree from Syrup

Syrup can hand the tree straight to Clockor2, so there is no file to download.

1. Run the inference, or reopen a saved run from the tree library.
2. Open the tree library with **TREES** in the top bar, or the library icon in the tree toolbar.
3. Select the run and choose **Open in Clockor2**.
4. Clockor2 opens in a new tab with the tree already offered. Approve the incoming dataset and it is imported.

The transfer uses tabEE: the tree moves between the two browser tabs and is never uploaded to a server, and Clockor2 asks for approval before importing. Clockor2 must be running a build with tabEE support. If the button is disabled or the handshake fails, download the Newick tree and use the manual steps below — the tree library row has a download action, and the viewer toolbar still has one too.

## Load the tree in Clockor2 manually

Use these steps instead of the handoff, or to re-add a tree you downloaded earlier.

1. Open [Clockor2](https://clockor2.github.io/).
2. Add the Newick tree downloaded from Syrup.
3. In **Parse from tip labels**, set:
   - **Date format**: `Decimal Date`
   - **Delimiter**: `/`
   - **Date Location**: `-1`
4. Select **Parse Tips**.

![Clockor2 tip date parser configured for influenza labels](../assets/screenshots/clockor2-parser-configured.png)

## Fit the best root with RMS

After parsing, Clockor2 shows the root-to-tip regression. Enable **Best Fitting Root** and keep the criterion set to **RMS**.

![Clockor2 RMS best-fitting root](../assets/screenshots/clockor2-rms-best-root.png)

## Notes

- The `-1` date location means "the last field after splitting on the delimiter".
- If your labels use a different format, change the delimiter and date location accordingly.
- Clockor2 runs locally in the browser; the tree file is not uploaded by the app.

