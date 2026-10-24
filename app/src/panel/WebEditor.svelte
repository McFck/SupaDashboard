<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Switch } from '$lib/components/ui/switch';
  import type { ControlConfig } from '../core/controls';
  import { commit } from '../core/history.svelte';
  import { readWebOptions, webUrl } from '../core/content';
  import { toast } from 'svelte-sonner';

  let { control }: { control: ControlConfig } = $props();
  const options = $derived(readWebOptions(control.options));
  let urlDraft = $state('');
  let zoomDraft = $state(100);
  let refreshDraft = $state(0);
  let lastUrl = '';
  let lastZoom = Number.NaN;
  let lastRefresh = Number.NaN;
  const zoomInvalid = $derived(!Number.isFinite(zoomDraft) || zoomDraft < 50 || zoomDraft > 200);
  const refreshInvalid = $derived(!Number.isFinite(refreshDraft) || !(refreshDraft === 0 || refreshDraft >= 1 && refreshDraft <= 86400));

  $effect(() => {
    if (options.url !== lastUrl) { lastUrl = options.url; urlDraft = options.url; }
    if (options.zoom !== lastZoom) { lastZoom = options.zoom; zoomDraft = options.zoom; }
    if (options.refresh !== lastRefresh) { lastRefresh = options.refresh; refreshDraft = options.refresh; }
  });

  function save(label: string, patch: Record<string, unknown>) {
    commit(label);
    control.options = { ...(control.options ?? {}), ...patch };
  }
  function saveUrl() {
    if (!urlDraft) { save('Web URL', { url: '' }); return; }
    const value = webUrl(urlDraft);
    if (!value) { toast.error('Enter an HTTPS URL or a localhost HTTP URL'); return; }
    urlDraft = value;
    save('Web URL', { url: value });
  }
  function saveNumber(key: 'zoom' | 'refresh', label: string, value: number) {
    const valid = Number.isFinite(value) && (key === 'zoom' ? value >= 50 && value <= 200 : value === 0 || value >= 1 && value <= 86400);
    if (!valid) { toast.error(key === 'zoom' ? 'Zoom must be between 50 and 200' : 'Refresh must be zero or between 1 and 86400 seconds'); return; }
    save(label, { [key]: value });
  }
</script>

<div class="grid gap-1.5">
  <Label for="web-url">URL</Label>
  <Input id="web-url" type="url" bind:value={urlDraft} aria-invalid={!!urlDraft && !webUrl(urlDraft)}
    placeholder="https://" onchange={saveUrl} />
</div>

<div class="grid gap-1.5">
  <Label for="web-zoom">Zoom (%)</Label>
  <Input id="web-zoom" type="number" min="50" max="200" step="1" bind:value={zoomDraft} aria-invalid={zoomInvalid}
    onchange={event => saveNumber('zoom', 'Web zoom', event.currentTarget.valueAsNumber)} />
</div>

<div class="grid gap-1.5">
  <Label for="web-refresh">Refresh (seconds)</Label>
  <Input id="web-refresh" type="number" min="0" max="86400" step="1" bind:value={refreshDraft}
    aria-invalid={refreshInvalid}
    onchange={event => saveNumber('refresh', 'Web refresh', event.currentTarget.valueAsNumber)} />
</div>

<label class="flex items-center justify-between gap-3 text-sm">Interactive
  <Switch checked={options.interactive} onCheckedChange={checked => save('Web interactive', { interactive: checked })} />
</label>
