<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { ControlConfig } from '../core/controls';
  import { currentRuntime, runtimeView } from '../core/runtime.svelte';
  import { mediaUrl, readMediaOptions } from '../core/content';
  import ContentTile from './ContentTile.svelte';

  let { control, page, pageId, pageVisible = true, itemId, pressFeedbackDisabled = false }:
    { control: ControlConfig; page?: import('../core/settings.svelte').Page; pageId?: string;
      pageVisible?: boolean; itemId?: string; pressFeedbackDisabled?: boolean } = $props();
  const options = $derived(readMediaOptions(control.options));
  const slide = $derived($runtimeView.content[control.id]?.slide ?? 0);
  const source = $derived(options.sources[slide]);
  const url = $derived(source?.kind === 'url' ? mediaUrl(source.value) : undefined);
  let documentVisible = $state(true);
  const displayEligible = $derived(pageVisible || pressFeedbackDisabled);
  const canRun = $derived($runtimeView.owner && !pressFeedbackDisabled && pageVisible && documentVisible);
  let unavailable = $state(false);
  let dwellReady = $state(false);
  let generation = $state(0);
  let sourceKey = $state('');

  $effect(() => {
    const key = JSON.stringify([slide, source?.kind, source?.value, url]);
    if (key === sourceKey) return;
    sourceKey = key;
    generation++;
    unavailable = !url;
    dwellReady = !url;
  });

  $effect(() => {
    if (!canRun || !dwellReady || options.sources.length < 2 ||
      !options.loop && slide >= options.sources.length - 1) return;
    const currentGeneration = generation;
    const timer = setTimeout(() => {
      if (currentGeneration !== generation) return;
      try { currentRuntime()?.contentCommand(control.id, 'next'); } catch { /* the control may have been deleted */ }
    }, options.interval * 1000);
    return () => clearTimeout(timer);
  });

  function settleLoad(token: number, key: string, success: boolean) {
    if (token !== generation || key !== sourceKey) return;
    unavailable = !success;
    dwellReady = true;
  }
  onMount(() => {
    const update = () => { documentVisible = document.visibilityState === 'visible'; };
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  });
  onDestroy(() => { generation++; });
</script>

<ContentTile {control} {page} {pageId} {pageVisible} {itemId} {pressFeedbackDisabled}>
  {#snippet children()}
    {#if displayEligible && url}
      {@const token = generation}{@const key = sourceKey}
      <img src={url} alt="" draggable="false" onload={() => settleLoad(token, key, true)}
        onerror={() => settleLoad(token, key, false)}
        style="object-fit: {options.fit}" class="block h-full w-full select-none" />
      {#if unavailable}<span class="sr-only">Unavailable</span>{/if}
    {:else if displayEligible}
      <div class="grid h-full w-full place-items-center text-sm text-muted-foreground">Unavailable</div>
    {/if}
  {/snippet}
</ContentTile>
