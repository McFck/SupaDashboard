<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { Page } from '../../core/settings.svelte';
  import { getSkinHostContext } from '../../skins/context';
  import Slot from '../../skins/Slot.svelte';
  import CanvasScene from '../../skins/CanvasScene.svelte';
  import { createSubwayScene } from './scene';

  let { page: _page }: { page: Page } = $props();
  const host = getSkinHostContext();
  const emptyData = Object.freeze({ line: null });
  const sideActive = $derived(host?.viewId === 'cab');
</script>

<div class="absolute inset-0 overflow-hidden bg-[#10171b] text-[#e5ecef]">
  <CanvasScene create={createSubwayScene} width={1920} height={480} view={host?.viewId ?? 'display'} data={emptyData}
    class="absolute left-0 top-0" />
  <div class="absolute left-0 top-[480px] h-[120px] w-[1920px]" data-skin-region="strip">
    <Slot id="strip" />
  </div>
  <div class="absolute left-[1728px] top-[64px] h-[352px] w-[128px]" data-skin-region="side"
    aria-hidden={!sideActive} inert={!sideActive} style:pointer-events={sideActive ? 'auto' : 'none'}>
    <Slot id="side" />
  </div>
  <nav data-skin-input="ui" aria-label="Skin view" class="absolute right-16 top-4 z-20 flex gap-2">
    <Button size="sm" variant={host?.viewId === 'display' ? 'secondary' : 'outline'} aria-pressed={host?.viewId === 'display'}
      tabindex={host?.mode === 'runtime' ? -1 : 0} onclick={() => void host?.setView('display')}>Display</Button>
    <Button size="sm" variant={host?.viewId === 'cab' ? 'secondary' : 'outline'} aria-pressed={host?.viewId === 'cab'}
      tabindex={host?.mode === 'runtime' ? -1 : 0} onclick={() => void host?.setView('cab')}>Cab</Button>
  </nav>
</div>
