<script lang="ts">
  // The monitor an app is on, by the readable name the watcher publishes in `app.<slug>.display`.
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import SuggestionInput from '../../plugins/ui/SuggestionInput.svelte';
  import type { Option } from '../../plugins/contracts';
  import { monitorChoices } from '../../../platform/window';

  let { value, onchange }: { value: string; onchange: (name: string) => void } = $props();
  let options = $state<Option[]>([]);

  async function refresh() {
    try {
      const seen = new Set<string>();
      // Two identical models share one readable name, and the name is the answer.
      options = (await monitorChoices())
        .filter((monitor) => !seen.has(monitor.label) && seen.add(monitor.label))
        .map((monitor) => ({
          value: monitor.label,
          label: monitor.label,
          detail: monitor.detail,
        }));
    } catch {
      toast.error('Could not refresh options');
    }
  }

  onMount(() => {
    void refresh();
  });
</script>

<SuggestionInput
  strict
  {value}
  suggestions={options}
  placeholder="Monitor"
  aria-label="Monitor"
  {onchange}
  onrefresh={refresh}
/>
