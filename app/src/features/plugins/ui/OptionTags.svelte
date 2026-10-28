<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';

  let { detail, unavailable }: { detail?: string; unavailable?: boolean } = $props();
</script>

{#if detail}<Badge
    variant="secondary"
    class="max-w-40 truncate font-normal text-muted-foreground">{detail}</Badge
  >{/if}
{#if unavailable}<Badge variant="outline">Unavailable</Badge>{/if}
