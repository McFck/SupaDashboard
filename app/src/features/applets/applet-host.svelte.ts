import { runtimeView } from '../../app/runtime/state';
import type { AppletHostContext } from './context';
import type { Page } from '../settings/schema';
import type { VariableValue } from '../automation/variables';
import type { SceneInput, SceneRect } from './scene-contracts';
import { AppletInputRecognizer, type AppletCorner, type AppletGesture } from './input';
import { resolveAppletConfig } from './definition';
import { settings } from '../settings/state.svelte';
import type { RuntimeCommands } from '../../app/runtime/commands';

type HostOptions = Pick<
  AppletHostContext,
  | 'applet'
  | 'mode'
  | 'visible'
  | 'pageRenderVisible'
  | 'selected'
  | 'onselect'
  | 'oncontext'
  | 'resolvePresentation'
> & { page: Page; previewViewId: string };

export class AppletHostController implements AppletHostContext {
  width = $state(0);
  height = $state(0);
  private designHeight = $state<number>();
  quickActionsOpen = $state(false);
  private runtimeOwner = $state(false);
  state = $state<Record<string, VariableValue>>({});
  private readonly input = new AppletInputRecognizer(() => this.setQuickActionsOpen(true));
  private unsubscribe = () => {};
  readonly fittedHeight = $derived(this.designHeight ?? this.applet.design?.height ?? 0);
  readonly fit = $derived.by(() => {
    const design = this.applet.design;
    const { width, height, fittedHeight } = this;
    if (!design || ![width, height, fittedHeight].every((v) => Number.isFinite(v) && v > 0)) {
      return null;
    }
    const scale = Math.min(width / design.width, height / fittedHeight);
    return {
      scale,
      offsetX: (width - design.width * scale) / 2,
      offsetY: (height - fittedHeight * scale) / 2,
    };
  });
  readonly viewId = $derived.by(() => {
    const applet = this.applet;
    const value = this.mode === 'editor' ? this.source.previewViewId : this.state.view;
    return typeof value === 'string' && applet.views.some((view) => view.id === value)
      ? value
      : applet.defaultView;
  });

  constructor(
    private readonly source: HostOptions,
    private readonly commands: Pick<RuntimeCommands, 'requestPageChange' | 'setAppletView'>,
    private readonly preview: (view: string) => void,
  ) {
    $effect(() => {
      // These changes invalidate buffered gestures and close the current quick-action overlay.
      const dependencies = [
        this.applet.id,
        this.page.id,
        this.visible,
        this.pageRenderVisible,
        this.viewId,
        this.runtimeOwner,
        JSON.stringify(this.config),
      ];
      void dependencies;
      this.input.reset();
      this.quickActionsOpen = false;
    });
  }

  get applet() {
    return this.source.applet;
  }
  get mode() {
    return this.source.mode;
  }
  get visible() {
    return this.source.visible;
  }
  get pageRenderVisible() {
    return this.source.pageRenderVisible;
  }
  get selected() {
    return this.source.selected;
  }
  get onselect() {
    return this.source.onselect;
  }
  get oncontext() {
    return this.source.oncontext;
  }
  get resolvePresentation() {
    return this.source.resolvePresentation;
  }
  get designScale() {
    return this.applet.design ? (this.fit?.scale ?? 0) : 1;
  }
  get designOffset() {
    return { x: this.fit?.offsetX ?? 0, y: this.fit?.offsetY ?? 0 };
  }
  get viewport() {
    return { width: this.width, height: this.height };
  }
  get config() {
    return resolveAppletConfig(this.applet, settings.skinSettings[this.applet.id] ?? {});
  }
  get page() {
    return Object.assign({}, this.source.page, {
      next: () =>
        this.mode === 'runtime'
          ? this.commands.requestPageChange({ direction: 'next' }, 'applet')
          : Promise.resolve(false),
      prev: () =>
        this.mode === 'runtime'
          ? this.commands.requestPageChange({ direction: 'prev' }, 'applet')
          : Promise.resolve(false),
    });
  }

  setDesignHeight(next: number) {
    if (Number.isFinite(next) && next > 0) {
      this.designHeight = next;
    }
  }

  async setView(next: string) {
    if (!this.applet.views.some((view) => view.id === next) || next === this.viewId) {
      return false;
    }
    if (this.mode === 'editor') {
      this.preview(next);
      return true;
    }
    if (!this.runtimeOwner) {
      return false;
    }
    return this.commands.setAppletView(this.applet.id, next);
  }

  setQuickActionsOpen(open: boolean) {
    this.quickActionsOpen = this.mode === 'runtime' && this.runtimeOwner && open;
  }

  routeSceneInput(input: SceneInput, rect: SceneRect, deliver: (input: SceneInput) => void) {
    const config = this.config;
    let gesture: AppletGesture = 'off';
    if (this.mode === 'runtime' && this.runtimeOwner && this.applet.quickActions?.length) {
      gesture =
        config.gesture === 'cornerHold' || config.gesture === 'off' ? config.gesture : 'tripleTap';
    }
    let corner: AppletCorner = 'bottomRight';
    if (
      config.corner === 'topLeft' ||
      config.corner === 'topRight' ||
      config.corner === 'bottomLeft'
    ) {
      corner = config.corner;
    }
    this.input.setOptions(gesture, corner);
    return this.input.handle(input, rect, deliver);
  }

  resetSceneInput() {
    this.input.reset();
  }

  onOriginDown(event: PointerEvent) {
    if (event.target instanceof Element && event.target.closest('[data-applet-input="scene"]')) {
      return;
    }
    this.resetSceneInput();
  }

  mount() {
    this.unsubscribe = runtimeView.subscribe((snapshot) => {
      if (this.runtimeOwner !== snapshot.owner) {
        this.runtimeOwner = snapshot.owner;
      }
      const next: Record<string, VariableValue> = {};
      for (const field of this.applet.state ?? []) {
        const value = snapshot.variables.records[`${this.applet.id}.${field.key}`]?.value;
        if (value !== undefined) {
          next[field.key] = value;
        }
      }
      const view = snapshot.variables.records[`${this.applet.id}.view`]?.value;
      if (view !== undefined) {
        next.view = view;
      }
      const keys = new Set([...Object.keys(this.state), ...Object.keys(next)]);
      if ([...keys].some((key) => !Object.is(this.state[key], next[key]))) {
        this.state = next;
      }
    });
  }

  destroy() {
    this.unsubscribe();
    this.unsubscribe = () => {};
    this.input.dispose();
  }
}
