<script lang="ts">
  import type { Page } from '../../../features/settings/schema';
  import { getAppletHostContext } from '../../../features/applets/context';
  import Slot from '../../../features/applets/Slot.svelte';
  import CanvasScene from '../../../features/applets/CanvasScene.svelte';
  import AppletQuickActions from '../../../features/applets/AppletQuickActions.svelte';
  import type { PreparedFrame, SubwayScreen } from '../rendering/contracts';
  import { createSubwayScene, prepareFrame, sceneLanguages } from '../rendering/scene';
  import { displayAspect, subwayComposition } from '../rendering/composition';
  import { subwaySceneState } from '../simulation/runtime';
  import { loadSubwayEditorPreview, type SubwayEditorPreview } from '../rendering/preview';
  import { sessionKey } from '../rendering/screens';
  import { PhaseClock } from '../rendering/engine/phase-clock';
  import { e235Images } from '../display/e235/images';

  let { page: _page }: { page: Page } = $props();
  const host = getAppletHostContext();
  let screenPulse = $state(0);
  let frame = $state.raw<PreparedFrame>();
  let editorPreview = $state<SubwayEditorPreview>();
  const clock = new PhaseClock();
  const view = $derived(host?.viewId ?? 'display');
  const screen = $derived<SubwayScreen>(host?.config.screen === 'right' ? 'right' : 'left');
  const composition = $derived(
    subwayComposition(
      host?.mode === 'runtime' ? host.viewport : undefined,
      displayAspect(frame?.line.id ?? host?.config.line),
    ),
  );
  const previewConfig = $derived(
    JSON.stringify({
      line: host?.config.line,
      direction: host?.config.direction,
      startStation: host?.config.startStation,
      displayLanguages: host?.config.displayLanguages,
      carNumber: host?.config.carNumber,
    }),
  );
  $effect(() =>
    e235Images.subscribe(() => {
      screenPulse++;
    }),
  );
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
    if (host?.mode === 'editor') {
      const preview = editorPreview;
      frame = preview ? prepareFrame({ ...preview, visibleElapsed: 0 }, view, screen) : undefined;
      return;
    }
    const source = $subwaySceneState;
    void screenPulse;
    if (!source) {
      frame = undefined;
      return;
    }
    const active = host?.active ?? false;
    const wallMs = Date.now();
    const visibleElapsed = clock.elapsed(
      sessionKey(source.snapshot, { line: source.line, languages: sceneLanguages(source) }),
      wallMs,
    );
    const prepared = prepareFrame({ ...source, visibleElapsed, wallMs }, view, screen);
    frame = prepared;
    if (!active || prepared.wakeInMs === null) return;
    const timeout = window.setTimeout(() => {
      screenPulse++;
    }, prepared.wakeInMs);
    return () => window.clearTimeout(timeout);
  });
</script>

<div
  class="subway-panel absolute inset-0 flex flex-col"
  class:overflow-hidden={host?.mode === 'runtime'}
>
  <CanvasScene
    create={createSubwayScene}
    width={composition.display.w}
    height={composition.display.h}
    {view}
    data={frame}
    revision={frame?.revision}
    opaque
  />
  <div
    class="shrink-0"
    style:height="{composition.strip}px"
  >
    <Slot id="strip" />
  </div>
  <AppletQuickActions />
</div>

<style>
  /* The strip continues the display's own background, so the page reads as one screen. */
  .subway-panel {
    background: #10171b;
  }
</style>
