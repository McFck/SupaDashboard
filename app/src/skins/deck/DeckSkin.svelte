<script lang="ts">
  import type { Page } from '../../core/settings.svelte';
  import Slot from '../Slot.svelte';
  let { page }: { page: Page } = $props();
</script>

<!-- empty background drags the window -->
<div data-skin-page={page.id} class="grid h-full w-full place-items-center">
  <Slot id="main" />
</div>
