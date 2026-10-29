<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import { Button } from '$lib/components/ui/button';
  import type { Page } from '../../../features/settings/schema';
  import { getAppletHostContext } from '../../../features/applets/context';
  import Slot from '../../../features/applets/Slot.svelte';
  import CanvasScene from '../../../features/applets/CanvasScene.svelte';
  import AppletQuickActions from '../../../features/applets/AppletQuickActions.svelte';
  import { createSubwayScene, subwaySceneRevision, type SubwaySceneData } from '../rendering/scene';
  import { regionStyle, subwayComposition } from '../rendering/composition';
  import { subwaySceneState } from '../simulation/runtime';
  import { loadSubwayEditorPreview, type SubwayEditorPreview } from '../rendering/preview';
  import { displayLanguages as displayPresetLanguages } from '../simulation/config';
  import { VisibleScreenClock, type ScreenConfig } from '../rendering/screens';

  let { page: _page }: { page: Page } = $props();
  const host = getAppletHostContext();
  let screenPulse = $state(0);
  let sceneData = $state<SubwaySceneData>();
  let editorPreview = $state<SubwayEditorPreview>();
  const screenClock = new VisibleScreenClock();
  const sideActive = $derived(host?.viewId === 'cab');
  const compact = $derived((host?.viewport?.width ?? 1920) / (host?.viewport?.height || 480) < 2.8);
  const composition = $derived(subwayComposition(compact, sceneData?.line.id));
  const sceneRevision = $derived(subwaySceneRevision(sceneData, host?.viewId ?? 'display'));
  const previewConfig = $derived(
    JSON.stringify({
      line: host?.config.line,
      direction: host?.config.direction,
      startStation: host?.config.startStation,
      displayLanguages: host?.config.displayLanguages,
      carNumber: host?.config.carNumber,
    }),
  );
  const line = $derived(sceneData?.line);
  $effect(() => {
    host?.setDesignHeight?.(composition.height);
  });

  $effect(() => {
    const mode = host?.mode;
    const config = JSON.parse(previewConfig);
    if (mode !== 'editor') {
      editorPreview = undefined;
      return;
    }
    const controller = new AbortController();
    let current = true;
    void loadSubwayEditorPreview(config, controller.signal)
      .then((preview) => {
        if (current) editorPreview = preview;
      })
      .catch(() => {
        if (current) editorPreview = undefined;
      });
    return () => {
      current = false;
      controller.abort();
    };
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
    if (!source) {
      sceneData = undefined;
      return;
    }
    const rawLanguages = source.config.displayLanguages ?? source.config.languages;
    const languages = Array.isArray(rawLanguages)
      ? rawLanguages.filter((item): item is string => typeof item === 'string')
      : displayPresetLanguages(
          typeof rawLanguages === 'string'
            ? rawLanguages
            : source.line.id === 'sakaisuji'
              ? 'ja-kana'
              : 'ja-en',
        );
    const config: ScreenConfig = { line: source.line, languages };
    const active = host?.active ?? false;
    const schedule = screenClock.update(source.snapshot, config, performance.now(), active);
    sceneData = {
      ...source,
      visibleElapsed: schedule.visibleElapsed,
      clockLabel: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    };
    if (!active) return;
    const delay = Math.min(
      schedule.nextDeadline === null ? Infinity : schedule.nextDeadline - schedule.visibleElapsed,
      source.line.id === 'yamanote' ? 60_000 - (Date.now() % 60_000) : Infinity,
    );
    if (!Number.isFinite(delay)) return;
    const timeout = window.setTimeout(
      () => {
        screenPulse++;
      },
      Math.max(0, delay),
    );
    return () => window.clearTimeout(timeout);
  });
</script>

<div
  class="subway-panel absolute inset-0 text-[#e5ecef]"
  class:overflow-hidden={host?.mode === 'runtime'}
  style={`--line-color:${line?.color ?? '#79b52c'}`}
