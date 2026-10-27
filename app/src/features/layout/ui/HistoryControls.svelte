<script lang="ts">
  import Undo from '@lucide/svelte/icons/undo-2';
  import Redo from '@lucide/svelte/icons/redo-2';
  import { Button } from '$lib/components/ui/button';
  import { Hint } from '$lib/components/ui/tooltip';
  import { history, redo, undo } from '../history.svelte';
</script>

<div class="flex shrink-0 items-center gap-1.5 border-l border-[#262626] pl-3">
  <Hint
    text="Undo"
    keys={['Ctrl', 'Z']}
    side="bottom"
  >
    {#snippet children(props)}
      <Button
        {...props}
        variant="ghost"
        size="icon-sm"
        aria-label="Undo"
        disabled={!history.canUndo}
        onclick={undo}
      >
        <Undo />
      </Button>
    {/snippet}
  </Hint>
  <Hint
    text="Redo"
    keys={['Ctrl', 'Shift', 'Z']}
    side="bottom"
  >
    {#snippet children(props)}
      <Button
        {...props}
        variant="ghost"
        size="icon-sm"
        aria-label="Redo"
        disabled={!history.canRedo}
        onclick={redo}
      >
        <Redo />
      </Button>
    {/snippet}
  </Hint>
</div>
