<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { MediaSource } from '../../media/content';
  import { sourceIcon } from './media-source';
  let {
    sources,
    sourceThumbnail,
    onedit,
  }: {
    sources: MediaSource[];
    sourceThumbnail: (source: MediaSource) => string | undefined;
    onedit: () => void;
  } = $props();
</script>

<section class="grid gap-3">
  <div class="flex min-w-0 items-center gap-3">
    <div class="min-w-0 flex-1">
      <h3 class="section-label">Sources</h3>
      <span class="text-sm tabular-nums"
        >{sources.length} {sources.length === 1 ? 'source' : 'sources'}</span
      >
    </div>
    <div
      aria-hidden="true"
      class="flex shrink-0 -space-x-1.5"
    >
      {#each sources.slice(0, 4) as source (source.id)}
        {@const thumb = sourceThumbnail(source)}
        {@const Icon = sourceIcon(source)}
        {#if thumb}
          <img
            src={thumb}
            alt=""
            draggable="false"
            class="size-7 rounded border-2 border-sidebar object-cover"
          />
        {:else}
          <span class="grid size-7 place-items-center rounded border-2 border-sidebar bg-muted"
            ><Icon class="size-3.5" /></span
          >
        {/if}
      {/each}
    </div>
    <Button
      variant="outline"
      size="sm"
      aria-label="Edit sources"
      onclick={onedit}>Edit sources</Button
    >
  </div>
</section>
