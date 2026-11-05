<script lang="ts">
  import ListOrdered from '@lucide/svelte/icons/list-ordered';
  import Workflow from '@lucide/svelte/icons/workflow';
  import Zap from '@lucide/svelte/icons/zap';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Hint } from '$lib/components/ui/tooltip';
  import type { ControlConfig } from '../model';
  import {
    isEmptyList,
    scenarioStepCount,
    TRIGGER_LABELS,
    type Trigger,
  } from '../../automation/scenario';
  import { controlTriggers } from '../../plugins/registry';

  let { control, onedit }: { control: ControlConfig; onedit: (trigger?: Trigger) => void } =
    $props();
  const configured = $derived(
    controlTriggers(control.type).filter(
      (trigger) => !isEmptyList(control.scenario?.triggers[trigger]),
    ),
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
  const triggersText = $derived(
    `${configured.length} ${configured.length === 1 ? 'trigger' : 'triggers'}`,
  );
  const stepsText = $derived(`${totalSteps} ${totalSteps === 1 ? 'step' : 'steps'}`);
</script>

<div class="grid gap-2">
  <Button
    variant="secondary"
    class="justify-between"
    aria-label="Edit scenario, {triggersText}, {stepsText}"
    onclick={() => onedit('press')}
  >
    <span class="flex items-center gap-2"><Workflow />Edit scenario</span>
    <span class="flex items-center gap-1">
      {#each [{ icon: Zap, count: configured.length, text: triggersText }, { icon: ListOrdered, count: totalSteps, text: stepsText }] as tag (tag.text)}
        <Hint text={tag.text}>
          {#snippet children(props)}
            <Badge
              {...props}
              tabindex={-1}
              variant="outline"
              class="tabular-nums"><tag.icon />{tag.count}</Badge
            >
          {/snippet}
        </Hint>
      {/each}
    </span>
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
