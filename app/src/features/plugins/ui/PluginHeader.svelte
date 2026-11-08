<script lang="ts">
  import type { Snippet } from 'svelte';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import Icon, { iconOr } from '../../controls/ui/Icon.svelte';
  import GuideDialog from './GuideDialog.svelte';
  import PluginAuthor from './PluginAuthor.svelte';

  let {
    title,
    icon,
    badges,
    verified,
    description,
    guide,
    children,
  }: {
    title: string;
    icon?: string;
    badges: string[];
    verified: boolean;
    description?: string;
    guide?: string;
    /** The page's own action, after How to use. */
    children: Snippet;
  } = $props();
  let guideOpen = $state(false);
</script>

<div class="flex items-center gap-4">
  <span class="grid size-16 shrink-0 place-items-center rounded-2xl border bg-accent"
    ><Icon
      name={iconOr(icon, 'Puzzle')}
      size={30}
    /></span
  >
  <div class="grid min-w-0 flex-1 gap-1.5">
    <h1 class="font-display text-2xl font-semibold tracking-wide">{title}</h1>
    <div class="flex flex-wrap items-center gap-1.5">
      {#each badges as badge (badge)}
        <Badge
          variant="secondary"
          class="tabular-nums">{badge}</Badge
        >
      {/each}
    </div>
  </div>
  {#if guide}
    <Button
      variant="outline"
      size="sm"
      onclick={() => (guideOpen = true)}><BookOpen />How to use</Button
    >
  {/if}
  {@render children()}
</div>
<PluginAuthor
  class="text-sm font-medium"
  {verified}
/>
{#if description}<p class="text-sm leading-relaxed text-muted-foreground">{description}</p>{/if}
{#if guide}
  <GuideDialog
    {title}
    {guide}
    bind:open={guideOpen}
  />
{/if}
