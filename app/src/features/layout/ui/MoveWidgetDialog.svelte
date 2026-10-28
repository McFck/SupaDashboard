<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import Choice from '../../plugins/ui/Choice.svelte';
  import type { MoveMode, MoveOption } from '../move-options';

  let {
    open,
    mode,
    options,
    destination,
    ondestination,
    onclose,
    onmove,
  }: {
    open: boolean;
    mode: MoveMode | undefined;
    options: MoveOption[];
    destination: string;
    ondestination: (value: string) => void;
    onclose: () => void;
    onmove: () => void;
  } = $props();

  const canMove = $derived(
    options.some((option) => option.value === destination && !option.disabled),
  );
</script>

<Dialog.Root
  {open}
  onOpenChange={(next) => {
    if (!next) {
      onclose();
    }
  }}
>
  <Dialog.Content class="sm:max-w-sm">
    <Dialog.Header>
      <Dialog.Title>{mode === 'slot' ? 'Move to slot' : 'Move to page'}</Dialog.Title>
    </Dialog.Header>
    <Choice
      value={destination}
      {options}
      aria-label={mode === 'slot' ? 'Destination slot' : 'Destination page'}
      onchange={ondestination}
    />
    <Dialog.Footer class="flex justify-end gap-2">
      <Button
        variant="ghost"
        size="sm"
        onclick={onclose}
      >
        Cancel
      </Button>
      <Button
        size="sm"
        disabled={!canMove}
        onclick={onmove}
      >
        Move
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
