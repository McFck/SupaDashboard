<script lang="ts">
  import type { Snippet } from 'svelte';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import Icon, { iconOr } from '../../controls/ui/Icon.svelte';
  import GuideDialog from './GuideDialog.svelte';
  import PluginAuthor from './PluginAuthor.svelte';
  import type { NativePlugin } from '../external/load';

  let {
    title,
    icon,
    version,
    applet = false,
    trust,
    description,
    guide,
    children,
  }: {
    title: string;
    icon?: string;
    version?: string;
    applet?: boolean;
    trust: NativePlugin['trust'];
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
  <div class="grid min-w-0 flex-1 gap-0.5">
    <h1 class="font-display text-2xl font-semibold tracking-wide">{title}</h1>
    <PluginAuthor
      class="text-sm"
      {trust}
    />
    {#if version || applet}
      <div class="plugin-badges mt-2 flex flex-wrap items-center gap-1.5">
        {#if version}
          <Badge
            variant="secondary"
            class="version-badge relative isolate h-auto min-h-5 max-w-full text-center leading-normal wrap-anywhere whitespace-normal tabular-nums"
            >Ver: {version}</Badge
          >
        {/if}
        {#if applet}<Badge variant="secondary">Applet</Badge>{/if}
      </div>
    {/if}
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
{#if description}<p class="text-sm leading-relaxed text-muted-foreground">{description}</p>{/if}
{#if guide}
  <GuideDialog
    {title}
    {guide}
    bind:open={guideOpen}
  />
{/if}

<style>
  .plugin-badges :global(.version-badge) {
    color: #f4f8ff;
    border-color: #5f748d;
    background-color: #27384c;
    background-image: linear-gradient(
      174deg in oklab,
      #354961,
      #4a6079 43%,
      #283c53 50%,
      #202d3e 78%,
      #32465d
    );
    box-shadow:
      inset 0 1px rgb(219 234 255 / 32%),
      inset 0 -1px #1b2838;
  }

  @media (prefers-reduced-motion: no-preference) and (forced-colors: none) {
    .plugin-badges :global(.version-badge)::before {
      position: absolute;
      z-index: -1;
      inset: 0;
      pointer-events: none;
      content: '';
      background-image: linear-gradient(
        110deg in oklab,
        transparent 32%,
        rgb(219 234 255 / 13%) 50%,
        transparent 68%
      );
      opacity: 0;
      animation: version-glint 750ms ease-out 100ms backwards;
    }
  }

  @media (forced-colors: active) {
    .plugin-badges :global(.version-badge) {
      border-color: CanvasText;
    }
  }

  @keyframes version-glint {
    from {
      transform: translateX(-100%);
      opacity: 0;
    }
    30%,
    70% {
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
</style>
