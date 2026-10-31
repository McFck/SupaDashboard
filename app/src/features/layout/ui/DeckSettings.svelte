<script lang="ts">
  // The inspector with nothing selected: the page's applet, the canvas backdrop and the grid geometry of the page.
  import { Slider } from '$lib/components/ui/slider';
  import { Switch } from '$lib/components/ui/switch';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import Choice from '../../plugins/ui/Choice.svelte';
  import { applets } from '../../plugins/registry';
  import { appletFor } from '../../applets/deck';
  import ColorField from '$lib/components/ColorField.svelte';
  import { splitAlpha, withAlpha } from '$lib/palette';
  import { settings } from '../../settings/state.svelte';
  import type { Page } from '../../settings/schema';
  import { commit, labelEdit } from '../history.svelte';
  import { ICON_SCALE, LABEL_SCALE } from '../../settings/defaults';
  import { setPageApplet } from '../page-commands';
  import { finishGridResize } from '../slot-edits';
  import Row from '../../../panel/ui/Row.svelte';
  import Section from '../../../panel/ui/Section.svelte';

  type GridKey = 'rows' | 'cols' | 'size' | 'gap';
  type GridSetting = { key: GridKey; label: string; min: number; max: number; unit?: string };

  const CANVAS_PALETTE = ['#0a0a0a', '#171717', '#0f172a', '#1e1b4b', '#052e16', '#3f0d12'];

  let { page }: { page: Page } = $props();

  const NONE = '';
  const appletOptions = $derived([
    { value: NONE, label: 'None' },
    ...[...applets.values()].map((applet) => ({ value: applet.id, label: applet.title })),
    ...(page.applet && !applets.has(page.applet)
      ? [{ value: page.applet, label: page.applet, unavailable: true }]
      : []),
  ]);
  const hasGrid = $derived(appletFor(page).slots.some((slot) => slot.grid === 'page'));

  const gridSettings = $derived<GridSetting[]>([
    { key: 'rows', label: 'Rows', min: 1, max: 8 },
    { key: 'cols', label: 'Columns', min: 1, max: 14 },
    ...(page.sizing === 'manual'
      ? [{ key: 'size' as const, label: 'Cell size', min: 60, max: 240, unit: 'px' }]
      : []),
    { key: 'gap', label: 'Gap', min: 0, max: 40, unit: 'px' },
  ]);

  function setCanvasColour(value: string) {
    const { hex, alpha } = splitAlpha(value);
    labelEdit('Canvas colour');
    settings.display.background = { ...settings.display.background, color: hex, opacity: alpha };
  }

  function setCanvasMode(mode: string) {
    if ((mode === 'color' || mode === 'wallpaper') && mode !== settings.display.background.mode) {
      commit('Canvas background');
      settings.display.background = { ...settings.display.background, mode };
    }
  }

  function setCanvasRadius(radius: number) {
    labelEdit('Canvas radius');
    settings.display.background = { ...settings.display.background, radius };
  }

  function setIconScale(scale: number) {
    labelEdit('Icon size');
    settings.display.iconScale = scale;
  }

  function setLabelScale(scale: number) {
    labelEdit('Text size');
    settings.display.labelScale = scale;
  }

  function setSizing(auto: boolean) {
    const sizing = auto ? 'auto' : 'manual';
    if (page.sizing !== sizing) {
      commit('Deck sizing');
      page.sizing = sizing;
    }
  }

  /** Grid size when the current slider gesture started. */
  let gridBefore: { rows: number; cols: number } | undefined;

  function setGrid(key: GridKey, value: number) {
    gridBefore ??= { rows: page.rows, cols: page.cols };
    // Through settings: the `page` prop is not bound, and Svelte warns when a child mutates it.
    const live = settings.deck.pages.find((entry) => entry.id === page.id);
    if (live) {
      live[key] = value;
    }
  }

  // Items outside a shrunk grid are only hidden while the slider is held; releasing it deletes them.
  function commitGrid(key: GridKey) {
    const from = gridBefore ?? { rows: page.rows, cols: page.cols };
    gridBefore = undefined;
    if (key === 'rows' || key === 'cols') {
      finishGridResize(page.id, from);
    }
  }
