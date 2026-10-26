<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type {
    SkinSceneFactory,
    SkinSceneRenderer,
    SceneInput,
    SceneMode,
    SceneRect,
  } from './scene';
  import { mapScenePoint, SceneScheduler } from './scene';
  import { runtimeView } from '../../app/runtime/state';
  import { watchDashboardVisibility, watchIntersection } from '../media/content-visibility';
  import { getSkinHostContext } from './context';

  let {
    create,
    width,
    height,
    view,
    data,
    revision = data,
    opaque = false,
    class: className = '',
  }: {
    create: SkinSceneFactory<any>;
    width: number;
    height: number;
    view: string;
    data: unknown;
    revision?: unknown;
    opaque?: boolean;
    class?: string;
  } = $props();
  const host = getSkinHostContext();
  const mode = $derived<SceneMode>(host?.mode === 'editor' ? 'frozen' : 'live');
  let canvas: HTMLCanvasElement;
  let renderer: SkinSceneRenderer | undefined;
  let scheduler: SceneScheduler | undefined;
  let intersecting = $state(false),
    documentVisible = $state(false),
    dashboardVisible = $state(false);
  let runtimeOwner = $state(false);
  let rasterWidth = 0,
    rasterHeight = 0;
  let painted = false;
  let pointer: SceneInput | null = null;
  let lastView: string | undefined, lastSkinId: string | undefined, lastPageId: string | undefined;
  let dprQuery: MediaQueryList | undefined;
  let resizeFrame: number | null = null;

  function resizeBacking() {
    if (!canvas || !width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const scale = host?.designScale ?? 1;
    const nextWidth = Math.ceil(width * scale * ratio),
      nextHeight = Math.ceil(height * scale * ratio);
    if (
      nextWidth <= 0 ||
      nextHeight <= 0 ||
      (nextWidth === rasterWidth && nextHeight === rasterHeight)
    )
      return;
    rasterWidth = nextWidth;
    rasterHeight = nextHeight;
    scheduler?.invalidate();
  }

  function eligible() {
    return (
      (mode === 'frozen' || runtimeOwner) &&
      !!host?.visible &&
      (mode === 'frozen' || !!host?.pageRenderVisible) &&
      documentVisible &&
      (mode === 'frozen' || dashboardVisible) &&
      intersecting &&
      width > 0 &&
      height > 0 &&
      (host?.designScale ?? 1) > 0
    );
  }

  function canPaint() {
    // Prepaint an opaque page once before its first transition into view, then keep hidden pages idle.
    return (
      eligible() ||
      (opaque &&
        !painted &&
        untrack(() => data != null) &&
        mode === 'live' &&
        runtimeOwner &&
        documentVisible &&
        dashboardVisible &&
        width > 0 &&
        height > 0 &&
        (host?.designScale ?? 1) > 0)
    );
  }

  function scheduleBackingResize() {
    if (resizeFrame !== null) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      resizeBacking();
      bindDprQuery();
    });
  }

  function bindDprQuery() {
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener('change', onDprChange, { once: true });
  }

  function onDprChange() {
    scheduleBackingResize();
    bindDprQuery();
  }

  function cancelPointer() {
    if (!pointer) return;
    const last = pointer;
    pointer = null;
    try {
      if (canvas.hasPointerCapture(last.pointerId)) canvas.releasePointerCapture(last.pointerId);
    } catch {}
    const cancel = { ...last, kind: 'cancel' as const, time: performance.now() };
    dispatchSceneInput(cancel, canvas.getBoundingClientRect());
    host?.resetSceneInput();
  }

  function sceneRect(rect: DOMRect): SceneRect {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }

  function dispatchSceneInput(input: SceneInput, rect: DOMRect) {
    const deliver = (event: SceneInput) => renderer?.input?.(event);
    const handled = host?.routeSceneInput(input, sceneRect(rect), deliver) ?? false;
    if (!handled) deliver(input);
    return handled;
  }

  $effect(() => {
    const nextMode = mode,
      nextView = view;
    const skinId = host?.skin.id,
      pageId = host?.page.id;
    const canDraw = eligible();
    if (
      pointer &&
      (nextMode !== 'live' ||
        nextView !== lastView ||
        skinId !== lastSkinId ||
        pageId !== lastPageId ||
        !canDraw)
    )
      cancelPointer();
    lastView = nextView;
    lastSkinId = skinId;
    lastPageId = pageId;
  });

  $effect(() => {
    const nextMode = mode,
      contentRevision = revision,
      nextView = view;
    void contentRevision;
    void nextView;
    resizeBacking();
    scheduler?.setMode(nextMode);
    scheduler?.setActive(canPaint());
    scheduler?.invalidate();
  });

  onMount(() => {
    renderer = create();
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => renderer?.dispose?.();
    scheduler = new SceneScheduler(
      (time) => {
        // Resizing clears a canvas; do it in the same frame as the replacement paint.
        if (canvas.width !== rasterWidth) canvas.width = rasterWidth;
        if (canvas.height !== rasterHeight) canvas.height = rasterHeight;
        const ratioX = canvas.width / width,
          ratioY = canvas.height / height;
        ctx.setTransform(ratioX, 0, 0, ratioY, 0, 0);
        if (!opaque) ctx.clearRect(0, 0, width, height);
        const animate = renderer?.draw({ ctx, width, height, time, mode, view, data }) ?? false;
        painted = true;
        scheduler?.setActive(eligible());
        return animate;
      },
      mode,
      undefined,
      undefined,
      () => renderer?.dispose?.(),
    );
    const visibility = () => {
      documentVisible = document.visibilityState === 'visible';
      if (!eligible()) cancelPointer();
      scheduler?.setActive(canPaint());
    };
    const stopRuntimeOwner = runtimeView.subscribe((snapshot) => {
      if (runtimeOwner === snapshot.owner) return;
      runtimeOwner = snapshot.owner;
      visibility();
    });
    const stopIntersection = watchIntersection(canvas, (value) => {
      intersecting = value;
      visibility();
    });
    let stopDashboard = () => {};
    void watchDashboardVisibility((value) => {
      dashboardVisible = value;
      visibility();
    })
      .then((stop) => {
        if (disposed) stop();
        else stopDashboard = stop;
      })
      .catch(() => {});
    let disposed = false;
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resizeBacking);
    resizeObserver?.observe(canvas);
    document.addEventListener('visibilitychange', visibility);
    const resize = () => {
      scheduleBackingResize();
      bindDprQuery();
    };
    window.addEventListener('resize', resize);
    bindDprQuery();
    visibility();
    resizeBacking();
    scheduler.setActive(canPaint());
    return () => {
      cancelPointer();
      disposed = true;
      stopRuntimeOwner();
      stopIntersection();
      stopDashboard();
      resizeObserver?.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('resize', resize);
      dprQuery?.removeEventListener('change', onDprChange);
      dprQuery = undefined;
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = null;
      scheduler?.dispose();
      scheduler = undefined;
      renderer = undefined;
    };
  });

  function input(kind: SceneInput['kind'], event: PointerEvent) {
    if (kind === 'down') {
      if (pointer) {
        cancelPointer();
        return;
      }
      if (mode !== 'live' || !eligible() || !event.isPrimary || event.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const point = mapScenePoint(event.clientX, event.clientY, rect, width, height);
      if (!point) return;
      const next: SceneInput = {
        kind,
        ...point,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        button: event.button,
        time: performance.now(),
        screenX: event.clientX,
        screenY: event.clientY,
      };
      const handled =
        host?.routeSceneInput(next, sceneRect(rect), (input) => renderer?.input?.(input)) ?? false;
      if (!renderer?.input && !handled) return;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        host?.resetSceneInput();
        if (!handled) renderer?.input?.(next);
        return;
      }
      pointer = next;
      event.preventDefault();
      event.stopPropagation();
      if (!handled) renderer?.input?.(next);
      return;
    }
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (kind === 'cancel' || mode !== 'live' || !eligible()) {
      cancelPointer();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) * width) / rect.width,
      y = ((event.clientY - rect.top) * height) / rect.height;
    const next: SceneInput = {
      kind,
      x,
      y,
      pointerId: pointer.pointerId,
      pointerType: event.pointerType,
      button: event.button,
      time: performance.now(),
      screenX: event.clientX,
      screenY: event.clientY,
    };
    dispatchSceneInput(next, rect);
    if (kind === 'up') pointer = null;
    else pointer = next;
  }
</script>

<canvas
  bind:this={canvas}
  data-skin-input="scene"
  aria-hidden="true"
  class={`block touch-none ${className}`}
  style={`width:${width}px;height:${height}px`}
  onpointerdown={(event) => input('down', event)}
  onpointermove={(event) => input('move', event)}
  onpointerup={(event) => input('up', event)}
  onpointercancel={(event) => input('cancel', event)}
  onlostpointercapture={(event) => input('cancel', event)}
></canvas>
