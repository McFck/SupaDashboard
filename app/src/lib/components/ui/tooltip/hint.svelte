<script lang="ts">
  // A styled hint around any trigger element; replaces native title tooltips. Empty text renders the trigger alone.
  import type { Snippet } from 'svelte';
  import Root from './tooltip.svelte';
  import Trigger from './tooltip-trigger.svelte';
  import Content from './tooltip-content.svelte';
  import { Kbd } from '../kbd';

  let { text, keys = [], side = 'top', children }: {
    text?: string; keys?: string[]; side?: 'top' | 'right' | 'bottom' | 'left'; children: Snippet<[Record<string, unknown>]>;
  } = $props();
</script>

{#if text}
  <Root ignoreNonKeyboardFocus>
    <Trigger>
      {#snippet child({ props })}{@render children(props)}{/snippet}
    </Trigger>
    <Content {side} sideOffset={6} class="bg-popover text-popover-foreground ring-1 ring-border" arrowClasses="bg-popover fill-popover">
      {text}
      {#if keys.length}<span class="flex items-center gap-0.5">{#each keys as key, i (key)}{#if i}<span class="text-muted-foreground">+</span>{/if}<Kbd>{key}</Kbd>{/each}</span>{/if}
    </Content>
  </Root>
{:else}
  {@render children({})}
{/if}
