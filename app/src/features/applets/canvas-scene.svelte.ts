import { untrack } from 'svelte';
import type { AppletHostContext } from './context';
import type { SceneMode, AppletSceneFactory, AppletSceneRenderer } from './scene-contracts';
import { SceneScheduler } from './scene';
import { ScenePointer } from './scene-pointer';

export class CanvasSceneController<Data> {
  private renderer: AppletSceneRenderer<Data> | undefined;
  private scheduler: SceneScheduler | undefined;
  private rasterWidth = 0;
  private rasterHeight = 0;
  private painted = false;
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
    const { opaque, width, height } = this.source;
    // Prepaint opaque pages once before their first transition, then keep hidden pages idle.
    return (
      this.eligible() ||
      (opaque &&
        !this.painted &&
        untrack(() => this.source.data != null) &&
        this.mode === 'live' &&
        !!this.host?.windowLive &&
        width > 0 &&
        height > 0 &&
        (this.host?.designScale ?? 1) > 0)
    );
  }

  private resizeBacking = () => {
    const { canvas, width, height } = this.source;
    if (!canvas || !width || !height) {
      return;
    }
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const scale = this.host?.designScale ?? 1;
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
    this.scheduler?.setActive(this.eligible());
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