</script>

<header class="flex h-12 shrink-0 items-center px-4">
  <p class="flex-1 font-semibold">Page</p>
</header>
<div
  class="grid min-h-0 min-w-0 flex-1 content-start gap-6 overflow-x-hidden overflow-y-auto p-4 [scrollbar-gutter:stable]"
>
  <Section>
    <Row
      label="Applet"
      for="page-applet"
    >
      <Choice
        id="page-applet"
        class="w-48"
        value={page.applet ?? NONE}
        options={appletOptions}
        showPluginMark={false}
        onchange={(value) => setPageApplet(page.id, value || undefined)}
      />
    </Row>
  </Section>
  <Section title="Canvas">
    <Row label="Background">
      <ToggleGroup.Root
        type="single"
        variant="outline"
        class="w-48"
        aria-label="Background"
        value={settings.display.background.mode}
        onValueChange={setCanvasMode}
      >
        <ToggleGroup.Item
          value="color"
          class="flex-1">Colour</ToggleGroup.Item
        >
        <ToggleGroup.Item
          value="wallpaper"
          class="flex-1">Wallpaper</ToggleGroup.Item
        >
      </ToggleGroup.Root>
    </Row>
    {#if settings.display.background.mode === 'color'}
      <Row
        label="Colour"
        wide
      >
        <ColorField
          palette={CANVAS_PALETTE}
          value={withAlpha(settings.display.background.color, settings.display.background.opacity)}
          onchange={setCanvasColour}
        />
      </Row>
    {/if}
    <Row label="Corner radius">
      <div class="flex w-40 items-center gap-3">
        <Slider
          type="single"
          class="min-w-0 flex-1"
          value={settings.display.background.radius}
          min={0}
          max={60}
          step={1}
          onValueChange={setCanvasRadius}
        />
        <span class="w-10 text-right text-sm tabular-nums text-muted-foreground">
          {settings.display.background.radius}px
        </span>
      </div>
    </Row>
  </Section>
  <Section title="Actions">
    <Row label="Icon size">
      <div class="flex w-40 items-center gap-3">
        <Slider
          type="single"
          class="min-w-0 flex-1"
          aria-label="Icon size"
          value={settings.display.iconScale}
          min={ICON_SCALE.min}
          max={ICON_SCALE.max}
          step={ICON_SCALE.step}
          onValueChange={setIconScale}
        />
        <span class="w-10 text-right text-sm tabular-nums text-muted-foreground">
          {Math.round(settings.display.iconScale * 100)}%
        </span>
      </div>
    </Row>
    <Row label="Text size">
      <div class="flex w-40 items-center gap-3">
        <Slider
          type="single"
          class="min-w-0 flex-1"
          aria-label="Text size"
          value={settings.display.labelScale}
          min={LABEL_SCALE.min}
          max={LABEL_SCALE.max}
          step={LABEL_SCALE.step}
          onValueChange={setLabelScale}
        />
        <span class="w-10 text-right text-sm tabular-nums text-muted-foreground">
          {Math.round(settings.display.labelScale * 100)}%
        </span>
      </div>
    </Row>
  </Section>
  {#if hasGrid}
    <Section title="Grid">
      <Row
        label="Auto fit"
        for="auto-fit"
      >
        <Switch
          id="auto-fit"
          checked={page.sizing === 'auto'}
          onCheckedChange={setSizing}
        />
      </Row>
      {#each gridSettings as setting (setting.key)}
        <Row label={setting.label}>
          <div class="flex w-40 items-center gap-3">
            <Slider
              type="single"
              class="min-w-0 flex-1"
              value={page[setting.key]}
              min={setting.min}
              max={setting.max}
              step={1}
              onValueChange={(value) => setGrid(setting.key, value)}
              onValueCommit={() => commitGrid(setting.key)}
            />
            <span class="w-10 text-right text-sm tabular-nums text-muted-foreground">
              {page[setting.key]}{setting.unit ?? ''}
            </span>
          </div>
        </Row>
      {/each}
    </Section>
  {/if}
</div>
