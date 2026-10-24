<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import type { Page } from '../../core/settings.svelte';
  import { watchDashboardVisibility, watchIntersection } from '../../core/content-visibility';
  import { runtimeView } from '../../core/runtime.svelte';
  import { getSkinHostContext } from '../../skins/context';
  import Slot from '../../skins/Slot.svelte';
  import CanvasScene from '../../skins/CanvasScene.svelte';
  import SkinQuickActions from '../../skins/SkinQuickActions.svelte';
  import { createSubwayScene, type SubwaySceneData } from './scene';
  import { registerSubwaySurface, subwaySceneState, type SubwaySurfaceRegistration } from './runtime';
  import { loadSubwayEditorPreview, type SubwayEditorPreview } from './preview';
  import { displayLanguages as displayPresetLanguages } from './config';
  import { VisibleScreenClock, type ScreenConfig } from './screens';

  let { page: _page }: { page: Page } = $props();
  const host = getSkinHostContext();
  let sceneElement: HTMLDivElement;
  let runtimeOwner = $state(false), intersecting = $state(false), documentVisible = $state(false), dashboardVisible = $state(false);
  let screenPulse = $state(0);
  let sceneData = $state<SubwaySceneData>();
  let editorPreview = $state<SubwayEditorPreview>();
  let surfaceRegistration: SubwaySurfaceRegistration | undefined;
  const screenClock = new VisibleScreenClock();
  const sideActive = $derived(host?.viewId === 'cab');

  function refreshSurface() {
    surfaceRegistration?.setEligible(host?.mode === 'runtime' && host.visible && host.pageRenderVisible && runtimeOwner &&
      intersecting && documentVisible && dashboardVisible);
  }

  onMount(() => {
    surfaceRegistration = registerSubwaySurface(false);
    const stopRuntimeView = runtimeView.subscribe(snapshot => { runtimeOwner = snapshot.owner; refreshSurface(); });
    const stopIntersection = watchIntersection(sceneElement, value => { intersecting = value; refreshSurface(); });
    const onVisibility = () => { documentVisible = document.visibilityState === 'visible'; refreshSurface(); };
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();
    let stopDashboard = () => {};
    let disposed = false;
    void watchDashboardVisibility(value => { dashboardVisible = value; refreshSurface(); }).then(stop => {
      if (disposed) stop(); else stopDashboard = stop;
    }).catch(() => {});
    refreshSurface();
    return () => {
      disposed = true;
      stopRuntimeView();
      stopIntersection();
      stopDashboard();
      document.removeEventListener('visibilitychange', onVisibility);
      surfaceRegistration?.dispose();
      surfaceRegistration = undefined;
    };
  });

  $effect(() => {
    const mode = host?.mode, visible = host?.visible, pageVisible = host?.pageRenderVisible;
    const owner = runtimeOwner, inView = intersecting, docVisible = documentVisible, dashboard = dashboardVisible;
    void mode; void visible; void pageVisible; void owner; void inView; void docVisible; void dashboard;
    refreshSurface();
  });

  $effect(() => {
    const mode = host?.mode;
    const config = host?.config ?? {};
    const configKey = JSON.stringify(config);
    void configKey;
    if (mode !== 'editor') { editorPreview = undefined; return; }
    const controller = new AbortController();
    let current = true;
    void loadSubwayEditorPreview(config, controller.signal).then(preview => {
      if (current) editorPreview = preview;
    }).catch(() => {
      if (current) editorPreview = undefined;
    });
    return () => { current = false; controller.abort(); };
  });

  $effect(() => {
    const mode = host?.mode;
    if (mode === 'editor') {
      const preview = editorPreview;
      sceneData = preview ? { ...preview, visibleElapsed: 0 } : undefined;
      return;
    }
    const source = $subwaySceneState;
    const pulse = screenPulse;
    void pulse;
    if (!source) { sceneData = undefined; return; }
    const rawLanguages = source.config.displayLanguages ?? source.config.languages;
    const languages = Array.isArray(rawLanguages) ? rawLanguages.filter((item): item is string => typeof item === 'string')
      : displayPresetLanguages(typeof rawLanguages === 'string' ? rawLanguages : source.line.id === 'sakaisuji' ? 'ja-kana' : 'ja-en');
    const config: ScreenConfig = { line: source.line, languages };
    const active = host?.mode === 'runtime' && host.visible && host.pageRenderVisible && runtimeOwner &&
      intersecting && documentVisible && dashboardVisible;
    const schedule = screenClock.update(source.snapshot, config, performance.now(), active);
    sceneData = { ...source, visibleElapsed: schedule.visibleElapsed };
    if (!active || schedule.nextDeadline === null) return;
    const timeout = window.setTimeout(() => { screenPulse++; }, Math.max(0, schedule.nextDeadline - schedule.visibleElapsed));
    return () => window.clearTimeout(timeout);
  });
</script>

<div bind:this={sceneElement} class="absolute inset-0 overflow-hidden bg-[#10171b] text-[#e5ecef]">
  <CanvasScene create={createSubwayScene} width={1920} height={1080} view={host?.viewId ?? 'display'} data={sceneData}
    class="absolute left-0 top-0" />
  <div class="absolute left-0 top-[1080px] h-[120px] w-[1920px]" data-skin-region="strip">
    <Slot id="strip" />
  </div>
  <div class="absolute left-[1728px] top-[64px] h-[352px] w-[128px] transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none"
    aria-hidden={!sideActive} inert={!sideActive} style:pointer-events={sideActive ? 'auto' : 'none'}
    style:opacity={sideActive ? 1 : 0} style:transform={sideActive ? 'translateY(0)' : 'translateY(4px)'} data-skin-region="side">
    <Slot id="side" />
  </div>
  <nav data-skin-input="ui" aria-label="Skin view" class="absolute left-[1456px] top-[1116px] z-20 flex gap-1.5">
    <Button size="sm" variant={host?.viewId === 'display' ? 'secondary' : 'outline'} aria-pressed={host?.viewId === 'display'}
      tabindex={host?.mode === 'runtime' ? -1 : 0} onclick={() => void host?.setView('display')}>Display</Button>
    <Button size="sm" variant={host?.viewId === 'map' ? 'secondary' : 'outline'} aria-pressed={host?.viewId === 'map'}
      tabindex={host?.mode === 'runtime' ? -1 : 0} onclick={() => void host?.setView('map')}>Map</Button>
    <Button size="sm" variant={host?.viewId === 'cab' ? 'secondary' : 'outline'} aria-pressed={host?.viewId === 'cab'}
      tabindex={host?.mode === 'runtime' ? -1 : 0} onclick={() => void host?.setView('cab')}>Run</Button>
  </nav>
  {#if host?.mode === 'runtime'}
    <nav data-skin-input="ui" aria-label="Dashboard pages" class="absolute left-[1780px] top-[1116px] z-30 flex gap-2">
      <Button size="sm" variant="outline" aria-label="Previous page" tabindex={-1} onclick={() => void host?.page.prev()}>‹</Button>
      <Button size="sm" variant="outline" aria-label="Next page" tabindex={-1} onclick={() => void host?.page.next()}>›</Button>
    </nav>
  {/if}
  <SkinQuickActions />
</div>
