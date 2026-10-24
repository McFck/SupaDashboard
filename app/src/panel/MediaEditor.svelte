<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Switch } from '$lib/components/ui/switch';
  import type { ControlConfig } from '../core/controls';
  import { mediaUrl, readMediaOptions, type MediaSource } from '../core/content';
  import { commit } from '../core/history.svelte';
  import Choice from '../editor/Choice.svelte';

  let { control }: { control: ControlConfig } = $props();
  let sources = $state<MediaSource[]>([]);
  let sourcesKey = '';
  const options = $derived(readMediaOptions(control.options));

  $effect(() => {
    const next = readMediaOptions(control.options).sources;
    const key = JSON.stringify(next);
    if (key !== sourcesKey) { sourcesKey = key; sources = next; }
  });

  function save(label: string, patch: Record<string, unknown>) {
    commit(label);
    control.options = { ...(control.options ?? {}), ...patch };
  }
  function setSources(next: MediaSource[]) {
    sources = next;
    save('Media sources', { sources: next });
  }
  function changeSource(index: number, value: string) {
    const next = sources.map((source, at) => at === index ? { kind: 'url' as const, value } : source);
    sources = next;
    if (!value || mediaUrl(value)) setSources(next.map((source, at) => at === index && value
      ? { ...source, value: mediaUrl(value)! } : source));
  }
</script>

<section class="grid gap-3">
  <div class="flex items-center justify-between">
    <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources</h3>
    <Button variant="ghost" size="sm" aria-label="Add image URL" onclick={() => setSources([...sources, { kind: 'url', value: '' }])}><Plus /> Add URL</Button>
  </div>
  {#each sources as source, i (i)}
    <div class="flex min-w-0 items-center gap-2">
      <Label class="sr-only" for="media-url-{i}">Image URL {i + 1}</Label>
      <Input id="media-url-{i}" type="url" value={source.value} aria-invalid={!!source.value && !mediaUrl(source.value)}
        placeholder="https://" onchange={event => changeSource(i, event.currentTarget.value)} />
      <Button size="icon-sm" variant="ghost" aria-label="Remove image URL {i + 1}"
        onclick={() => setSources(sources.filter((_, at) => at !== i))}><Trash /></Button>
    </div>
  {/each}
</section>

<div class="grid gap-1.5">
  <Label for="media-fit">Fit</Label>
  <Choice id="media-fit" value={options.fit} options={[{ value: 'cover', label: 'Cover' }, { value: 'contain', label: 'Contain' }]}
    aria-label="Fit" onchange={value => save('Media fit', { fit: value })} />
</div>

<div class="grid gap-1.5">
  <Label for="media-interval">Interval (seconds)</Label>
  <Input id="media-interval" type="number" min="1" max="86400" step="1" value={options.interval}
    onchange={event => {
      const value = Number(event.currentTarget.value);
      if (Number.isFinite(value) && value >= 1 && value <= 86400) save('Media interval', { interval: value });
    }} />
</div>

<section class="grid gap-3">
  <label class="flex items-center justify-between gap-3 text-sm">Loop
    <Switch checked={options.loop} onCheckedChange={checked => save('Media loop', { loop: checked })} />
  </label>
  <label class="flex items-center justify-between gap-3 text-sm">Muted
    <Switch checked={options.muted} onCheckedChange={checked => save('Media mute', { muted: checked })} />
  </label>
</section>
