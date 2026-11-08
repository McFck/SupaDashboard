<script lang="ts">
  import { isTauri } from '@tauri-apps/api/core';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { toast } from 'svelte-sonner';
  import * as Dialog from '$lib/components/ui/dialog';
  import { parseMarkdown, type Inline } from '../markdown';

  let {
    title,
    guide,
    open = $bindable(false),
  }: { title: string; guide: string; open?: boolean } = $props();
  const blocks = $derived(parseMarkdown(guide));

  function follow(event: MouseEvent, href: string) {
    event.preventDefault();
    if (!isTauri()) {
      window.open(href, '_blank', 'noopener');
      return;
    }
    openUrl(href).catch(() => toast.error('Could not open link'));
  }
</script>

{#snippet text(inline: Inline[])}
  {#each inline as part, index (index)}
    {#if part.kind === 'strong'}
      <strong class="font-semibold text-foreground">{part.text}</strong>
    {:else if part.kind === 'code'}
      <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">{part.text}</code
      >
    {:else if part.kind === 'link'}
      <a
        href={part.href}
        class="font-medium text-primary underline underline-offset-2"
        onclick={(event) => follow(event, part.href)}>{part.text}</a
      >
    {:else}
      {part.text}
    {/if}
  {/each}
{/snippet}

<Dialog.Root bind:open>
  <Dialog.Content class="gap-0 p-6 sm:max-w-xl">
    <Dialog.Header class="pb-2">
      <Dialog.Title class="font-display text-lg tracking-wide">How to use {title}</Dialog.Title>
    </Dialog.Header>
    <div class="grid gap-3 leading-relaxed text-muted-foreground">
      {#each blocks as block, index (index)}
        {#if block.kind === 'heading'}
          <h3 class="section-label pt-3">{@render text(block.inline)}</h3>
        {:else if block.kind === 'paragraph'}
          <p>{@render text(block.inline)}</p>
        {:else if block.ordered}
          <ol class="grid gap-2">
            {#each block.items as item, step (step)}
              <li class="flex gap-3">
                <span
                  class="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-foreground tabular-nums"
                  >{step + 1}</span
                >
                <span class="min-w-0">{@render text(item)}</span>
              </li>
            {/each}
          </ol>
        {:else}
          <ul class="grid list-disc gap-1.5 pl-5 marker:text-muted-foreground/60">
            {#each block.items as item, step (step)}
              <li>{@render text(item)}</li>
            {/each}
          </ul>
        {/if}
      {/each}
    </div>
  </Dialog.Content>
</Dialog.Root>
