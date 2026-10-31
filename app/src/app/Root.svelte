<script lang="ts">
  import { Toaster } from '$lib/components/ui/sonner';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import type { Component } from 'svelte';
  let { content: Content }: { content: Component } = $props();
</script>

<Tooltip.Provider delayDuration={300}>
  <Content />
  <Toaster theme="dark" />
</Tooltip.Provider>
