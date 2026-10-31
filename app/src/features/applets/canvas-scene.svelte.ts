import { untrack } from 'svelte';
import type { AppletHostContext } from './context';
import type { SceneMode, AppletSceneFactory, AppletSceneRenderer } from './scene-contracts';
import { SceneScheduler } from './scene';
import { ScenePointer } from './scene-pointer';

// An opaque page that is off screen is only a half-size picture: it is prepainted that way before its first
// transition, and parked that way (dropping its renderer caches) after 3 s away. The full-size display replaces
// the picture 300 ms after the page is shown (at once when there is none), in a single frame.
const PARK_AFTER_MS = 3000;
const RESTORE_AFTER_MS = 300;
// Backing-store budget: the compositor scales the display up beyond it.
const MAX_DENSITY = 1.5;
const MAX_PIXELS = 3_000_000;

export class CanvasSceneController<Data> {
  private renderer: AppletSceneRenderer<Data> | undefined;
  private scheduler: SceneScheduler | undefined;
  private rasterWidth = 0;
  private rasterHeight = 0;
  private painted = $state(false);
  private destroyed = false;
  private half = $state(false);
  private parkStep: 'park' | 'restore' | undefined;
  private parkTimer: ReturnType<typeof setTimeout> | undefined;
  private dprQuery: MediaQueryList | undefined;
  private resizeFrame: number | null = null;
  private cleanup = () => {};
  readonly pointer: ScenePointer;

  constructor(
    private readonly source: {
      canvas: HTMLCanvasElement;
      create: AppletSceneFactory<Data>;
      width: number;
      height: number;
      view: string;
      data: Data;
      revision: unknown;
      opaque: boolean;
    },
    private readonly host?: AppletHostContext,
  ) {
    this.half = source.opaque && this.mode === 'live' && !host?.visible;
    this.pointer = new ScenePointer({
      canvas: () => this.source.canvas,
      size: () => this.source,
      active: () => this.mode === 'live' && this.eligible(),
      context: host,
      renderer: () => this.renderer,
    });
    let lastView: string | undefined,
      lastAppletId: string | undefined,
      lastPageId: string | undefined;
    $effect(() => {
      const { view } = this.source;
      const mode = this.mode,
        appletId = host?.applet.id,
        pageId = host?.page.id;
      const canDraw = this.eligible();
      if (
        mode !== 'live' ||
        view !== lastView ||
        appletId !== lastAppletId ||
        pageId !== lastPageId ||
        !canDraw
      ) {
        this.pointer.cancel();
      }
      lastView = view;
      lastAppletId = appletId;
      lastPageId = pageId;
    });
    $effect(() => this.schedulePark(this.wantedStep()));
    $effect(() => {
      const { revision, view } = this.source;
      void revision;
      void view;
      this.resizeBacking();
      this.scheduler?.setMode(this.mode);
      this.scheduler?.setActive(this.canPaint());
      this.scheduler?.invalidate();
    });
  }

  private get mode(): SceneMode {
    return this.host?.mode === 'editor' ? 'frozen' : 'live';
  }

  private eligible() {
    const { width, height } = this.source;
    return (
      (this.mode === 'frozen' ? !!this.host?.onScreen : !!this.host?.active) &&
      width > 0 &&
      height > 0 &&
      (this.host?.designScale ?? 1) > 0
    );
  }

  private canPaint() {
    const { width, height } = this.source;
    if (!this.half) {
      return this.eligible();
    }
    // Prepaint the picture once before the first transition, then keep hidden pages idle.
    return (
      !this.painted &&
      !this.host?.visible &&
      untrack(() => this.source.data != null) &&
      !!this.host?.windowLive &&
      width > 0 &&
      height > 0 &&
      (this.host?.designScale ?? 1) > 0
    );
  }

  private resizeBacking = () => {
    const { canvas, width, height } = this.source;
    if (!canvas || !width || !height) {
      return;
    }
    const scale = this.host?.designScale ?? 1;
    const density = Math.min(
      window.devicePixelRatio || 1,
      MAX_DENSITY,
      Math.sqrt(MAX_PIXELS / (width * scale * height * scale)),
    );
    const ratio = this.half ? density / 2 : density;
    const nextWidth = Math.ceil(width * scale * ratio),
      nextHeight = Math.ceil(height * scale * ratio);
    if (
      nextWidth <= 0 ||
      nextHeight <= 0 ||
      (nextWidth === this.rasterWidth && nextHeight === this.rasterHeight)
    ) {
      return;
    }
    this.rasterWidth = nextWidth;
    this.rasterHeight = nextHeight;
    this.scheduler?.invalidate();
  };

