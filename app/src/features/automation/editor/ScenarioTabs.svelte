<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { ScenarioDraftEditor, ScenarioEditorTab } from './scenario-draft.svelte';

  let { editor, idPrefix }: { editor: ScenarioDraftEditor; idPrefix: string } = $props();

  const title = (tab: ScenarioEditorTab) => tab[0].toUpperCase() + tab.slice(1);

  /** Arrow keys move between tabs and wrap; Home and End jump to the ends. */
  function keydown(event: KeyboardEvent & { currentTarget: HTMLElement }) {
    const tabs = editor.tabs;
    const index = tabs.indexOf(editor.selectedTab);
    const targets: Record<string, number> = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index + tabs.length - 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const next = targets[event.key];
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    editor.selectTab(tabs[next]);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${tabs[next]}"]`)?.focus();
  }
</script>

<div
  role="tablist"
  tabindex="-1"
  aria-label="Scenario editor"
  onkeydown={keydown}
  class="flex h-9 w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-muted p-1"
>
  {#each editor.tabs as tab (tab)}
    <Button
      id={`${idPrefix}-${tab}-tab`}
      data-tab={tab}
      role="tab"
      aria-selected={editor.selectedTab === tab}
      aria-controls={`${idPrefix}-${tab}-panel`}
      tabindex={editor.selectedTab === tab ? 0 : -1}
      size="sm"
      variant="ghost"
      class="scenario-tab h-7 text-muted-foreground transition-colors"
      onclick={() => editor.selectTab(tab)}
    >
      {title(tab)}
    </Button>
  {/each}
</div>

<style>
  :global(.scenario-tab[aria-selected='true']),
  :global(.scenario-tab[aria-selected='true']:hover) {
    background: var(--background);
    color: var(--foreground);
    box-shadow: 0 1px 2px #0002;
  }
</style>
