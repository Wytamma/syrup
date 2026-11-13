<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { createBridge } from "@tabee/browser";
  import {
    NEWICK_V1,
    normalizeFormatKey,
    registryCapability,
  } from "@tabee/formats";
  import { TabeeException } from "@tabee/protocol";
  import AppTopbar from "./AppTopbar.svelte";
  import { downloadTextFile } from "../download";
  import { sendToMicrobeTrace } from "../microbetrace-handoff";
  import { createThemeController } from "../state/theme.svelte";
  import {
    CLOCKOR2_URL,
    TRAKKA_URL,
    formatBytes,
    formatTreeMeta,
    treeDownloadName,
  } from "../tree-export";
  import {
    TREES_CHANGED_CHANNEL,
    deleteTree,
    listTrees,
    type StoredTree,
  } from "../tree-store";

  const FEEDBACK_MS = 1400;

  const ISO_NOTICE =
    "This page is cross-origin isolated, so it cannot hold a receiving window or load the MicrobeTrace SDK. Serve /trees.html without COOP/COEP.";

  const theme = createThemeController();
  const isolated: boolean = self.crossOriginIsolated;

  let trees = $state<StoredTree[]>([]);
  let selectedId = $state("");
  let customUrl = $state("");
  let status = $state("");
  let statusKind = $state<"info" | "error">("info");
  let pendingTree = $state<StoredTree | undefined>(undefined);
  let copiedId = $state("");
  let downloadedId = $state("");
  let channel: BroadcastChannel | null = null;
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  let downloadTimer: ReturnType<typeof setTimeout> | null = null;

  const selectedTree = $derived(trees.find((tree) => tree.id === selectedId));

  const bridge = createBridge({
    application: {
      name: "SYRUP",
      url: `${location.origin}${location.pathname}`,
    },
    normalizeFormatKey,
    exports: {
      [NEWICK_V1]: () => {
        const tree = pendingTree ?? selectedTree;
        if (!tree) throw new Error("No tree selected");
        return {
          name: tree.name,
          files: [
            {
              name: treeDownloadName(tree.sourceFileName, false),
              data: tree.newick,
            },
          ],
        };
      },
    },
    exportCapabilities: { [NEWICK_V1]: registryCapability(NEWICK_V1) },
  });

  function setErrorStatus(message: string, kind: "info" | "error" = "info") {
    status = message;
    statusKind = kind;
  }

  async function refresh() {
    try {
      trees = await listTrees();
      if (!trees.some((tree) => tree.id === selectedId))
        selectedId = trees[0]?.id ?? "";
    } catch {
      trees = [];
      setErrorStatus("Tree history is unavailable in this browser.", "error");
    }
  }

  function flashCopy(treeId: string) {
    if (copyTimer !== null) clearTimeout(copyTimer);
    copiedId = treeId;
    copyTimer = setTimeout(() => {
      copiedId = "";
      copyTimer = null;
    }, FEEDBACK_MS);
  }

  function flashDownload(treeId: string) {
    if (downloadTimer !== null) clearTimeout(downloadTimer);
    downloadedId = treeId;
    downloadTimer = setTimeout(() => {
      downloadedId = "";
      downloadTimer = null;
    }, FEEDBACK_MS);
  }

  async function copyTree(tree: StoredTree) {
    try {
      await navigator.clipboard.writeText(tree.newick);
      flashCopy(tree.id);
      return true;
    } catch (error) {
      setErrorStatus(
        `Copy failed — ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      return false;
    }
  }

  function downloadTree(tree: StoredTree) {
    const hasNexus = tree.nexus !== "";
    const fileName = treeDownloadName(tree.sourceFileName, hasNexus);
    downloadTextFile(hasNexus ? tree.nexus : tree.newick, fileName);
    flashDownload(tree.id);
    return fileName;
  }

  async function sendTree(targetUrl: string) {
    if (isolated) {
      setErrorStatus(ISO_NOTICE, "error");
      return;
    }

    let url: URL;
    try {
      url = new URL(targetUrl.trim());
    } catch {
      setErrorStatus("Enter a valid destination URL.", "error");
      return;
    }

    const tree = selectedTree;
    if (!tree) return;
    pendingTree = tree;

    try {
      const receipt = await bridge.sendTo(url.toString(), { format: "newick" });
    } catch (error) {
      setErrorStatus(
        error instanceof TabeeException
          ? `Transfer failed — ${error.code}: ${error.message}`
          : `Transfer failed — ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    } finally {
      pendingTree = undefined;
    }
  }

  let openMenuId = $state("");
  let menuPosition = $state({ top: 0, right: 0 });

  const MENU_ESTIMATED_HEIGHT = 190;

  function closeMenu() {
    openMenuId = "";
  }

  function toggleMenu(event: MouseEvent, treeId: string) {
    if (openMenuId === treeId) {
      closeMenu();
      return;
    }

    const trigger = (
      event.currentTarget as HTMLElement
    ).getBoundingClientRect();
    const below = trigger.bottom + 6;
    const top =
      below + MENU_ESTIMATED_HEIGHT > window.innerHeight
        ? Math.max(8, trigger.top - MENU_ESTIMATED_HEIGHT)
        : below;

    menuPosition = {
      top,
      right: Math.round(window.innerWidth - trigger.right),
    };
    openMenuId = treeId;
  }

  async function copyFromMenu(tree: StoredTree) {
    closeMenu();
    if (await copyTree(tree)) setErrorStatus(`Copied ${tree.name} Newick.`);
  }

  function downloadFromMenu(tree: StoredTree) {
    closeMenu();
    setErrorStatus(`Downloaded ${downloadTree(tree)}.`);
  }

  function rerunFromMenu(tree: StoredTree) {
    closeMenu();
    rerunTree(tree);
  }

  function removeFromMenu(tree: StoredTree) {
    closeMenu();
    void removeTree(tree);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") closeMenu();
  }

  function handleDocumentPointerDown(event: PointerEvent) {
    if (!openMenuId) return;
    const target = event.target as HTMLElement | null;
    if (!target?.closest(".tree-menu")) closeMenu();
  }

  function rerunTree(tree: StoredTree) {
    if (!tree.maple) {
      setErrorStatus(
        "This tree was saved without its MAPLE alignment. Run the inference again.",
        "error",
      );
      return;
    }

    location.href = `/?rerun=${encodeURIComponent(tree.id)}`;
  }

  async function removeTree(tree: StoredTree) {
    if (
      !window.confirm(
        `Remove ${tree.name} from the tree library? This cannot be undone.`,
      )
    ) {
      return;
    }

    try {
      await deleteTree(tree.id);
      await refresh();
    } catch (error) {
      setErrorStatus(
        error instanceof Error ? error.message : String(error),
        "error",
      );
    }
  }

  function submitMicrobeTrace() {
    if (!selectedTree) return;
    void sendTreeToMicrobeTrace(selectedTree);
  }

  async function sendTreeToMicrobeTrace(tree: StoredTree) {
    if (isolated) {
      setErrorStatus(ISO_NOTICE, "error");
      return;
    }

    if (!tree.maple) {
      setErrorStatus(
        "This tree was saved without its MAPLE alignment. Re-run the inference to send it to MicrobeTrace.",
        "error",
      );
      return;
    }

    pendingTree = tree;

    try {
      await sendToMicrobeTrace({
        name: tree.name,
        newick: tree.newick,
        maple: tree.maple,
      });
    } catch (error) {
      setErrorStatus(
        error instanceof Error ? error.message : String(error),
        "error",
      );
    } finally {
      pendingTree = undefined;
    }
  }

  onMount(() => {
    theme.mount();
    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    channel = new BroadcastChannel(TREES_CHANGED_CHANNEL);
    channel.onmessage = () => void refresh();
    void refresh();
  });

  onDestroy(() => {
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
    document.removeEventListener("keydown", handleKeydown);
    document.removeEventListener("scroll", closeMenu, true);
    window.removeEventListener("resize", closeMenu);
    if (copyTimer !== null) clearTimeout(copyTimer);
    if (downloadTimer !== null) clearTimeout(downloadTimer);
    channel?.close();
    channel = null;
    bridge.destroy();
    theme.destroy();
  });
</script>

<main class="trees-page">
  <AppTopbar theme={theme.theme} onToggleTheme={theme.toggleTheme} />

  <section class="trees-shell">
    <h1 class="trees-brand">
      <a href="/">
        <img src="/images/syrup_logo.png" alt="Syrup trees" decoding="async" />
      </a>
    </h1>
    <div class="trees-panel trees-panel--list">
      {#if trees.length === 0}
        <p class="trees-empty">
          No saved trees yet. Run an inference in SYRUP, then reopen this page.
        </p>
      {:else}
        <div class="tree-list" role="radiogroup" aria-label="Saved trees">
          {#each trees as tree (tree.id)}
            <div class="tree-row">
              <label class="tree-row-main">
                <input
                  type="radio"
                  name="tree"
                  value={tree.id}
                  bind:group={selectedId}
                />
                <span class="tree-row-body">
                  <span class="tree-row-name" title={tree.name}
                    >{tree.name}</span
                  >
                  <span class="tree-row-meta" title={formatTreeMeta(tree)}
                    >{formatTreeMeta(tree)}</span
                  >
                </span>
              </label>
              <div class="tree-row-actions">
                <button
                  type="button"
                  class="icon-button"
                  class:success={copiedId === tree.id}
                  aria-label="Copy {tree.name} Newick"
                  title={copiedId === tree.id ? "Copied Newick" : "Copy Newick"}
                  onclick={() => void copyTree(tree)}
                >
                  {#if copiedId === tree.id}
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path
                        d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0 1 18 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3 1.5 1.5 3-3.75"
                      />
                    </svg>
                  {:else}
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path
                        d="M15.75 17.25v1.5a2.25 2.25 0 0 1-2.25 2.25h-7.5a2.25 2.25 0 0 1-2.25-2.25v-7.5A2.25 2.25 0 0 1 6 9h1.5"
                      />
                      <path
                        d="M9.75 15h7.5A2.25 2.25 0 0 0 19.5 12.75v-7.5A2.25 2.25 0 0 0 17.25 3h-7.5A2.25 2.25 0 0 0 7.5 5.25v7.5A2.25 2.25 0 0 0 9.75 15Z"
                      />
                    </svg>
                  {/if}
                </button>
                <button
                  type="button"
                  class="icon-button"
                  class:success={downloadedId === tree.id}
                  aria-label="Download {tree.name} tree"
                  title={downloadedId === tree.id
                    ? "Downloaded tree"
                    : "Download tree"}
                  onclick={() => downloadTree(tree)}
                >
                  {#if downloadedId === tree.id}
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  {:else}
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M12 3v12" />
                      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
                      <path d="M3.75 20.25h16.5" />
                    </svg>
                  {/if}
                </button>
                <button
                  type="button"
                  class="icon-button"
                  aria-label="Rerun {tree.name} in SYRUP"
                  title="Rerun in SYRUP"
                  onclick={() => rerunTree(tree)}
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path
                      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  class="icon-button"
                  aria-label="Remove {tree.name} from the library"
                  title="Remove tree"
                  onclick={() => void removeTree(tree)}
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path
                      d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                    />
                  </svg>
                </button>
              </div>
              <div class="tree-menu">
                <button
                  type="button"
                  class="icon-button tree-menu-button"
                  aria-haspopup="menu"
                  aria-expanded={openMenuId === tree.id}
                  aria-label="Actions for {tree.name}"
                  title="Actions"
                  onclick={(event) => toggleMenu(event, tree.id)}
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    fill="currentColor"
                  >
                    <circle cx="5" cy="12" r="1.9" />
                    <circle cx="12" cy="12" r="1.9" />
                    <circle cx="19" cy="12" r="1.9" />
                  </svg>
                </button>
                {#if openMenuId === tree.id}
                  <div
                    class="tree-row-menu"
                    role="menu"
                    aria-label="Actions for {tree.name}"
                    style="top: {menuPosition.top}px; right: {menuPosition.right}px"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onclick={() => void copyFromMenu(tree)}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path
                          d="M15.75 17.25v1.5a2.25 2.25 0 0 1-2.25 2.25h-7.5a2.25 2.25 0 0 1-2.25-2.25v-7.5A2.25 2.25 0 0 1 6 9h1.5"
                        />
                        <path
                          d="M9.75 15h7.5A2.25 2.25 0 0 0 19.5 12.75v-7.5A2.25 2.25 0 0 0 17.25 3h-7.5A2.25 2.25 0 0 0 7.5 5.25v7.5A2.25 2.25 0 0 0 9.75 15Z"
                        />
                      </svg>
                      Copy Newick
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onclick={() => downloadFromMenu(tree)}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M12 3v12" />
                        <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
                        <path d="M3.75 20.25h16.5" />
                      </svg>
                      Download tree
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onclick={() => rerunFromMenu(tree)}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path
                          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                        />
                      </svg>
                      Rerun in SYRUP
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onclick={() => removeFromMenu(tree)}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path
                          d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                        />
                      </svg>
                      Remove tree
                    </button>
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
      <p class="trees-hint">Saved trees are stored only in this browser</p>
    </div>

    <div class="trees-panel trees-panel--actions">
      <div class="trees-actions">
        <button
          type="button"
          class="button-like trees-button"
          disabled={!selectedTree || isolated || pendingTree !== undefined}
          onclick={() => void sendTree(CLOCKOR2_URL)}
        >
          <img class="trees-logo" src="/images/clockor2_logo.svg" alt="" />
          Open in Clockor2
        </button>
        <button
          type="button"
          class="button-like trees-button"
          disabled={!selectedTree || isolated || pendingTree !== undefined}
          onclick={() => void sendTree(TRAKKA_URL)}
        >
          <img
            class="trees-logo trees-logo-light"
            src="/images/trakka_logo_small.svg"
            alt=""
          />
          <img
            class="trees-logo trees-logo-dark"
            src="/images/trakka_logo_small_dark.svg"
            alt=""
          />
          Open in Trakka
        </button>
        <button
          type="button"
          class="button-like trees-button"
          disabled={!selectedTree || isolated || pendingTree !== undefined}
          onclick={submitMicrobeTrace}
        >
          <img class="trees-logo" src="/images/microbetrace_logo.png" alt="" />
          Open in MicrobeTrace
        </button>
      </div>

      <form
        class="trees-custom"
        onsubmit={(event) => {
          event.preventDefault();
          void sendTree(customUrl);
        }}
      >
        <input
          bind:value={customUrl}
          placeholder="https://…"
          aria-label="Custom destination URL"
        />
        <button
          class="primary-button"
          type="submit"
          disabled={!selectedTree || isolated || pendingTree !== undefined}
        >
          Send
        </button>
      </form>
      <p class="trees-hint">
        The destination must run <a href="https://github.com/Wytamma/tabee"
          >tabEE</a
        >
      </p>

      {#if isolated}
        <p class="trees-warning">{ISO_NOTICE}</p>
      {/if}

      <p
        class="trees-status"
        role="status"
        aria-live="polite"
        data-kind={statusKind}
      >
        {status}
      </p>
    </div>
  </section>
</main>
