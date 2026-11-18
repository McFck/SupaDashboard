<script lang="ts">
  import type { Snippet } from 'svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import { Button } from '$lib/components/ui/button';
  import type { CatalogEntry } from '../plugin-store';
  import { nativePlugins } from '../registry';
  import Row from '../../../panel/ui/Row.svelte';
  import Section from '../../../panel/ui/Section.svelte';
  import { followLink, formatDate, formatSize } from './about';
  import PermissionsSection from './PermissionsSection.svelte';
  import PluginHeader from './PluginHeader.svelte';

  let { entry, onback, children }: { entry: CatalogEntry; onback: () => void; children: Snippet } =
    $props();
</script>

<div class="mx-auto grid max-w-[740px] gap-8 px-6 py-9">
  <Button
    variant="ghost"
    size="sm"
    class="w-fit"
    onclick={onback}><ArrowLeft />Market</Button
  >
  <div class="grid gap-3">
    <PluginHeader
      title={entry.title}
      icon={entry.icon}
      version={entry.version}
      trust={nativePlugins.get(entry.id)?.trust === 'dev' ? 'dev' : 'verified'}
      description={entry.description}
      guide={entry.guide || undefined}
    >
      {@render children()}
    </PluginHeader>
  </div>
  <PermissionsSection permissions={entry.permissions} />
  <Section title="About">
    <Row label="Version"><span class="text-sm tabular-nums">{entry.version}</span></Row>
    <Row label="Updated"><span class="text-sm">{formatDate(entry.published)}</span></Row>
    <Row label="Size"><span class="text-sm tabular-nums">{formatSize(entry.size)}</span></Row>
    <Row label="Source">
      <a
        href={entry.source}
        class="truncate text-sm font-medium text-primary underline underline-offset-2"
        onclick={(event) => followLink(event, entry.source)}
        >{entry.source.replace(/^https:\/\//, '')}</a
      >
    </Row>
  </Section>
</div>
