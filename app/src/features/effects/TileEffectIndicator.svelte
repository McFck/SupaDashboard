<script lang="ts">
  import type { ControlConfig } from '../controls/model';
  import { effectSteps } from './scenario-effects';
  import EffectMark from './EffectMark.svelte';
  import { getAppletHostContext } from '../applets/context';

  let { control }: { control: ControlConfig } = $props();
  const host = getAppletHostContext();
  const scale = $derived(1 / Math.max(host?.designScale ?? 1, 0.01));
  const hasEffect = $derived(
    [
      ...Object.values(control.scenario?.triggers ?? {}),
      ...(control.scenario?.events ?? []).map((event) => event.list),
    ].some((list) => list && (list.effect || effectSteps(list).some((step) => step.effect))),
  );
</script>

{#if hasEffect}
  <div
    role="img"
    aria-label={`Effects for ${control.name}`}
    class="pointer-events-none absolute z-30 origin-top-right"
    style:top="{16 * scale}px"
    style:right="{16 * scale}px"
    style:scale
  >
    <EffectMark class="size-7 bg-black/50 shadow-md backdrop-blur-md" />
  </div>
{/if}
