<script lang="ts">
  import { SettingsIndexController } from './settings-index.svelte';

  let { items }: { items: { id: string; title: string }[] } = $props();
  let nav = $state<HTMLElement>();
  let controller = $state<SettingsIndexController>();

  $effect(() => {
    if (!nav) {
      return;
    }
    const index = new SettingsIndexController(
      nav,
      items.map((item) => item.id),
    );
    controller = index;
    return () => index.destroy();
  });
  function go(event: MouseEvent, id: string) {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

<nav
  bind:this={nav}
  aria-label="Settings sections"
  class="sticky top-0 z-10 -mx-6 flex gap-1.5 overflow-x-auto bg-background px-6 py-2 @[900px]:top-9 @[900px]:mx-0 @[900px]:flex-col @[900px]:gap-0.5 @[900px]:self-start @[900px]:p-0"
>
  {#each items as item (item.id)}
    <a
      href={`#${item.id}`}
      onclick={(event) => go(event, item.id)}
      aria-current={controller?.active === item.id ? 'location' : undefined}
      class="shrink-0 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=location]:bg-accent aria-[current=location]:text-foreground"
      >{item.title}</a
    >
  {/each}
</nav>
