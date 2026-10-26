<script lang="ts">
  import type { Component } from 'svelte';
  import { onDestroy, tick } from 'svelte';
  import { projectMoveOrigin, resizeCornerGeometry, resizePreview, resizeFromCornerHysteretic, SPRING_SAMPLES, springDuration,
    type ControlFaceProps, type ResizeCorner, type TilePresentation } from '../core/controls';
  import { commit } from '../core/history.svelte';
  import { clampResizeRect, fits, fitDeck, inside, previewDrop, type DropPreview, type FittedDeck, type Item, type Selection } from '../core/layout';
  import { controlTypes } from '../core/registry';
  import { controlById, settings } from '../core/settings.svelte';
  import type { Page } from '../features/settings/schema';
  import type { EffectiveSize, LayoutTarget } from '../core/skin-layouts';
  import { runtimeView } from '../core/runtime.svelte';
  import { animateRemoval, registerRemovalNode } from './removal';
  import { DropPreviewWorker } from './drop-worker';
  import ResizeFrame from './ResizeFrame.svelte';

  type GridLayout = Pick<Page, 'rows' | 'cols' | 'size' | 'sizing' | 'gap'> & { items: Item[] };
  let { page, layout, target, onitemschange, faceMap, compact = false, resolveSize, editorPreview = false,
    editing = false, selected = null, availableWidth, availableHeight, pageRenderVisible = false, resolvePresentation, onselect, oncontext }:
    { page: Page; layout?: GridLayout; target?: LayoutTarget; onitemschange?: (items: Item[]) => boolean | void;
      faceMap?: Record<string, Component<ControlFaceProps>>; compact?: boolean; resolveSize?: (typeId: string) => Pick<EffectiveSize, 'min' | 'max'> | undefined;
      editorPreview?: boolean;
      editing?: boolean; selected?: Selection; availableWidth?: number; availableHeight?: number; pageRenderVisible?: boolean; onselect?: (s: Selection, target?: LayoutTarget) => void;
      resolvePresentation?: (control: import('../core/controls').ControlConfig, variantIndex: number) => TilePresentation;
      oncontext?: (target: { item: string } | { cell: { x: number; y: number } }, x: number, y: number, layoutTarget?: LayoutTarget) => void } = $props();

  const deck = $derived(layout ?? page);
  const targetKey = $derived(target ? `${target.skinId}/${target.pageId}/${target.slotId}` : `deck/${page.id}/main`);
  function currentLayoutSignature() { return JSON.stringify({ target: targetKey, items: deck.items }); }
  const intrinsic: FittedDeck = $derived({ cell: deck.size, gap: deck.gap,
    width: deck.cols * deck.size + (deck.cols + 1) * deck.gap,
    height: deck.rows * deck.size + (deck.rows + 1) * deck.gap });
  let lastFit = $state<FittedDeck | null>(null);
  $effect(() => {
    if (availableWidth == null || availableHeight == null) { lastFit = null; return; }
    const fit = fitDeck(deck, availableWidth, availableHeight);
    if (fit && (!lastFit || fit.cell !== lastFit.cell || fit.gap !== lastFit.gap ||
      fit.width !== lastFit.width || fit.height !== lastFit.height)) lastFit = fit;
  });
  const metrics = $derived(availableWidth == null || availableHeight == null ? intrinsic : lastFit ?? intrinsic);
  const pitch = $derived(metrics.cell + metrics.gap);
  const items = $derived(deck.items.flatMap(item => {
    if (!inside(item, deck)) return [];
    const control = controlById(item.control);
    const def = control && controlTypes.get(control.type);
    return control && def ? [{ item, control, def }] : [];
  }));
  function select(selection: Selection) { onselect?.(selection, target); }
  function writeItems(next: Item[], label: string) {
    commit(label);
    if (onitemschange) return onitemschange(next) !== false;
    page.items = next;
    return true;
  }
  let grid = $state<HTMLElement>();
  const nodes = new Map<string, HTMLElement>();
  const motionNodes = new Map<string, HTMLElement>();
  const chromeNodes = new Map<string, Set<HTMLElement>>();
  const chromeAnimations = new Map<string, Map<HTMLElement, Animation>>();
  const removing = $state<Record<string, boolean>>({});
  const elevated = $state<Record<string, boolean>>({});
  const registerMotion = (node: HTMLElement, id: string) => {
    motionNodes.set(id, node);
    return { destroy() { motionNodes.delete(id); } };
  };
  function removeChromeNode(id: string, node: HTMLElement) {
    chromeNodes.get(id)?.delete(node);
    if (!chromeNodes.get(id)?.size) chromeNodes.delete(id);
    const animation = chromeAnimations.get(id)?.get(node);
    animation?.cancel();
    chromeAnimations.get(id)?.delete(node);
    if (!chromeAnimations.get(id)?.size) chromeAnimations.delete(id);
    node.inert = false;
    node.style.pointerEvents = '';
    node.style.opacity = '';
  }
  function addChromeNode(id: string, node: HTMLElement) {
    const group = chromeNodes.get(id) ?? new Set<HTMLElement>();
    group.add(node);
    chromeNodes.set(id, group);
    if (removing[id]) {
      node.inert = true;
      node.style.pointerEvents = 'none';
      node.style.opacity = '0';
    }
  }
  const registerChrome = (node: HTMLElement, initialId: string) => {
    let id = initialId;
    addChromeNode(id, node);
    return {
      update(nextId: string) {
        if (nextId === id) return;
        removeChromeNode(id, node);
        id = nextId;
        addChromeNode(id, node);
      },
      destroy() { removeChromeNode(id, node); },
    };
  };
  function context(e: MouseEvent, selection: Exclude<Selection, null>) {
    if (!editing || ('item' in selection && removing[selection.item])) return;
    e.preventDefault();
    e.stopPropagation();
    cancelDrag();
    select(selection);
    oncontext?.(selection, e.clientX, e.clientY, target);
  }
  const register = (node: HTMLElement, id: string) => {
    nodes.set(id, node);
    const removal = registerRemovalNode(node, id, () => startRemoval(id));
    const menu = (e: MouseEvent) => context(e, { item: id });
    node.addEventListener('contextmenu', menu);
    return { destroy() { nodes.delete(id); removal.destroy(); clearRemoval(id); node.removeEventListener('contextmenu', menu); } };
  };

  type Box = { x: number; y: number; width: number; height: number };
  type PointerSample = { x: number; y: number };
  type Drag = { id: string; item: Item; mode: 'move' | 'resize'; pointerId: number; capture: HTMLElement;
    startX: number; startY: number; latest: PointerSample; raf: number | null; grabOffsetX: number; grabOffsetY: number;
    baseX: number; baseY: number; screenDistance: number; corner: ResizeCorner; scale: number; originX: number; originY: number;
    dx: number; dy: number; pitch: number; gap: number; min: { w: number; h: number }; max: { w: number; h: number };
    pixelObstacles: { x: number; y: number; w: number; h: number }[]; cellObstacles: { x: number; y: number; w: number; h: number }[];
    frameRadius: number;
    target: Item; validResize: Item; ghost: Box; placement: DropPreview | null; ok: boolean; moved: boolean;
    moveX: number; moveY: number; pointerInside: boolean; pending: boolean; readyForRelease: boolean;
    generation: number; requestToken: number; layoutSignature: string; requestedX: number | null; requestedY: number | null; readyFrame: number | null };
  let drag = $state<Drag | null>(null);
  const editingChromeHidden = $derived(!!drag?.moved || Object.values(elevated).some(Boolean));
  let dropWorker: DropPreviewWorker | null = null;
  let dragGeneration = 0;
  let removalMove = $state<Drag | null>(null);
  let removalResize = $state<{ id: string; box: Box; invalid: boolean; radius: number } | null>(null);
  let settlingFrame = $state<{ id: string; from: Box; target: Box; token: number; radius: number } | null>(null);
  let resizeFrame = $state<{ settleTo(target: Box, duration?: number): Promise<void>; cancelSettle(): void } | undefined>(undefined);
  let frameGeneration = 0;
  const frameBox = $derived(drag?.mode === 'resize' && drag.moved ? drag.ghost : settlingFrame?.from ?? removalResize?.box ?? null);
  const frameInvalid = $derived(drag?.mode === 'resize' && drag.moved ? !drag.ok : removalResize?.invalid ?? false);
  const frameRadius = $derived(drag?.mode === 'resize' ? drag.frameRadius : settlingFrame?.radius ?? removalResize?.radius ?? 22);

  let previousLayout = '', previousGrid = '', previousMetrics = '';
  let previousEditing = false;
  let revision = 0;
  const animations = new Map<string, Animation[]>();
  const offsets = $state<Record<string, { x: number; y: number }>>({});
  const stop = (id: string) => {
    for (const animation of animations.get(id) ?? []) animation.cancel();
    animations.delete(id);
    elevated[id] = false;
  };
  const springFrames = (x: number, y: number) => SPRING_SAMPLES.map(sample => ({
    offset: sample.offset,
    translate: `${x * (1 - sample.progress)}px ${y * (1 - sample.progress)}px`,
  }));
  const readTranslation = (node: HTMLElement) => {
    const value = getComputedStyle(node).translate;
    if (value === 'none') return { x: 0, y: 0 };
    const [x, y] = value.split(/\s+/).map(v => Number.parseFloat(v) || 0);
    return { x, y: y ?? 0 };
  };
  function settleMove(id: string, node: HTMLElement, pose: { x: number; y: number }, distance: number) {
    offsets[id] = { x: 0, y: 0 };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || (!pose.x && !pose.y)) return;
    elevated[id] = true;
    const animation = node.animate(springFrames(pose.x, pose.y), { duration: springDuration(distance), fill: 'both' });
    animations.set(id, [animation]);
    void animation.finished.then(() => {
      if (!animations.get(id)?.includes(animation)) return;
      animations.delete(id);
      animation.cancel();
      elevated[id] = false;
    }).catch(() => {});
  }
  const boxForItem = (item: Item, itemPitch: number, gap: number): Box => ({
    x: item.x * itemPitch + gap, y: item.y * itemPitch + gap,
    width: item.w * itemPitch - gap, height: item.h * itemPitch - gap,
  });
  function settleResize(id: string, from: Box, target: Box, distance: number, radius: number) {
    const token = ++frameGeneration;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      settlingFrame = null;
      return;
    }
    settlingFrame = { id, from, target, token, radius };
    const duration = Math.max(320, Math.min(380, springDuration(distance)));
    void tick().then(() => {
      if (token !== frameGeneration || !resizeFrame) return;
      return resizeFrame.settleTo(target, duration);
    }).then(() => {
      if (token === frameGeneration && settlingFrame?.token === token) settlingFrame = null;
    }).catch(() => {});
  }
  function clearDrag() {
    if (drag?.raf != null) cancelAnimationFrame(drag.raf);
    if (drag?.readyFrame != null) cancelAnimationFrame(drag.readyFrame);
    if (drag) drag.raf = drag.readyFrame = null;
    window.removeEventListener('keydown', keydown);
    drag = null;
    dropWorker?.cancel();
    dropWorker = null;
  }
  function startRemoval(id: string) {
    removing[id] = true;
    for (const node of chromeNodes.get(id) ?? []) {
      node.inert = true;
      node.style.pointerEvents = 'none';
      chromeAnimations.get(id)?.get(node)?.cancel();
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        node.style.opacity = '0';
        continue;
      }
      const animation = node.animate([{ opacity: Number.parseFloat(getComputedStyle(node).opacity) || 1 }, { opacity: 0 }],
        { duration: 140, delay: 0, fill: 'forwards' });
      const group = chromeAnimations.get(id) ?? new Map<HTMLElement, Animation>();
      group.set(node, animation);
      chromeAnimations.set(id, group);
    }
    stop(id);
    if (drag?.id === id) {
      if (drag.mode === 'move' && drag.moved) removalMove = drag;
      if (drag.mode === 'resize' && drag.moved) removalResize = { id, box: drag.ghost, invalid: !drag.ok, radius: drag.frameRadius };
      cancelDrag(false);
    }
    if (settlingFrame?.id === id) {
      removalResize = { id, box: settlingFrame.from, invalid: false, radius: settlingFrame.radius };
      frameGeneration++;
      settlingFrame = null;
      resizeFrame?.cancelSettle();
    }
  }
  function clearRemoval(id: string) {
    delete removing[id];
    for (const node of chromeNodes.get(id) ?? []) removeChromeNode(id, node);
    removalMove = removalMove?.id === id ? null : removalMove;
    removalResize = removalResize?.id === id ? null : removalResize;
  }
  function releaseCapture(d: Drag) {
    if (d.capture.hasPointerCapture(d.pointerId)) d.capture.releasePointerCapture(d.pointerId);
  }
  onDestroy(() => {
    revision++;
    frameGeneration++;
    const active = drag;
    if (active?.raf != null) cancelAnimationFrame(active.raf);
    if (active?.readyFrame != null) cancelAnimationFrame(active.readyFrame);
    if (active) active.raf = active.readyFrame = null;
    drag = null;
    dropWorker?.cancel();
    dropWorker = null;
    window.removeEventListener('keydown', keydown);
    if (active) releaseCapture(active);
    for (const id of animations.keys()) stop(id);
  });

  $effect.pre(() => {
    const dimensions = `${deck.rows}/${deck.cols}/${deck.size}/${deck.gap}/${deck.sizing}`;
    const pixels = `${metrics.cell}/${metrics.gap}/${metrics.width}/${metrics.height}/${availableWidth}/${availableHeight}`;
    const layout = `${targetKey}|${deck.items.map(i => `${i.id}:${i.x},${i.y},${i.w},${i.h}`).join(';')}`;
    const selectedId = selected && 'item' in selected ? selected.item : '';
    const lostResizeSelection = drag?.mode === 'resize' && selectedId !== drag.id;
    if (layout === previousLayout && dimensions === previousGrid && pixels === previousMetrics &&
      editing === previousEditing && !lostResizeSelection) return;
    const before = new Map([...motionNodes].map(([id, node]) => [id, node.getBoundingClientRect()]));
    const layoutChanged = layout !== previousLayout || dimensions !== previousGrid;
    if (drag && (!editing || lostResizeSelection || layoutChanged || pixels !== previousMetrics)) cancelDrag(false);
    const animate = previousLayout !== '' && layout !== previousLayout && dimensions === previousGrid && pixels === previousMetrics;
    previousLayout = layout; previousGrid = dimensions; previousMetrics = pixels; previousEditing = editing;
    const run = ++revision;
    const scale = grid ? grid.getBoundingClientRect().width / grid.offsetWidth : 1;
    for (const id of animations.keys()) stop(id);
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ids = new Set(deck.items.map(i => i.id));
    for (const id of nodes.keys()) if (!ids.has(id)) void animateRemoval(id);
    void tick().then(() => {
      if (run !== revision) return;
      const after = new Map([...motionNodes].map(([id, node]) => [id, node.getBoundingClientRect()]));
      for (const [id, node] of motionNodes) {
        const a = before.get(id), b = after.get(id);
        if (!a || !b || (Math.abs(a.left - b.left) < .5 && Math.abs(a.top - b.top) < .5 &&
          Math.abs(a.width - b.width) < .5 && Math.abs(a.height - b.height) < .5)) continue;
        const dx = (a.left - b.left) / scale, dy = (a.top - b.top) / scale;
        const resized = Math.abs(a.width - b.width) > .5 || Math.abs(a.height - b.height) > .5;
        elevated[id] = true;
        const animation = node.animate(springFrames(dx, dy), { duration: resized ? 110 : 420, fill: 'both' });
        animations.set(id, [animation]);
        void animation.finished.then(() => {
          if (!animations.get(id)?.includes(animation)) return;
          animations.delete(id);
          animation.cancel();
          elevated[id] = false;
        }).catch(() => {});
      }
    });
  });

  // ---- drag to move / resize (edit mode) ----
  function begin(e: PointerEvent, item: Item, mode: Drag['mode'], corner: ResizeCorner = 'se') {
    if (e.button !== 0 || drag || removing[item.id]) return;
    e.stopPropagation();
    const motion = motionNodes.get(item.id);
    if (!motion || !grid) return;
    const interruptedRadius = settlingFrame?.id === item.id ? settlingFrame.radius : null;
    const wasSettling = !!settlingFrame;
    if (wasSettling) {
      frameGeneration++;
      settlingFrame = null;
      void tick().then(() => resizeFrame?.cancelSettle());
    }
    const pose = mode === 'move' ? readTranslation(motion) : { x: 0, y: 0 };
    const gridRect = grid.getBoundingClientRect();
    const scale = gridRect.width / grid.offsetWidth || 1;
    stop(item.id);
    offsets[item.id] = pose;
    motion.style.translate = `${pose.x}px ${pose.y}px`;
    const capture = e.currentTarget as HTMLElement;
    capture.setPointerCapture(e.pointerId);
    const typeId = controlById(item.control)?.type ?? '';
    const def = controlTypes.get(typeId);
    const baseItem = { ...item };
    const origin = boxForItem(baseItem, pitch, metrics.gap);
    const size = resolveSize?.(typeId);
    const min = size?.min ?? def?.minSize ?? { w: 1, h: 1 };
    const registeredMax = size?.max ?? def?.maxSize ?? { w: 99, h: 99 };
    const max = { w: Math.min(registeredMax.w, corner.includes('w') ? item.x + item.w : deck.cols - item.x),
      h: Math.min(registeredMax.h, corner.includes('n') ? item.y + item.h : deck.rows - item.y) };
    const frameRadius = interruptedRadius ?? Math.min(22, (Math.min(min.w, item.w) * pitch - metrics.gap) / 2,
      (Math.min(min.h, item.h) * pitch - metrics.gap) / 2);
    const localX = (e.clientX - gridRect.left) / scale, localY = (e.clientY - gridRect.top) / scale;
    const layoutSignature = currentLayoutSignature();
    const cellObstacles = deck.items.filter(other => other.id !== item.id).map(({ x, y, w, h }) => ({ x, y, w, h }));
    const pixelObstacles = deck.items.filter(other => other.id !== item.id).map(other => {
      // Grown by one gap, so the live outline stops where the widget could actually end, not at the neighbour's edge.
      const box = boxForItem(other, pitch, metrics.gap), g = metrics.gap;
      return { x: box.x - g, y: box.y - g, w: box.width + 2 * g, h: box.height + 2 * g };
    });
    drag = { id: item.id, item: baseItem, mode, pointerId: e.pointerId, capture, startX: e.clientX, startY: e.clientY,
      latest: { x: e.clientX, y: e.clientY }, raf: null,
      grabOffsetX: localX - origin.x - pose.x, grabOffsetY: localY - origin.y - pose.y,
      baseX: pose.x, baseY: pose.y, screenDistance: 0, corner, scale, originX: gridRect.left, originY: gridRect.top,
      dx: 0, dy: 0, pitch, gap: metrics.gap, min, max, pixelObstacles, cellObstacles, frameRadius,
      target: baseItem, validResize: baseItem, ghost: origin,
      placement: null, ok: true, moved: false,
      moveX: pose.x, moveY: pose.y, pointerInside: localX >= 0 && localY >= 0 && localX < metrics.width && localY < metrics.height,
       pending: false, readyForRelease: false, generation: ++dragGeneration, requestToken: 0, layoutSignature,
       requestedX: null, requestedY: null, readyFrame: null };
    window.addEventListener('keydown', keydown);
  }

  function markPreviewReady(d: Drag) {
    if (d.readyFrame != null) cancelAnimationFrame(d.readyFrame);
    d.readyForRelease = false;
    const frame = requestAnimationFrame(() => {
      if (d.readyFrame === frame) d.readyFrame = null;
      const current = drag;
      if (current !== d || current.generation !== d.generation || current.target.x !== d.requestedX ||
        current.target.y !== d.requestedY || !current.placement || current.pending) return;
      current.readyForRelease = true;
    });
    d.readyFrame = frame;
  }

  function requestPlacement(d: Drag) {
    if (!d.pointerInside || !inside(d.target, deck)) {
      d.requestToken++;
      dropWorker?.cancelPending();
      if (d.readyFrame != null) cancelAnimationFrame(d.readyFrame);
      d.readyFrame = null;
      d.placement = null;
      d.pending = false;
      d.readyForRelease = false;
      d.ok = false;
      d.requestedX = d.requestedY = null;
      return;
    }
    if (d.requestedX === d.target.x && d.requestedY === d.target.y && (d.pending || d.placement)) return;
    if (d.readyFrame != null) cancelAnimationFrame(d.readyFrame);
    d.readyFrame = null;
    const target = { x: d.target.x, y: d.target.y, w: d.item.w, h: d.item.h };
    const blockers = deck.items.some(item => item.id !== d.id && item.x < target.x + target.w &&
      target.x < item.x + item.w && item.y < target.y + target.h && target.y < item.y + item.h);
    if (!blockers) {
      d.requestToken++;
      dropWorker?.cancelPending();
      d.placement = previewDrop(deck.items, d.id, target.x, target.y, deck);
      d.pending = false;
      d.readyForRelease = false;
      d.ok = d.placement.kind !== 'invalid';
      d.requestedX = target.x;
      d.requestedY = target.y;
      markPreviewReady(d);
      return;
    }
    if (d.requestedX === target.x && d.requestedY === target.y && (d.pending || d.placement)) return;
    d.requestedX = target.x;
    d.requestedY = target.y;
    d.placement = null;
    d.pending = true;
    d.readyForRelease = false;
    d.ok = true;
    const requestToken = ++d.requestToken;
    const worker = dropWorker ??= new DropPreviewWorker();
    void worker.request({ generation: d.generation, revision: d.layoutSignature, id: d.id, x: target.x, y: target.y,
      items: deck.items, grid: deck }).then(reply => {
      const current = drag;
      if (!current || current !== d || current.requestToken !== requestToken || current.generation !== d.generation ||
        current.layoutSignature !== d.layoutSignature || current.requestedX !== target.x || current.requestedY !== target.y ||
        current.target.x !== target.x || current.target.y !== target.y ||
        current.layoutSignature !== currentLayoutSignature()) return;
      if (!reply) {
        current.pending = false;
        current.placement = null;
        current.readyForRelease = false;
        current.ok = false;
        current.requestedX = current.requestedY = null;
        return;
      }
      if (current.generation !== reply.generation || current.layoutSignature !== reply.revision ||
        target.x !== reply.x || target.y !== reply.y) return;
      current.placement = reply.preview;
      current.pending = false;
      current.readyForRelease = false;
      current.ok = reply.preview.kind !== 'invalid';
      markPreviewReady(current);
    });
  }

  function applySample(d: Drag, clientX: number, clientY: number) {
    if (drag !== d) return;
    d.dx = (clientX - d.startX) / d.scale;
    d.dy = (clientY - d.startY) / d.scale;
    d.screenDistance = Math.hypot(clientX - d.startX, clientY - d.startY);
    d.moved ||= Math.hypot(d.dx, d.dy) > 6;
    if (d.mode === 'move') {
      const localX = (clientX - d.originX) / d.scale, localY = (clientY - d.originY) / d.scale;
      d.pointerInside = localX >= 0 && localY >= 0 && localX < metrics.width && localY < metrics.height;
      const projected = projectMoveOrigin(clientX, clientY,
        { gridLeft: d.originX, gridTop: d.originY, scale: d.scale, pitch: d.pitch, gap: d.gap },
        { x: d.grabOffsetX, y: d.grabOffsetY }, d.item);
      d.moveX = projected.translateX;
      d.moveY = projected.translateY;
      d.target = { ...d.target, x: projected.x, y: projected.y };
      requestPlacement(d);
      return;
    }

    const source = boxForItem(d.item, d.pitch, d.gap);
    const preview = resizePreview(d.item, d.corner, d.dx, d.dy, d.pitch, d.gap, d.min, d.max);
    const requested = { x: source.x + preview.x, y: source.y + preview.y, w: preview.width, h: preview.height };
    const pixelMin = { w: d.min.w * d.pitch - d.gap, h: d.min.h * d.pitch - d.gap };
    const ghost = clampResizeRect(requested, d.pixelObstacles, d.corner, pixelMin);
    if (!ghost) { d.ok = false; return; }
    const effectiveDx = (ghost.w - source.width) * (d.corner.includes('w') ? -1 : 1);
    const effectiveDy = (ghost.h - source.height) * (d.corner.includes('n') ? -1 : 1);
    const snapped = { ...d.item, ...resizeFromCornerHysteretic(d.item, d.corner, effectiveDx, effectiveDy,
      d.pitch, d.target, d.min, d.max, 4) };
    const safe = clampResizeRect(snapped, d.cellObstacles, d.corner, d.min);
    if (!safe) { d.ok = false; return; }
    const target = { ...d.item, ...safe };
    if (!fits(deck.items, target, deck, [d.id])) { d.ok = false; return; }
    d.target = target;
    d.ok = true;
    d.ghost = { x: ghost.x, y: ghost.y, width: ghost.w, height: ghost.h };
    if (target.x !== d.validResize.x || target.y !== d.validResize.y || target.w !== d.validResize.w || target.h !== d.validResize.h)
      d.validResize = target;
  }
  function track(e: PointerEvent, item: Item) {
    const d = drag;
    if (!d || d.id !== item.id || d.pointerId !== e.pointerId) return;
    d.latest = { x: e.clientX, y: e.clientY };
    if (d.raf != null) return;
    const frame = requestAnimationFrame(() => {
      if (d.raf === frame) d.raf = null;
      if (drag !== d) return;
      applySample(d, d.latest.x, d.latest.y);
    });
    d.raf = frame;
  }
  function flushPointer(e: PointerEvent, item: Item) {
    const d = drag;
    if (!d || d.id !== item.id || d.pointerId !== e.pointerId) return;
    if (d.raf != null) cancelAnimationFrame(d.raf);
    d.raf = null;
    d.latest = { x: e.clientX, y: e.clientY };
    applySample(d, e.clientX, e.clientY);
  }
  function cancelDrag(animate = true, pointerId?: number) {
    const d = drag;
    if (!d || (pointerId != null && d.pointerId !== pointerId)) return;
    const motion = motionNodes.get(d.id);
    const pose = motion ? readTranslation(motion) : { x: d.baseX + d.dx, y: d.baseY + d.dy };
    if (d.mode === 'resize' && d.moved && animate)
      settleResize(d.id, d.ghost, boxForItem(d.item, d.pitch, d.gap), d.screenDistance, d.frameRadius);
    clearDrag();
    releaseCapture(d);
    if (d.mode === 'move' && motion && animate) settleMove(d.id, motion, pose, d.screenDistance);
    else { offsets[d.id] = { x: 0, y: 0 }; elevated[d.id] = false; }
  }
  function cancelPointer(e: PointerEvent) { cancelDrag(true, e.pointerId); }
  function keydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !drag) return;
    e.preventDefault();
    cancelDrag();
  }
  function end(item: Item, e: PointerEvent) {
    flushPointer(e, item);
    const d = drag;
    if (!d || d.id !== item.id || d.pointerId !== e.pointerId) return;
    if (!d.moved) { cancelDrag(true, e.pointerId); return select({ item: item.id }); }
    if (!d.ok) { cancelDrag(true, e.pointerId); return; }
    if (d.mode === 'move') {
      const result = d.placement;
      if (!d.pointerInside || !inside(d.target, deck) || d.pending || !d.readyForRelease || !result ||
        d.layoutSignature !== currentLayoutSignature() || result.kind === 'invalid' ||
        result.items.find(i => i.id === item.id)?.x !== d.target.x || result.items.find(i => i.id === item.id)?.y !== d.target.y ||
        !result.items.some(i => {
          const original = deck.items.find(old => old.id === i.id)!;
          return i.x !== original.x || i.y !== original.y || i.w !== original.w || i.h !== original.h;
        })) { cancelDrag(true, e.pointerId); return; }
      clearDrag();
      offsets[item.id] = { x: 0, y: 0 };
      writeItems(result.items, result.displaced.length ? 'Swap widgets' : 'Move widget');
      select({ item: item.id });
      return;
    }
    if (d.target.x === item.x && d.target.y === item.y && d.target.w === item.w && d.target.h === item.h) {
      cancelDrag(true, e.pointerId);
      return;
    }
    const next = deck.items.map(i => i.id === item.id ? { ...i, ...d.target } : i);
    const destination = boxForItem(d.target, d.pitch, d.gap);
    settleResize(d.id, d.ghost, destination, d.screenDistance, d.frameRadius);
    clearDrag();
    writeItems(next, 'Resize widget');
    select({ item: item.id });
  }
  function resizeKeydown(e: KeyboardEvent, item: Item, corner: ResizeCorner) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    let dx = e.key === 'ArrowLeft' ? -pitch : e.key === 'ArrowRight' ? pitch : 0;
    let dy = e.key === 'ArrowUp' ? -pitch : e.key === 'ArrowDown' ? pitch : 0;
    if (e.shiftKey) {
      if (dx !== 0) dy = dx;
      else dx = dy;
    }
    const typeId = controlById(item.control)?.type ?? '';
    const def = controlTypes.get(typeId);
    const size = resolveSize?.(typeId);
    const min = size?.min ?? def?.minSize ?? { w: 1, h: 1 };
    const registeredMax = size?.max ?? def?.maxSize ?? { w: 99, h: 99 };
    const max = { w: Math.min(registeredMax.w, corner.includes('w') ? item.x + item.w : deck.cols - item.x),
      h: Math.min(registeredMax.h, corner.includes('n') ? item.y + item.h : deck.rows - item.y) };
    const candidate = resizeFromCornerHysteretic(item, corner, dx, dy, pitch, item, min, max, 4);
    const obstacles = deck.items.filter(other => other.id !== item.id).map(({ x, y, w, h }) => ({ x, y, w, h }));
    const bounded = clampResizeRect(candidate, obstacles, corner, min);
    if (!bounded) return;
    const nextItem = { ...item, ...bounded };
    if ((nextItem.w === item.w && nextItem.h === item.h) || !fits(deck.items, nextItem, deck, [item.id])) return;
    const next = deck.items.map(i => i.id === item.id ? { ...i, ...nextItem } : i);
    writeItems(next, 'Resize widget');
    select({ item: item.id });
  }
  const isSelected = (s: Selection, id: string) => !!s && 'item' in s && s.item === id;
  const isCell = (s: Selection, x: number, y: number) => !!s && 'cell' in s && s.cell.x === x && s.cell.y === y;
