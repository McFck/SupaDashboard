<script lang="ts">
  import { permissionRows, type PluginPermissions } from '../permissions';
  import Row from '../../../panel/ui/Row.svelte';
  import Section from '../../../panel/ui/Section.svelte';

  let { permissions }: { permissions: PluginPermissions } = $props();
  const rows = $derived(permissionRows(permissions));
</script>

{#if rows.length}
  <Section title="Permissions">
    {#each rows as { label, value } (label)}
      <Row {label}><span class="text-right text-sm break-words">{value}</span></Row>
    {/each}
  </Section>
{/if}
