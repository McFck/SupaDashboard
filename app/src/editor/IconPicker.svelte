<script lang="ts">
  // Searchable grid of every Lucide icon (+ brand extras).
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import Icon, { iconNames } from '../controls/Icon.svelte';

  let { value, onchange, size = 'default' }: { value?: string; onchange: (name: string) => void; size?: 'default' | 'sm' } = $props();
  let open = $state(false), query = $state('');
  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const all = iconNames();
    return (q ? all.filter(n => n.toLowerCase().includes(q)) : all).slice(0, 160);
  });
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="outline" size={size === 'sm' ? 'icon' : undefined}
        class={size === 'sm' ? 'p-0' : 'h-10 w-10 p-0'}>
        <span class="sr-only">Choose icon</span><Icon name={value} size={20} fallback="?" />
      </Button>
    {/snippet}
  </Dialog.Trigger>
  <Dialog.Content class="sm:max-w-2xl">
    <Dialog.Header><Dialog.Title>Icon</Dialog.Title></Dialog.Header>
    <Input placeholder="Search icons" aria-label="Search icons" bind:value={query} />
    <!-- Fixed height keeps the dialog steady while results narrow; padding keeps the selected ring unclipped. -->
    <div class="grid h-[min(50vh,420px)] auto-rows-[3rem] grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] content-start gap-1 overflow-y-auto p-1 [scrollbar-gutter:stable]">
      {#each matches as name (name)}
        <button type="button" aria-label={name} onclick={() => { onchange(name); open = false; }}
          class="flex items-center justify-center rounded-lg transition hover:bg-white/10 {name === value ? 'bg-white/15 ring-1 ring-white/40' : ''}">
          <span class="sr-only">{name}</span><Icon {name} size={20} />
        </button>
      {:else}
        <p class="col-span-full py-6 text-center text-sm text-muted-foreground">No icons</p>
      {/each}
    </div>
  </Dialog.Content>
</Dialog.Root>
