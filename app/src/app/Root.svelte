<script lang="ts">
  import { Toaster } from '$lib/components/ui/sonner';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Dashboard from '../features/dashboard/Dashboard.svelte';
  import ControlPanel from '../panel/ControlPanel.svelte';
  import type { WindowView } from './runtime/services';
  let { view }: { view: WindowView } = $props();
</script>

<Tooltip.Provider delayDuration={300}>
  {#if view === 'panel'}<ControlPanel />{:else}<Dashboard />{/if}
  <Toaster theme="dark" />
</Tooltip.Provider>
