<script lang="ts">
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import { Popover } from 'bits-ui';
  import { Button } from '$lib/components/ui/button';
  import type { ControlConfig } from '../controls/model';
  import { TRIGGERS, TRIGGER_LABELS, type TriggerList } from '../automation/scenario';
  import { effectSteps, setScenarioEffect } from './scenario-effects';
  import type { ScenarioListOwner } from '../automation/editor/scenario-edit';
  import type { EffectId } from './catalogue';
  import EffectPicker from './EffectPicker.svelte';
  import { commit } from '../layout/history.svelte';
  import { settings } from '../settings/state.svelte';
  import { actions, registeredEvents } from '../plugins/registry';
  import { getAppletHostContext } from '../applets/context';

  let { control }: { control: ControlConfig } = $props();
  const host = getAppletHostContext();
  const scale = $derived(1 / Math.max(host?.designScale ?? 1, 0.01));
  let open = $state(false);
  const rows = $derived.by(() => {
    const result: { label: string; owner: ScenarioListOwner; effect: EffectId; stepId?: string }[] =
      [];
    function append(list: TriggerList | undefined, owner: ScenarioListOwner, label: string) {
      if (!list) {
        return;
      }
      if (list.effect) {
        result.push({ label, owner, effect: list.effect });
      }
      for (const step of effectSteps(list)) {
        if (step.effect) {
          result.push({
            label: `${label} · ${actions.get(step.label)?.title ?? step.label}`,
            owner,
            effect: step.effect,
            stepId: step.id,
          });
        }
      }
    }
    for (const trigger of TRIGGERS) {
      append(
        control.scenario?.triggers[trigger],
        { kind: 'trigger', trigger },
        TRIGGER_LABELS[trigger],
      );
    }
    for (const event of control.scenario?.events ?? []) {
      const title =
        registeredEvents().find((entry) => entry.id === event.eventId)?.title ?? event.eventId;
      append(
        event.list,
        { kind: 'event', eventId: event.id },
        event.parameter ? `${title}: ${event.parameter}` : title,
      );
    }
    return result;
  });
  function change(owner: ScenarioListOwner, effect: EffectId | undefined, stepId?: string) {
    const latest = settings.controls.find((entry) => entry.id === control.id);
    if (!latest?.scenario) {
      return;
    }
    commit('Edit tile effect');
    latest.scenario = setScenarioEffect(latest.scenario, owner, effect, stepId);
  }
</script>

{#if rows.length || open}
  <div
    class="absolute z-30 origin-top-right"
    style:top="{16 * scale}px"
    style:right="{16 * scale}px"
    style:scale
  >
    <Popover.Root bind:open>
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            size="icon-sm"
            variant="secondary"
            aria-label={`Effects for ${control.name}`}
            class="rounded-full shadow"><Sparkles class="size-4" /></Button
          >
        {/snippet}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="end"
          class="z-[90] grid max-h-80 w-72 gap-1 overflow-y-auto rounded-xl bg-popover p-2 text-popover-foreground shadow-lg ring-1 ring-border"
          aria-label="Control effects"
        >
          {#each rows as row (`${row.owner.kind}:${row.owner.kind === 'event' ? row.owner.eventId : row.owner.trigger}:${row.stepId ?? ''}`)}
            <div class="flex min-w-0 items-center gap-2 px-2">
              <span class="min-w-0 flex-1 truncate text-xs">{row.label}</span>
              <EffectPicker
                value={row.effect}
                label={`${row.label} effect`}
                onchange={(effect) => change(row.owner, effect, row.stepId)}
              />
            </div>
          {/each}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>
{/if}