</script>

<div bind:this={grid} class="relative isolate grid" style:width="{metrics.width}px" style:height="{metrics.height}px"
  style:padding="{metrics.gap}px" style:gap="{metrics.gap}px"
  style:grid-template-columns="repeat({deck.cols}, {metrics.cell}px)" style:grid-template-rows="repeat({deck.rows}, {metrics.cell}px)">
  {#if editing}
    {#each { length: deck.rows * deck.cols }, i (i)}
      {@const x = i % deck.cols}{@const y = Math.floor(i / deck.cols)}
      <button data-empty-cell data-selected={isCell(selected, x, y)} aria-label="Empty spot {x + 1},{y + 1}" onclick={() => select({ cell: { x, y } })}
        oncontextmenu={e => context(e, { cell: { x, y } })}
        style:grid-area="{y + 1} / {x + 1}"
        class="rounded-[22px] border transition-colors
          {isCell(selected, x, y) ? 'ring-2 ring-inset' : ''}"></button>
    {/each}
  {/if}

  {#each items as { item, control, def } (item.id)}
    {@const resizing = drag?.id === item.id && drag.mode === 'resize' ? drag : null}
    {@const renderItem = resizing ? resizing.validResize : item}
    {@const variantIndex = settings.variants[control.id] ?? 0}
    {@const pageVisible = !editorPreview && (editing || page.id === $runtimeView.activePage)}
    {@const pageRendered = !editorPreview && (editing || pageRenderVisible)}
    {@const presentation = resolvePresentation?.(control, variantIndex)}
    {@const lifted = drag?.id === item.id && drag.moved && drag.mode === 'move'}
    {@const displaced = drag?.mode === 'move' && drag.placement?.kind === 'swap' && drag.placement.displaced.includes(item.id)
      ? drag.placement.items.find(i => i.id === item.id) : null}
    <div use:register={item.id} inert={!!removing[item.id]} style:grid-area="{renderItem.y + 1} / {renderItem.x + 1} / span {renderItem.h} / span {renderItem.w}"
      class="relative min-h-0 min-w-0 {lifted ? 'z-40 cursor-grabbing opacity-90 drop-shadow-[0_20px_30px_rgba(0,0,0,.6)]' : elevated[item.id] ? 'z-40' : 'z-10'}">
      <div use:registerMotion={item.id} data-dashboard-tile class="relative h-full w-full min-h-0 min-w-0"
        style:translate={lifted && drag ? `${drag.moveX}px ${drag.moveY}px`
          : displaced ? `${(displaced.x - item.x) * pitch}px ${(displaced.y - item.y) * pitch}px` : null}>
        <div data-dashboard-tile class="h-full w-full" inert={editing}>
          <def.component {control} {page} pageId={page.id} {pageVisible} {pageRendered} w={renderItem.w} h={renderItem.h}
            pixelWidth={renderItem.w * pitch - metrics.gap} pixelHeight={renderItem.h * pitch - metrics.gap}
            {presentation} itemId={item.id} pressFeedbackDisabled={editing}
            {...((faceMap?.[control.type] ?? def.face) ? { face: faceMap?.[control.type] ?? def.face, compact } : {})} />
        </div>
        {#if editing}
          {#if isSelected(selected, item.id)}
            <div data-selection class="pointer-events-none absolute inset-0 rounded-[22px] ring-2 ring-inset ring-white/75"></div>
          {/if}
          <div role="button" tabindex="0" aria-label="Move or select {control.name}"
            class="absolute inset-0 cursor-grab touch-none rounded-[22px] hover:bg-white/[.04]"
            onpointerdown={e => begin(e, item, 'move')} onpointermove={e => track(e, item)}
            onpointerup={e => end(item, e)} onpointercancel={cancelPointer} onlostpointercapture={cancelPointer}
            onkeydown={e => { if (e.key === 'Enter') select({ item: item.id }); }}></div>
        {/if}
      </div>
    </div>
  {/each}

  {#if editing}
    {@const selectedEntry = selected && 'item' in selected ? items.find(entry => entry.item.id === selected.item) : null}
    {@const selectedId = selectedEntry?.item.id ?? ''}
    {@const activeMove = drag?.mode === 'move' && drag.moved ? drag : null}
    {@const movePreview = activeMove ?? removalMove}
    {@const chromeOwner = removalMove?.id ?? removalResize?.id ?? activeMove?.id ??
      (drag?.mode === 'resize' ? drag.id : selectedId)}
    {#if chromeOwner}
      <div use:registerChrome={chromeOwner} data-editing-chrome inert={!!removing[chromeOwner]}
        class="pointer-events-none absolute inset-0 z-[60]">
      {#if movePreview?.id === chromeOwner}
      {@const target = movePreview.target}
      {@const targetInside = movePreview.pointerInside && inside(target, deck)}
      {#if targetInside}
        {@const targetBox = boxForItem(target, movePreview.pitch, movePreview.gap)}
        {@const movePlacement = movePreview.placement}
        {#if movePlacement?.kind === 'swap'}
          {@const source = movePreview.item}
          {@const sourceBox = boxForItem(source, movePreview.pitch, movePreview.gap)}
          <div aria-hidden="true" class="pointer-events-none absolute left-0 top-0 z-20 box-border rounded-[22px] border border-dashed border-white/65 bg-white/[.025]"
            style:translate="{sourceBox.x}px {sourceBox.y}px" style:width="{sourceBox.width}px" style:height="{sourceBox.height}px"></div>
          {#each movePlacement.displaced as displacedId (displacedId)}
            {@const destination = movePlacement.items.find(i => i.id === displacedId)!}
            {@const destinationBox = boxForItem(destination, movePreview.pitch, movePreview.gap)}
            <div data-displaced-destination aria-hidden="true" class="pointer-events-none absolute left-0 top-0 z-20 box-border rounded-[22px] border border-dashed border-emerald-300/80"
              style:translate="{destinationBox.x}px {destinationBox.y}px" style:width="{destinationBox.width}px" style:height="{destinationBox.height}px"></div>
          {/each}
        {/if}
        <div data-placement-target class="pointer-events-none absolute left-0 top-0 z-30 box-border rounded-[22px] border
            {movePreview.pending ? 'border-white/40 bg-white/[.015]' : movePreview.ok ? 'border-emerald-400/70 bg-emerald-400/5' : 'border-red-400/70 bg-red-400/5'}"
          style:translate="{targetBox.x}px {targetBox.y}px" style:width="{targetBox.width}px" style:height="{targetBox.height}px">
          {#if movePlacement?.kind === 'swap'}
            <svg aria-hidden="true" class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-emerald-200" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 8h15m0 0-4-4m4 4-4 4M20 16H5m0 0 4 4m-4-4 4-4" />
            </svg>
          {:else if !movePreview.ok}
            <svg aria-hidden="true" class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-red-200" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          {/if}
        </div>
      {/if}
    {/if}
    {#if frameBox}
      <ResizeFrame bind:this={resizeFrame} x={frameBox.x} y={frameBox.y} width={frameBox.width} height={frameBox.height}
        preferredRadius={frameRadius}
        invalid={frameInvalid} />
    {/if}
    {#if selectedEntry}
      {@const selectedItem = selectedEntry.item}
      {@const handleFrame = drag?.id === selectedItem.id && drag.mode === 'resize' && drag.moved
        ? drag.ghost : boxForItem(drag?.id === selectedItem.id && drag.mode === 'resize' ? drag.validResize : selectedItem, pitch, metrics.gap)}
      {#each ['nw', 'ne', 'sw', 'se'] as corner}
        {@const cornerName = corner as ResizeCorner}
        {@const geometry = resizeCornerGeometry(handleFrame.width, handleFrame.height, cornerName)}
        {@const hitX = handleFrame.x + geometry.hitX}
        {@const hitY = handleFrame.y + geometry.hitY}
        {@const strokeX = handleFrame.x + geometry.strokeX}
        {@const strokeY = handleFrame.y + geometry.strokeY}
        {@const strokeClass = corner === 'nw' ? 'border-l-2 border-t-2 rounded-tl-sm' : corner === 'ne' ? 'border-r-2 border-t-2 rounded-tr-sm' : corner === 'se' ? 'border-r-2 border-b-2 rounded-br-sm' : 'border-l-2 border-b-2 rounded-bl-sm'}
        {@const resizeCursor = corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize'}
        <button type="button" data-corner={corner} aria-label="Resize {selectedEntry.control.name} {corner} corner"
          aria-hidden={editingChromeHidden} tabindex={editingChromeHidden ? -1 : 0}
          style:pointer-events={editingChromeHidden ? 'none' : 'auto'}
          class="group pointer-events-auto absolute left-0 top-0 z-50 grid size-7 place-items-center touch-none bg-transparent text-white transition-opacity duration-100 {editingChromeHidden ? 'opacity-0' : ''} {resizeCursor} focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          style:translate="{hitX}px {hitY}px"
          onpointerdown={e => begin(e, selectedItem, 'resize', cornerName)} onpointermove={e => track(e, selectedItem)}
          onpointerup={e => end(selectedItem, e)} onpointercancel={cancelPointer} onlostpointercapture={cancelPointer}
          onkeydown={e => resizeKeydown(e, selectedItem, cornerName)}>
          <span aria-hidden="true" class="pointer-events-none absolute left-0 top-0 z-50 h-3 w-3 border-current opacity-65 transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100 {strokeClass}"
            style:translate="{strokeX - hitX}px {strokeY - hitY}px"></span>
        </button>
      {/each}
    {/if}
      </div>
    {/if}
    <span class="sr-only" aria-live="polite" aria-atomic="true">
      {drag?.mode === 'move' && drag.moved ? drag.pending ? 'Checking placement' : drag.placement?.kind === 'swap' ? 'Swap' : drag.ok ? '' : 'Cannot place' : ''}
    </span>
  {/if}
</div>

<style>
  :global([data-dashboard-tile]),
  :global([data-dashboard-tile] *) {
    -webkit-app-region: no-drag;
  }
</style>
