<script lang="ts">
  // The dashboard window: transparent and frameless; a configurable backdrop sits behind the skin.
  import { onMount, tick } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { isTauri } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import SkinHost from './skins/SkinHost.svelte';
  import { applyDisplay, complementRectangles, getAppliedFullscreen, initDisplay, type LocalRect } from './core/display';
  import { SPRING_SAMPLES, springDuration } from './core/controls';
  import { skins } from './core/registry';
  import { settings } from './core/settings.svelte';
  import { pageById } from './core/pages';
  import { requestPageChange, runtimeView } from './core/runtime.svelte';
  import { pageSwipeIntent, pageSwipeOffset, pageSwipeTarget } from './core/page-swipe';
  import { setMediaContentPages } from './core/content-visibility';

  type DisplayRequest = { monitor: string | null; fullscreen: boolean; alwaysOnTop: boolean };
  type HoverEvent = { hovered: boolean; revision: number; clearClient?: boolean };
  type PagerFrame = { id: string; offset: number; active: boolean; mediaVisible: boolean };
  type PagerSession = {
    pointerId: number; startX: number; startY: number; latestX: number; latestY: number;
    sourceId: string; sourceIndex: number; order: string[]; orderKey: string; width: number;
    source: 'gap' | 'skin-input'; mode: 'pending' | 'horizontal' | 'vertical'; side: number; neighborId?: string;
    hold?: ReturnType<typeof setTimeout>; frame: number | null; generation: number;
  };
  const skin = $derived(skins.get(settings.skin) ?? skins.get('deck')!);
  const page = $derived(pageById(settings.deck.pages, $runtimeView.activePage || settings.deck.activePage)!);
  const bg = $derived(settings.display.background);
  let shell: HTMLDivElement;
  let pageHost: HTMLDivElement;
  let dragGaps = $state<LocalRect[]>([]);
  let pagerFrames = $state<PagerFrame[]>([]);
  let pagerBusy = $state(false);
  let pagerSession: PagerSession | null = null;
  let pagerAnimations: Animation[] = [];
  let pagerGeneration = 0;
  let pagerExpected: { pageId: string; orderKey: string; skin: string; fullscreen: boolean } | null = null;
  let pageNodes = new Map<string, HTMLDivElement>();
  let trackedPageId = '';
  let trackedOrderKey = '';
  let trackedSkin = '';
  let gapFrame = 0;
  let gapResizeObserver: ResizeObserver | undefined;
  let gapMutationObserver: MutationObserver | undefined;
  let observedGapNodes = new Set<Element>();
  let ready = $state(false);
  let appliedFullscreen = $state(false);
  let trackedFullscreen = false;
  let domHovered = $state(false);
  let nativeHovered = $state(false);
  let nativeHoverRevision = -1;
  let lastSuccessfulRequest: DisplayRequest | null = null;
  let lastFailedRequest: DisplayRequest | null = null;
  let draining = false;
  let disposed = false;
  let cleanupDisplay: (() => void) | undefined;
  let cleanupHover: (() => void) | undefined;
  let cleanupResized: (() => void) | undefined;
  let cleanupResize: (() => void) | undefined;
  const hovered = $derived(domHovered || nativeHovered);
  $effect(() => setMediaContentPages(pagerFrames.filter(frame => frame.mediaVisible).map(frame => frame.id)));
  // Native resize loops swallow pointer hover, so keep the edge cues up until resize events go quiet.
  let windowResizing = $state(false);
  let nativeResizing = $state(false);
  let resizeQuiet: ReturnType<typeof setTimeout> | undefined;
  function showResizeCues() {
    windowResizing = true;
    clearTimeout(resizeQuiet);
    resizeQuiet = setTimeout(() => { windowResizing = false; }, 400);
  }
  const sameRequest = (a: DisplayRequest | null, b: DisplayRequest) =>
    !!a && a.monitor === b.monitor && a.fullscreen === b.fullscreen && a.alwaysOnTop === b.alwaysOnTop;
  const currentRequest = (): DisplayRequest => ({
    monitor: settings.display.monitor,
    fullscreen: settings.display.fullscreen,
    alwaysOnTop: settings.display.alwaysOnTop,
  });
  const grips = [
    { direction: 'NorthWest', position: 'top-0 left-0 size-8', cursor: 'cursor-nwse-resize' },
    { direction: 'North', position: 'top-0 left-8 right-8 h-2.5', cursor: 'cursor-ns-resize' },
    { direction: 'NorthEast', position: 'top-0 right-0 size-8', cursor: 'cursor-nesw-resize' },
    { direction: 'East', position: 'right-0 top-8 bottom-8 w-2.5', cursor: 'cursor-ew-resize' },
    { direction: 'SouthEast', position: 'bottom-0 right-0 size-8', cursor: 'cursor-nwse-resize' },
    { direction: 'South', position: 'bottom-0 left-8 right-8 h-2.5', cursor: 'cursor-ns-resize' },
    { direction: 'SouthWest', position: 'bottom-0 left-0 size-8', cursor: 'cursor-nesw-resize' },
    { direction: 'West', position: 'left-0 top-8 bottom-8 w-2.5', cursor: 'cursor-ew-resize' },
  ] as const;

  function visibleSkinRoot() {
    return pageHost?.querySelector<HTMLElement>('[data-visible-page="true"]');
  }

  function measureDragGaps() {
    const skinRoot = visibleSkinRoot();
    if (!shell || !skinRoot || pagerBusy) {
      dragGaps = [];
      return;
    }
    const surface = shell.getBoundingClientRect();
    const excluded: LocalRect[] = [];
    const add = (node: Element) => {
      if (node.closest('[data-skin-input="ui"][aria-hidden="true"]')) return;
      // Opening overlays start their opacity transition at zero; their logical state already owns pointer input.
      const skinSurface = node.matches('[data-skin-input="scene"], [data-skin-input="slot"], [data-skin-input="ui"][aria-hidden="false"]');
      for (let current: Element | null = node; current && current !== skinRoot.parentElement; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || (!skinSurface && Number(style.opacity) === 0)) return;
      }
      const bounds = node.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const rect = { x: bounds.left - surface.left, y: bounds.top - surface.top, width: bounds.width, height: bounds.height };
      if (excluded.some(outer => rect.x >= outer.x && rect.y >= outer.y &&
        rect.x + rect.width <= outer.x + outer.width && rect.y + rect.height <= outer.y + outer.height)) return;
      excluded.push(rect);
    };
    skinRoot.querySelectorAll('[data-dashboard-tile]').forEach(add);
    skinRoot.querySelectorAll('[data-skin-input], .tile, button, input, select, textarea, a, [contenteditable], [role="slider"]').forEach(add);
    shell.querySelectorAll('.dashboard-page-dots, .dashboard-page-dots button').forEach(add);
    shell.querySelectorAll('[data-resize-handle]').forEach(add);
    dragGaps = complementRectangles(surface.width, surface.height, excluded, window.devicePixelRatio || 1);
  }

  function scheduleDragGapMeasure() {
    if (gapFrame || !shell) return;
    gapFrame = requestAnimationFrame(() => {
      gapFrame = 0;
      measureDragGaps();
    });
  }

  function observeGapNodes() {
    if (!gapResizeObserver || !pageHost) return;
    const skinRoot = visibleSkinRoot();
    const next = new Set<Element>([...(skinRoot ? [skinRoot] : []), ...shell.querySelectorAll('.dashboard-page-dots, .dashboard-page-dots button, [data-resize-handle]')]);
    skinRoot?.querySelectorAll('[data-skin-input], [data-dashboard-tile], .tile, button, input, select, textarea, a, [contenteditable], [role="slider"]')
      .forEach(node => next.add(node));
    for (const node of observedGapNodes) if (!next.has(node)) gapResizeObserver.unobserve(node);
    for (const node of next) if (!observedGapNodes.has(node)) gapResizeObserver.observe(node);
    observedGapNodes = next;
  }

  function registerPage(node: HTMLDivElement, id: string) {
    pageNodes.set(id, node);
    return { destroy() { if (pageNodes.get(id) === node) pageNodes.delete(id); } };
  }

  function activeFrames(pageId = page.id): PagerFrame[] {
    const pages = settings.deck.pages, index = pages.findIndex(candidate => candidate.id === pageId);
    const width = shell?.getBoundingClientRect().width ?? 0;
    const frames: PagerFrame[] = [{ id: pageId, offset: 0, active: true, mediaVisible: true }];
    if (index > 0) frames.unshift({ id: pages[index - 1].id, offset: -width, active: false, mediaVisible: false });
    if (index >= 0 && index + 1 < pages.length)
      frames.push({ id: pages[index + 1].id, offset: width, active: false, mediaVisible: false });
    return frames;
  }

  function cancelPagerAnimations() {
    for (const animation of pagerAnimations) animation.cancel();
    pagerAnimations = [];
  }

  function removePagerListeners() {
    window.removeEventListener('pointermove', onPagerMove, true);
    window.removeEventListener('pointerup', onPagerUp, true);
    window.removeEventListener('pointercancel', onPagerCancel, true);
    window.removeEventListener('pointerdown', onPagerNewPointerDown, true);
    window.removeEventListener('blur', onPagerBlur);
    shell?.removeEventListener('lostpointercapture', onPagerLostCapture);
  }

  function releasePagerPointer(session: PagerSession) {
    try {
      if (shell?.hasPointerCapture(session.pointerId)) shell.releasePointerCapture(session.pointerId);
    } catch { /* The window listeners also cover engines without pointer capture. */ }
  }

  function cancelPagerToCurrent(pageId = page.id) {
    const session = pagerSession;
    pagerSession = null;
    if (session) {
      clearTimeout(session.hold);
      if (session.frame !== null) cancelAnimationFrame(session.frame);
      removePagerListeners();
      releasePagerPointer(session);
    }
    pagerGeneration++;
    cancelPagerAnimations();
    pagerExpected = null;
    pagerFrames = activeFrames(pageId);
    pagerBusy = false;
    scheduleDragGapMeasure();
  }

  function pageOffset(offset: number) {
    return `translate3d(${Number.isFinite(offset) ? offset : 0}px,0,0)`;
  }

  function paintPager(session: PagerSession) {
    if (pagerSession !== session || session.mode !== 'horizontal') return;
    const dx = session.latestX - session.startX;
    const offset = pageSwipeOffset(dx, session.width, session.sourceIndex, session.order.length);
    pagerFrames = session.neighborId
      ? [
          { id: session.sourceId, offset, active: true, mediaVisible: true },
          { id: session.neighborId, offset: (session.side * session.width) + dx, active: false, mediaVisible: true },
        ]
      : [{ id: session.sourceId, offset, active: true, mediaVisible: true }];
  }

  function schedulePagerPaint(session: PagerSession) {
    if (session.frame !== null) return;
    session.frame = requestAnimationFrame(() => {
      session.frame = null;
      paintPager(session);
    });
  }

  function springKeyframes(from: number, to: number) {
    return SPRING_SAMPLES.map(sample => ({
      transform: pageOffset(from + (to - from) * sample.progress),
      offset: sample.offset,
    }));
  }

  async function animatePager(session: PagerSession, targetId: string) {
    if (pagerGeneration !== session.generation) return;
    const targetIndex = settings.deck.pages.findIndex(candidate => candidate.id === targetId);
    const sourceIndex = settings.deck.pages.findIndex(candidate => candidate.id === session.sourceId);
    if (targetIndex < 0 || sourceIndex < 0 || Math.abs(targetIndex - sourceIndex) > 1) {
      cancelPagerToCurrent();
      return;
    }
    const side = targetIndex > sourceIndex ? 1 : targetIndex < sourceIndex ? -1 : session.side;
    const frames = pagerFrames.map(frame => ({ ...frame, active: frame.id === targetId,
      mediaVisible: frame.id === targetId || frame.id === session.sourceId }));
    if (!frames.some(frame => frame.id === targetId)) frames.push({ id: targetId, offset: side * session.width, active: false, mediaVisible: true });
    pagerFrames = frames;
    await tick();
    if (pagerGeneration !== session.generation) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      pagerFrames = activeFrames(targetId);
      await tick();
      if (pagerGeneration === session.generation) {
        pagerBusy = false;
        pagerExpected = null;
        observeGapNodes();
        scheduleDragGapMeasure();
      }
      return;
    }

    const animations: Animation[] = [];
    for (const frame of frames) {
      const node = pageNodes.get(frame.id);
      if (!node) continue;
      const destination = frame.id === targetId ? 0 : frame.id === session.sourceId ? -side * session.width : frame.offset;
      const distance = Math.abs(destination - frame.offset);
      if (distance < 0.5) continue;
      const animation = node.animate(springKeyframes(frame.offset, destination), {
        duration: springDuration(distance), fill: 'both',
      });
      animations.push(animation);
    }
    pagerAnimations = animations;
    await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
    if (pagerGeneration !== session.generation) return;
    pagerFrames = activeFrames(targetId);
    await tick();
    if (pagerGeneration !== session.generation) return;
    cancelPagerAnimations();
    pagerBusy = false;
    pagerExpected = null;
    observeGapNodes();
    scheduleDragGapMeasure();
  }

  function clearPagerSession(session: PagerSession, release = true) {
    if (pagerSession !== session) return false;
    pagerSession = null;
    clearTimeout(session.hold);
    if (session.frame !== null) cancelAnimationFrame(session.frame);
    session.frame = null;
    removePagerListeners();
    if (release) releasePagerPointer(session);
    return true;
  }

  function startNativeGapDrag(session: PagerSession) {
    if (pagerSession !== session || !isTauri() || appliedFullscreen) return;
    clearPagerSession(session);
    pagerFrames = activeFrames(session.sourceId);
    pagerBusy = false;
    scheduleDragGapMeasure();
    getCurrentWindow().startDragging().catch(error => console.warn('drag', error));
  }

  function lockPagerIntent(session: PagerSession, mode: 'horizontal' | 'vertical') {
    if (pagerSession !== session || session.mode !== 'pending') return;
    clearTimeout(session.hold);
    session.hold = undefined;
    session.mode = mode;
    if (mode === 'vertical') {
      if (session.source === 'skin-input') {
        if (clearPagerSession(session, false)) {
          pagerBusy = false;
          pagerFrames = activeFrames(session.sourceId);
          scheduleDragGapMeasure();
        }
        return;
      }
      if (!appliedFullscreen && isTauri()) startNativeGapDrag(session);
      else cancelPagerToCurrent(session.sourceId);
      return;
    }
    if (session.source === 'skin-input') {
      try { shell.setPointerCapture(session.pointerId); }
      catch { /* Window capture listeners still track the horizontal swipe. */ }
    }
    const dx = session.latestX - session.startX;
    session.side = dx < 0 ? 1 : -1;
    const neighborIndex = session.sourceIndex + session.side;
    session.neighborId = session.order[neighborIndex];
    paintPager(session);
  }

  function onPagerMove(event: PointerEvent) {
    const session = pagerSession;
    if (!session || session.pointerId !== event.pointerId) return;
    session.latestX = event.clientX;
    session.latestY = event.clientY;
    const dx = session.latestX - session.startX;
    const dy = session.latestY - session.startY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= 1) {
      clearTimeout(session.hold);
      session.hold = undefined;
    }
    if (session.mode === 'pending') {
      const intent = pageSwipeIntent(dx, dy);
      if (intent !== 'pending') lockPagerIntent(session, intent);
    }
    if (session.mode === 'horizontal') {
      if (event.cancelable) event.preventDefault();
      schedulePagerPaint(session);
    }
  }

  async function finishPager(session: PagerSession, cancelled: boolean) {
    if (pagerSession !== session) return;
    if (session.source === 'skin-input' && session.mode === 'pending') {
      if (clearPagerSession(session, false)) {
        pagerBusy = false;
        scheduleDragGapMeasure();
      }
      return;
    }
    if (session.frame !== null) cancelAnimationFrame(session.frame);
    session.frame = null;
    if (!cancelled && session.mode === 'horizontal') paintPager(session);
    if (!clearPagerSession(session)) return;
    const orderKey = settings.deck.pages.map(candidate => candidate.id).join('\u0000');
    const valid = !cancelled && session.mode === 'horizontal' && orderKey === session.orderKey &&
      settings.skin === trackedSkin && appliedFullscreen === trackedFullscreen && page.id === session.sourceId &&
      pagerGeneration === session.generation;
    if (!valid) {
      if (pagerGeneration === session.generation) void animatePager(session, session.sourceId);
      return;
    }
    const dx = session.latestX - session.startX;
    const targetIndex = pageSwipeTarget(dx, session.width, session.sourceIndex, session.order.length);
    const targetId = session.order[targetIndex] ?? session.sourceId;
    if (targetId !== session.sourceId) pagerExpected = { pageId: targetId, orderKey, skin: settings.skin, fullscreen: appliedFullscreen };
    let accepted = targetId === session.sourceId;
    if (!accepted) {
      try { accepted = await requestPageChange({ page: targetId }, 'swipe'); }
      catch { accepted = false; }
    }
    await tick();
    if (pagerGeneration !== session.generation) return;
    if (!accepted || page.id !== targetId) {
      pagerExpected = null;
      if (page.id !== session.sourceId) cancelPagerToCurrent();
      else void animatePager(session, session.sourceId);
      return;
    }
    void animatePager(session, targetId);
  }

  function onPagerUp(event: PointerEvent) {
    const session = pagerSession;
    if (!session || session.pointerId !== event.pointerId) return;
    session.latestX = event.clientX;
    session.latestY = event.clientY;
    void finishPager(session, false);
  }

  function onPagerCancel(event: PointerEvent) {
    const session = pagerSession;
    if (session?.pointerId === event.pointerId) void finishPager(session, true);
  }

  function onPagerLostCapture(event: PointerEvent) {
    if (event.target !== shell) return;
    const session = pagerSession;
    if (session?.pointerId === event.pointerId) void finishPager(session, true);
  }

  function onPagerBlur() { cancelPagerToCurrent(); }
  function onPagerNewPointerDown(event: PointerEvent) {
    if (pagerSession && pagerSession.pointerId !== event.pointerId) cancelPagerToCurrent();
  }

  function onPagerPointerDown(event: PointerEvent) {
    const target = event.target;
    if (!(target instanceof Element) || !event.isPrimary || event.button !== 0) return;
    const gap = target.closest('.dashboard-drag-gap');
    const skinInput = target.closest<HTMLElement>('[data-skin-input="scene"], [data-skin-input="slot"]');
    const interactive = target.closest('[data-dashboard-tile], button, input, select, textarea, a, [contenteditable], [role="slider"]');
    if (!gap && (!skinInput || interactive)) return;
    const source = gap ? 'gap' : 'skin-input';
    const pages = settings.deck.pages;
    const sourceIndex = pages.findIndex(candidate => candidate.id === page.id);
    if (sourceIndex < 0) return;
    if (pages.length <= 1) {
      if (source === 'gap' && isTauri() && !appliedFullscreen) {
        event.preventDefault();
        getCurrentWindow().startDragging().catch(error => console.warn('drag', error));
      }
      return;
    }
    if (skin.pageNavigation === 'skin') return;
    if (source === 'gap') event.preventDefault();
    if (pagerSession) cancelPagerToCurrent();
    cancelPagerAnimations();
    const rect = shell.getBoundingClientRect();
    const order = pages.map(candidate => candidate.id);
    const session: PagerSession = {
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      latestX: event.clientX, latestY: event.clientY, sourceId: page.id, sourceIndex,
      order, orderKey: order.join('\u0000'), width: rect.width, mode: 'pending', side: 0,
      source,
      frame: null, generation: ++pagerGeneration,
    };
    pagerSession = session;
    pagerBusy = true;
    session.hold = source === 'gap' && isTauri() && !appliedFullscreen
      ? setTimeout(() => startNativeGapDrag(session), 250)
      : undefined;
    window.addEventListener('pointermove', onPagerMove, true);
    window.addEventListener('pointerup', onPagerUp, true);
    window.addEventListener('pointercancel', onPagerCancel, true);
    window.addEventListener('pointerdown', onPagerNewPointerDown, true);
    window.addEventListener('blur', onPagerBlur);
    shell.addEventListener('lostpointercapture', onPagerLostCapture);
    if (source === 'gap') {
      try { shell.setPointerCapture(event.pointerId); }
      catch { /* The window capture listeners also complete the pointer session. */ }
    }
  }

  function onPagerResize() {
    if (pagerSession || pagerBusy) cancelPagerToCurrent();
    else pagerFrames = activeFrames();
    scheduleDragGapMeasure();
  }

  async function drainDisplay() {
    if (!ready || disposed || draining) return;
    draining = true;
    try {
      while (!disposed) {
        const display = $state.snapshot(settings.display);
        const request = { monitor: display.monitor, fullscreen: display.fullscreen, alwaysOnTop: display.alwaysOnTop };
        if (sameRequest(lastSuccessfulRequest, request) || sameRequest(lastFailedRequest, request)) break;
        try {
          const fullscreen = await applyDisplay(display, lastSuccessfulRequest?.monitor !== request.monitor);
          if (disposed) break;
          appliedFullscreen = fullscreen;
          lastSuccessfulRequest = request;
          lastFailedRequest = null;
        } catch (error) {
          if (!disposed) console.warn('display', error);
          lastFailedRequest = request;
          break;
        }
        if (sameRequest(currentRequest(), request)) break;
      }
    } finally {
      draining = false;
      const latest = currentRequest();
      if (!disposed && ready && !sameRequest(lastSuccessfulRequest, latest) && !sameRequest(lastFailedRequest, latest)) {
        queueMicrotask(() => void drainDisplay());
      }
    }
  }

  onMount(() => {
    disposed = false;
    pagerFrames = activeFrames(page.id);
    trackedPageId = page.id;
    trackedOrderKey = settings.deck.pages.map(entry => entry.id).join('\u0000');
    trackedSkin = settings.skin;
    trackedFullscreen = appliedFullscreen;
    const resize = () => onPagerResize();
    window.addEventListener('resize', resize);
    document.addEventListener('fullscreenchange', resize);
    gapResizeObserver = new ResizeObserver(scheduleDragGapMeasure);
    gapResizeObserver.observe(shell);
    observeGapNodes();
    gapMutationObserver = new MutationObserver(() => {
      observeGapNodes();
      scheduleDragGapMeasure();
    });
    gapMutationObserver.observe(pageHost, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-visible-page', 'data-skin-input', 'aria-hidden', 'inert', 'style'] });
    scheduleDragGapMeasure();
    const initialDisplay = $state.snapshot(settings.display);
    let cleanup: (() => void) | undefined;

    const reveal = async () => {
      ready = true;
      await tick();
      if (!disposed && isTauri()) await getCurrentWindow().show();
    };

    void (async () => {
      if (isTauri()) {
        try {
          const stopResized = await getCurrentWindow().onResized(() => {
            onPagerResize();
            if (ready && !appliedFullscreen) showResizeCues();
          });
          cleanupResized = stopResized;
          cleanupHover = await listen<HoverEvent>('dashboard-hover', event => {
            const payload = event.payload;
            if (disposed || !Number.isSafeInteger(payload.revision) || payload.revision <= nativeHoverRevision) return;
            nativeHoverRevision = payload.revision;
            nativeHovered = payload.hovered === true;
            if (payload.clearClient) domHovered = false;
          });
          cleanupResize = await listen<boolean>('dashboard-resize', event => {
            nativeResizing = event.payload;
            clearTimeout(resizeQuiet);
            resizeQuiet = undefined;
            windowResizing = event.payload;
          });
        } catch (error) {
          console.warn('dashboard hover listener', error);
        }
      }
      try {
        cleanup = await initDisplay(initialDisplay, $state.snapshot(page), () => disposed);
        if (disposed) {
          cleanup?.();
          return;
        }
        appliedFullscreen = getAppliedFullscreen();
        lastSuccessfulRequest = { monitor: initialDisplay.monitor, fullscreen: appliedFullscreen, alwaysOnTop: initialDisplay.alwaysOnTop };
      } catch (error) {
        if (disposed) return;
        console.warn('display initialization failed; showing the safe dashboard window', error);
        appliedFullscreen = false;
        lastFailedRequest = { monitor: initialDisplay.monitor, fullscreen: initialDisplay.fullscreen, alwaysOnTop: initialDisplay.alwaysOnTop };
      }
      if (disposed) {
        cleanup?.();
        cleanupHover?.();
        cleanupResized?.();
        cleanupResize?.();
        return;
      }
      cleanupDisplay = cleanup;
      await reveal();
      void drainDisplay();
    })().catch(error => console.warn('dashboard reveal failed', error));

    return () => {
      disposed = true;
      cancelPagerToCurrent();
      cancelPagerAnimations();
      setMediaContentPages([]);
      if (gapFrame) cancelAnimationFrame(gapFrame);
      gapResizeObserver?.disconnect();
      gapMutationObserver?.disconnect();
      observedGapNodes.clear();
      gapResizeObserver = undefined;
      gapMutationObserver = undefined;
      cleanupDisplay?.();
      cleanupHover?.();
      cleanupResized?.();
      cleanupResize?.();
      window.removeEventListener('resize', resize);
      document.removeEventListener('fullscreenchange', resize);
      clearTimeout(resizeQuiet);
      cleanup?.();
    };
  });

  $effect(() => {
    const active = page;
    const activeId = active.id;
    const orderKey = settings.deck.pages.map(entry => entry.id).join('\u0000');
    const skin = settings.skin;
    const fullscreen = appliedFullscreen;
    const expected = pagerExpected;
    if (expected && expected.pageId === activeId && expected.orderKey === orderKey &&
      expected.skin === skin && expected.fullscreen === fullscreen) {
      trackedPageId = activeId;
      trackedOrderKey = orderKey;
      trackedSkin = skin;
      trackedFullscreen = fullscreen;
      pagerExpected = null;
    } else if (activeId !== trackedPageId || orderKey !== trackedOrderKey || skin !== trackedSkin || fullscreen !== trackedFullscreen) {
      trackedPageId = activeId;
      trackedOrderKey = orderKey;
      trackedSkin = skin;
      trackedFullscreen = fullscreen;
      cancelPagerToCurrent(activeId);
    }
    active.id; active.cols; active.rows; active.size; active.gap; active.sizing;
    for (const item of active.items) { item.x; item.y; item.w; item.h; }
    if (gapResizeObserver) void tick().then(scheduleDragGapMeasure);
  });

  // Display policy changes are serialized; backdrop edits stay outside native window effects.
  $effect(() => {
    const request = currentRequest();
    if (ready && !sameRequest(lastSuccessfulRequest, request) && !sameRequest(lastFailedRequest, request)) {
      void drainDisplay();
    }
  });
</script>

<div role="region" aria-label="Dashboard" class="dashboard-shell relative h-full w-full overflow-hidden" data-fullscreen={appliedFullscreen}
  data-hovered={hovered || windowResizing || nativeResizing}
  style:border-radius="{appliedFullscreen ? 0 : bg.radius}px"
  bind:this={shell} onpointerdowncapture={onPagerPointerDown}
  onpointerenter={() => { domHovered = true; }} onpointerleave={() => { domHovered = false; }}>
  <div aria-hidden="true" class="dashboard-backdrop" style:background={bg.color}
    style:opacity={Number.isFinite(bg.opacity) ? Math.max(0, Math.min(1, bg.opacity)) : 0}></div>
  <div class="dashboard-skin" data-has-pages={settings.deck.pages.length > 1 && skin.pageNavigation !== 'skin'} bind:this={pageHost}>
    <div class="dashboard-pages">
      {#each pagerFrames as frame (frame.id)}
        {@const framePage = settings.deck.pages.find(candidate => candidate.id === frame.id)}
        {#if framePage}
          <div class="dashboard-page-frame" class:dashboard-page-inactive={!frame.active}
            data-visible-page={frame.active ? 'true' : undefined} aria-hidden={!frame.active} inert={!frame.active}
            style:transform={pageOffset(frame.offset)} use:registerPage={frame.id}>
            <SkinHost {skin} page={framePage} visible={frame.active} pageRenderVisible={true} />
          </div>
        {/if}
      {/each}
    </div>
  </div>
  {#if settings.deck.pages.length > 1 && skin.pageNavigation !== 'skin'}
    <nav class="dashboard-page-dots" aria-label="Pages">
      {#each settings.deck.pages as dotPage (dotPage.id)}
        <button type="button" aria-label="Go to {dotPage.name}" aria-current={page.id === dotPage.id ? 'page' : undefined}
          class:dashboard-page-dot-active={page.id === dotPage.id}
          onpointerdown={event => event.preventDefault()}
          onclick={() => { void requestPageChange({ page: dotPage.id }, 'dot').catch(error => console.warn('page navigation', error)); }}>
          <span aria-hidden="true"></span>
        </button>
      {/each}
    </nav>
  {/if}
  {#if !pagerBusy}
    {#each dragGaps as gap}
      <div aria-hidden="true" class="dashboard-drag-gap" style:left="{gap.x}px" style:top="{gap.y}px"
        style:width="{gap.width}px" style:height="{gap.height}px"></div>
    {/each}
  {/if}
  {#if !appliedFullscreen}
    <div aria-hidden="true" class="resize-cues"></div>
    {#each grips as grip}
      <button type="button" data-resize-handle={grip.direction} aria-label="Resize window {grip.direction}"
        aria-roledescription="Window resize handle"
        class="absolute z-50 m-0 touch-none border-0 bg-transparent p-0 {grip.position} {grip.cursor}"
        onpointerdown={e => {
          if (!isTauri() || e.button !== 0 || !e.isPrimary || appliedFullscreen) return;
          e.preventDefault();
          e.stopPropagation();
          showResizeCues();
          getCurrentWindow().startResizeDragging(grip.direction).catch(err => console.warn('resize', err));
        }}></button>
    {/each}
  {/if}
</div>

<style>
  :global(.dashboard-shell),
  :global(.dashboard-shell *) {
    -webkit-app-region: no-drag;
  }

  :global(.dashboard-shell) {
    isolation: isolate;
    --resize-ink: rgba(255, 255, 255, .15);
  }

  /* Dragged through startDragging: WebView2's app-region never moved this no-activate window and swallowed the press. */
  :global(.dashboard-shell .dashboard-drag-gap) {
    position: absolute;
    z-index: 20;
    touch-action: none;
  }

  :global(.dashboard-shell .resize-cues) {
    position: absolute;
    z-index: 40;
    inset: 0;
    pointer-events: none;
    border-radius: inherit;
    box-shadow: inset 0 0 0 1.5px var(--resize-ink);
    opacity: 0;
    transition: opacity 160ms ease-out;
  }

  :global(.dashboard-shell .dashboard-backdrop) {
    position: absolute;
    z-index: 0;
    inset: 0;
    pointer-events: none;
    border-radius: inherit;
  }

  :global(.dashboard-shell .dashboard-skin) {
    position: absolute;
    z-index: 10;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  :global(.dashboard-shell .dashboard-skin[data-has-pages='true']) {
    bottom: 34px;
    height: auto;
  }

  :global(.dashboard-shell .dashboard-pages),
  :global(.dashboard-shell .dashboard-page-frame) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  :global(.dashboard-shell .dashboard-pages) {
    overflow: hidden;
    contain: layout paint;
  }

  :global(.dashboard-shell .dashboard-page-frame) {
    will-change: transform;
  }

  :global(.dashboard-shell .dashboard-page-inactive) {
    pointer-events: none;
  }

  :global(.dashboard-shell .dashboard-page-dots) {
    position: absolute;
    z-index: 30;
    left: 50%;
    bottom: 5px;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 2px;
    max-width: calc(100% - 24px);
    overflow-x: auto;
    overflow-y: hidden;
    transform: translateX(-50%);
    scrollbar-width: none;
    -ms-overflow-style: none;
    touch-action: pan-x;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease-out;
  }

  :global(.dashboard-shell[data-hovered='true'] .dashboard-page-dots) { opacity: 1; pointer-events: auto; }

  :global(.dashboard-shell .dashboard-page-dots::-webkit-scrollbar) { display: none; }

  :global(.dashboard-shell .dashboard-page-dots button) {
    display: grid;
    flex: 0 0 24px;
    width: 24px;
    height: 24px;
    place-items: center;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
  }

  :global(.dashboard-shell .dashboard-page-dots span) {
    display: block;
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: rgba(255, 255, 255, .42);
    opacity: .72;
    transition: opacity 120ms ease-out;
  }

  :global(.dashboard-shell .dashboard-page-dots .dashboard-page-dot-active span) {
    background: rgba(255, 255, 255, .95);
    opacity: 1;
  }

  :global(.dashboard-shell[data-hovered='true'] .resize-cues) {
    --resize-ink: rgba(255, 255, 255, .32);
    opacity: 1;
    transition-duration: 120ms;
  }


  @media (prefers-reduced-motion: reduce) {
    :global(.dashboard-shell .resize-cues),
    :global(.dashboard-shell[data-hovered='true'] .resize-cues) { transition-duration: 0ms; }
  }

  @media (pointer: coarse) {
    :global(.dashboard-shell .resize-cues) { --resize-ink: rgba(255, 255, 255, .08); }
    :global(.dashboard-shell .dashboard-page-dots) { opacity: 1; pointer-events: auto; }
  }
</style>
