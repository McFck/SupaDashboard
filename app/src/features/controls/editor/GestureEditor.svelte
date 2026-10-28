<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { ControlConfig } from '../model';
  import {
    scenarioStepCount,
    TRIGGER_LABELS,
    TRIGGERS,
    type Trigger,
  } from '../../automation/scenario';

  let { control, onedit }: { control: ControlConfig; onedit: (trigger?: Trigger) => void } =
    $props();
  const configured = $derived(
    TRIGGERS.filter((trigger) => control.scenario?.triggers[trigger] !== undefined),
  );
  const stepCount = (trigger: Trigger) => {
    const list = control.scenario?.triggers[trigger];
    return list
      ? scenarioStepCount(list.steps) +
          Object.values(list.byState ?? {}).reduce(
            (sum, steps) => sum + scenarioStepCount(steps),
            0,
          )
      : 0;
  };
  const events = $derived(control.scenario?.events ?? []);
  const totalSteps = $derived(
    configured.reduce((count, trigger) => count + stepCount(trigger), 0) +
      events.reduce((count, event) => count + scenarioStepCount(event.list.steps), 0),
  );
</script>

<div class="grid gap-2">
  <Button
    variant="outline"
    size="sm"
    class="justify-between"
    onclick={() => onedit('press')}
  >
    <span>Edit scenario</span>
    <span class="text-xs tabular-nums text-muted-foreground"
      >{configured.length} · {totalSteps}</span
    >
  </Button>
  {#each configured as trigger (trigger)}
    <Button
      variant="ghost"
      size="sm"
      class="min-w-0 justify-between"
      aria-label="Edit {TRIGGER_LABELS[trigger]}, {stepCount(trigger)} steps"
      onclick={() => onedit(trigger)}
    >
      <span class="truncate">{TRIGGER_LABELS[trigger]}</span><span
        class="shrink-0 text-xs tabular-nums text-muted-foreground">{stepCount(trigger)}</span
      >
    </Button>
  {/each}
  {#if control.scenario?.events.length}
    <Button
      variant="ghost"
      size="sm"
      class="justify-between"
      onclick={() => onedit('press')}
    >
      <span>Events</span><span class="text-xs tabular-nums text-muted-foreground"
        >{control.scenario.events.length}</span
      >
    </Button>
  {/if}
</div>