  private resize = () => {
    if (this.resizeFrame === null) {
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = null;
        this.resizeBacking();
        this.bindDprQuery();
      });
    }
    this.bindDprQuery();
  };

  private bindDprQuery() {
    this.dprQuery?.removeEventListener('change', this.resize);
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.dprQuery.addEventListener('change', this.resize, { once: true });
  }

  private wantedStep(): 'park' | 'restore' | undefined {
    if (!this.source.opaque || this.mode !== 'live') {
      return undefined;
    }
    const showing = this.eligible();
    if (this.half) {
      return showing ? 'restore' : undefined;
    }
    return !showing && this.painted && this.host?.windowLive ? 'park' : undefined;
  }

  // The effect re-runs often; only a change of the wanted step restarts the timer.
  private schedulePark(step: 'park' | 'restore' | undefined) {
    if (step === this.parkStep) {
      return;
    }
    clearTimeout(this.parkTimer);
    this.parkStep = step;
    if (step === 'park') {
      this.parkTimer = setTimeout(() => void this.park(), PARK_AFTER_MS);
    } else if (step === 'restore') {
      this.parkTimer = setTimeout(() => (this.half = false), this.painted ? RESTORE_AFTER_MS : 0);
    }
  }

  private async park() {
    const { canvas } = this.source;
    const width = Math.ceil(canvas.width / 2),
      height = Math.ceil(canvas.height / 2);
    if (width < 1 || height < 1) {
      return;
    }
    const bitmap = await createImageBitmap(canvas, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'high',
    });
    // The page may have come back, or been removed, while the bitmap was made.
    if (this.destroyed || this.eligible()) {
      bitmap.close();
      return;
    }
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    this.renderer?.dispose?.();
    this.half = true;
  }

  private draw(ctx: CanvasRenderingContext2D, time: number) {
    const { canvas, width, height, opaque, view, data } = this.source;
    // Resizing clears the canvas; resize in the same frame as the replacement paint.
    if (canvas.width !== this.rasterWidth) {
      canvas.width = this.rasterWidth;
    }
    if (canvas.height !== this.rasterHeight) {
      canvas.height = this.rasterHeight;
    }
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    if (!opaque) {
      ctx.clearRect(0, 0, width, height);
    }
    const animate =
      this.renderer?.draw({ ctx, width, height, time, mode: this.mode, view, data }) ?? false;
    this.painted = true;
    this.scheduler?.setActive(this.canPaint());
    if (this.half) {
      // The picture is final; the layers it was drawn from only cost memory.
      this.renderer?.dispose?.();
    }
    return animate;
  }

  mount() {
    const { canvas, create } = this.source;
    this.renderer = create();
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      this.cleanup = () => this.renderer?.dispose?.();
      return;
    }
    this.scheduler = new SceneScheduler(
      (time) => this.draw(ctx, time),
      this.mode,
      undefined,
      undefined,
      () => this.renderer?.dispose?.(),
    );
    this.observe(canvas);
    this.bindDprQuery();
    this.resizeBacking();
    this.scheduler.setActive(this.canPaint());
  }

  private observe(canvas: HTMLCanvasElement) {
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(this.resizeBacking);
    observer?.observe(canvas);
    window.addEventListener('resize', this.resize);
    this.cleanup = () => {
      observer?.disconnect();
      window.removeEventListener('resize', this.resize);
      this.scheduler?.dispose();
    };
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.parkTimer);
    this.pointer.cancel();
    this.cleanup();
    this.cleanup = () => {};
    this.dprQuery?.removeEventListener('change', this.resize);
    this.dprQuery = undefined;
    if (this.resizeFrame !== null) {
      cancelAnimationFrame(this.resizeFrame);
    }
    this.resizeFrame = null;
    this.scheduler = undefined;
    this.renderer = undefined;
  }
}
