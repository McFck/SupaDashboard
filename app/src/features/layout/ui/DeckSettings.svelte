<script lang="ts">
  // The inspector with nothing selected on the Deck skin: canvas backdrop and grid geometry of the page.
  import { Slider } from '$lib/components/ui/slider';
  import { Switch } from '$lib/components/ui/switch';
  import ColorField from '$lib/components/ColorField.svelte';
  import { splitAlpha, withAlpha } from '$lib/palette';
  import { settings } from '../../settings/state.svelte';
  import type { Page } from '../../settings/schema';
  import { commit, labelEdit } from '../history.svelte';
  import { finishGridResize } from '../slot-edits';
  import Row from '../../../panel/ui/Row.svelte';
  import Section from '../../../panel/ui/Section.svelte';

  type GridKey = 'rows' | 'cols' | 'size' | 'gap';
  type GridSetting = { key: GridKey; label: string; min: number; max: number; unit?: string };

  const CANVAS_PALETTE = ['#0a0a0a', '#171717', '#0f172a', '#1e1b4b', '#052e16', '#3f0d12'];

  let { page }: { page: Page } = $props();

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

  function setCanvasRadius(radius: number) {
    labelEdit('Canvas radius');
    settings.display.background = { ...settings.display.background, radius };
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

<header class="flex h-12 shrink-0 items-center border-b border-[#262626] px-4">
  <p class="flex-1 font-semibold">Deck</p>
</header>
<div
  class="grid min-h-0 min-w-0 flex-1 content-start gap-6 overflow-x-hidden overflow-y-auto p-4 [scrollbar-gutter:stable]"
>
  <Section title="Canvas">
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
        <span class="w-10 text-right text-sm font-mono tabular-nums text-muted-foreground">
          {settings.display.background.radius}px
        </span>
      </div>
    </Row>
  </Section>
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
          <span class="w-10 text-right text-sm font-mono tabular-nums text-muted-foreground">
            {page[setting.key]}{setting.unit ?? ''}
          </span>
        </div>
      </Row>
    {/each}
  </Section>
</div>
