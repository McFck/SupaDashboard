<script lang="ts">
  import type { ScenarioDraftEditor } from './scenario-draft.svelte';
  import StateSwatch from '../../controls/editor/StateSwatch.svelte';

  let { editor }: { editor: ScenarioDraftEditor } = $props();
</script>

<aside
  class="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto bg-sidebar p-4 [scrollbar-gutter:stable] max-[900px]:hidden"
>
  <h2 class="section-label">States</h2>
  {#each editor.draft?.variants ?? [] as variant, index (variant.id ?? index)}
    <div class="grid min-w-0 gap-1 rounded-lg bg-card p-3">
      <div class="flex min-w-0 items-center gap-2">
        <StateSwatch appearance={variant} />
        <span class="truncate text-sm font-medium">{editor.stateTitle(variant, index)}</span>
      </div>
      <div class="flex min-w-0 gap-2 text-xs text-muted-foreground">
        <span class="min-w-0 flex-1 truncate">{variant.label || '—'}</span>
      </div>
    </div>
  {/each}
</aside>