>
  <div
    class="lcd-housing absolute"
    style={regionStyle(composition.lcd)}
  >
    <CanvasScene
      create={createSubwayScene}
      width={composition.lcd.w}
      height={composition.lcd.h}
      view={host?.viewId ?? 'display'}
      data={sceneData}
      revision={sceneRevision}
      opaque
    />
  </div>
  <div
    class="station-sign absolute"
    style={regionStyle(composition.sign)}
  >
    <span class="line-mark"
      >{line?.id === 'yamanote' ? 'JY' : line?.id === 'hibiya' ? 'H' : 'K'}</span
    >
    <div>
      <strong>{line?.names.ja ?? '山手線'}</strong><span>{line?.names.en ?? 'Yamanote Line'}</span>
    </div>
    <small>{line?.id === 'hibiya' ? '13000' : line?.id === 'sakaisuji' ? '1300' : 'E235-0'}</small>
  </div>
  <div
    class="absolute control-bay"
    style={regionStyle(composition.strip)}
    data-applet-region="strip"
  >
    <Slot id="strip" />
  </div>
  <div
    class="absolute control-bay"
    aria-hidden={!sideActive}
    inert={!sideActive}
    style:pointer-events={sideActive ? 'auto' : 'none'}
    style={`${regionStyle(composition.side)};opacity:${sideActive ? 1 : 0}`}
    data-applet-region="side"
  >
    <Slot id="side" />
  </div>
  <nav
    data-applet-input="ui"
    aria-label="Skin view"
    class="absolute z-20 grid gap-3"
    style={`${regionStyle(composition.views)};grid-template-columns:${compact && line?.id === 'yamanote' ? '1fr' : 'repeat(3,minmax(0,1fr))'}`}
  >
    <Button
      class="h-full min-w-0 px-1 text-[30px] font-semibold"
      variant={host?.viewId === 'display' ? 'secondary' : 'outline'}
      aria-pressed={host?.viewId === 'display'}
      tabindex={host?.mode === 'runtime' ? -1 : 0}
      onclick={() => void host?.setView('display')}>Display</Button
    >
    <Button
      class="h-full min-w-0 px-1 text-[30px] font-semibold"
      variant={host?.viewId === 'map' ? 'secondary' : 'outline'}
      aria-pressed={host?.viewId === 'map'}
      tabindex={host?.mode === 'runtime' ? -1 : 0}
      onclick={() => void host?.setView('map')}>Map</Button
    >
    <Button
      class="h-full min-w-0 px-1 text-[30px] font-semibold"
      variant={host?.viewId === 'cab' ? 'secondary' : 'outline'}
      aria-pressed={host?.viewId === 'cab'}
      tabindex={host?.mode === 'runtime' ? -1 : 0}
      onclick={() => void host?.setView('cab')}>Run</Button
    >
  </nav>
  {#if host?.mode === 'runtime'}
    <nav
      data-applet-input="ui"
      aria-label="Dashboard pages"
      class="absolute z-30 grid grid-cols-2 gap-3"
      style={regionStyle(composition.pages)}
    >
      <Button
        class="size-full p-0 [&_svg]:size-10"
        variant="outline"
        aria-label="Previous page"
        tabindex={-1}
        onclick={() => void host?.page.prev()}
        ><ArrowLeft
          class="size-12"
          strokeWidth={2.5}
        /></Button
      >
      <Button
        class="size-full p-0 [&_svg]:size-10"
        variant="outline"
        aria-label="Next page"
        tabindex={-1}
        onclick={() => void host?.page.next()}
        ><ArrowRight
          class="size-12"
          strokeWidth={2.5}
        /></Button
      >
    </nav>
  {/if}
  <AppletQuickActions />
</div>

<style>
  .subway-panel {
    background: linear-gradient(
      180deg,
      #dadbd7 0%,
      #bfc2be 2%,
      #e5e5df 73%,
      #bec1bd 74%,
      #d9dbd6 100%
    );
    border: 2px solid #a3aaa5;
    font-family: 'Yu Gothic UI', Meiryo, 'Noto Sans JP', sans-serif;
  }
  .lcd-housing {
    background: #15191b;
    box-shadow:
      0 0 0 10px #222827,
      0 0 0 12px #939b95,
      0 6px 12px #0005;
  }
  .station-sign {
    display: flex;
    align-items: center;
    gap: 24px;
    color: #202724;
    border-bottom: 8px solid var(--line-color);
  }
  .line-mark {
    display: grid;
    place-items: center;
    width: 80px;
    height: 80px;
    border: 10px solid var(--line-color);
    background: #fafbf8;
    color: #202724;
    font:
      700 36px Arial,
      sans-serif;
  }
  .station-sign strong {
    display: block;
    font-size: 42px;
    line-height: 1.1;
  }
  .station-sign span:not(.line-mark) {
    display: block;
    font-size: 24px;
  }
  .station-sign small {
    margin-left: auto;
    font:
      600 20px Arial,
      sans-serif;
    align-self: flex-start;
  }
  .control-bay {
    border-radius: 8px;
    background: #202826;
    box-shadow: inset 0 2px 5px #0006;
  }
  nav :global(button) {
    color: #29362f;
    background: #eff2eb;
    border: 2px solid #8f9d94;
  }
  nav :global(button[aria-pressed='true']) {
    color: #f7faf5;
    background: #26362c;
    border-color: #26362c;
  }
</style>
