<script lang="ts">
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import { actions } from '../plugins/registry';
  import { currentRuntime } from '../../app/runtime/session.svelte';
  import type { ActionDef, ActionRef } from '../plugins/contracts';
  import { validAppletParam } from './definition';
  import ParamField from '../plugins/ui/ParamField.svelte';
  import { getAppletHostContext } from './context';

  const host = getAppletHostContext();
  const quickActionScale = $derived(1 / Math.max(host?.designScale ?? 1, 0.01));
  let root = $state<HTMLDivElement>();
  let expanded = $state<number | undefined>();
  let running = $state<number | undefined>();
  let drafts = $state<Record<number, Record<string, unknown>>>({});

  function argsFor(ref: ActionRef, index: number, params: ActionDef['params'] = []) {
    const args = { ...ref.args, ...drafts[index] };
    for (const param of params)
      if (!Object.hasOwn(args, param.key) && param.default !== undefined)
        args[param.key] = param.default;
    return args;
  }
  const rows = $derived.by(() =>
    (host?.applet.quickActions ?? []).map((ref, index) => {
      const action = actions.get(ref.id);
      const params = action?.params ?? [];
      const args = argsFor(ref, index, params);
      const valid = params.every((param) => validAppletParam(param, args[param.key], args));
      return { ref, index, action, params, args, valid };
    }),
  );

  function setParam(index: number, key: string, value: unknown) {
    drafts[index] = { ...(drafts[index] ?? {}), [key]: value };
  }

  async function invoke(row: (typeof rows)[number]) {
    if (!host || !row.action || !row.valid || running !== undefined) return;
    host.resetSceneInput();
    running = row.index;
    try {
      const runtime = currentRuntime();
      if (!runtime?.isOwner) throw new Error('Runtime owner is unavailable');
      const result = await runtime.dispatchQuickAction({ id: row.ref.id, args: row.args });
      if (result.status === 'rejected') throw new Error('Runtime owner is unavailable');
      if (result.status === 'completed') host.setQuickActionsOpen(false);
    } catch (error) {
      console.error(error);
      toast.error('Quick action failed');
    } finally {
      running = undefined;
    }
  }

  function keydown(event: KeyboardEvent) {
    if (host?.quickActionsOpen && event.key === 'Escape') {
      event.preventDefault();
      host.setQuickActionsOpen(false);
    }
  }

  $effect(() => {
    const open = host?.quickActionsOpen;
    const element = root;
    if (!open || !element?.parentElement) return;
    host?.resetSceneInput();
    const siblings = [...element.parentElement.children].filter(
      (child): child is HTMLElement => child !== element && child instanceof HTMLElement,
    );
    const previous = siblings.map((child) => child.inert);
    siblings.forEach((child) => {
      child.inert = true;
    });
    return () =>
      siblings.forEach((child, index) => {
        child.inert = previous[index];
      });
  });
</script>

<svelte:window onkeydown={keydown} />

<div
  bind:this={root}
  data-applet-input="ui"
  aria-hidden={!host?.quickActionsOpen}
  inert={!host?.quickActionsOpen}
  class="absolute inset-0 z-50 grid place-items-center p-5 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none"
  class:pointer-events-none={!host?.quickActionsOpen}
  style:opacity={host?.quickActionsOpen ? 1 : 0}
  style:transform={host?.quickActionsOpen ? 'scale(1)' : 'scale(.98)'}
>
  <button
    type="button"
    aria-label="Close quick actions"
    tabindex="-1"
    class="absolute inset-0 bg-black/55"
    onclick={() => host?.setQuickActionsOpen(false)}
  ></button>
  <div
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="applet-quick-actions-title"
    class="relative z-10 grid max-h-full w-full max-w-sm content-start gap-3 overflow-y-auto rounded-xl border bg-card p-4 shadow-xl"
    style:transform={`scale(${quickActionScale})`}
    style:max-height="calc(100vh - 2rem)"
  >
    <header class="flex items-center justify-between gap-3">
      <h2
        id="applet-quick-actions-title"
        class="font-semibold"
      >
        Quick actions
      </h2>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Close quick actions"
        onclick={() => host?.setQuickActionsOpen(false)}>×</Button
      >
    </header>
    {#each rows as row (row.index)}
      <div class="grid gap-2 rounded-lg border bg-background/70 p-2">
        <div class="flex min-w-0 items-center gap-2">
          <Button
            class="min-h-9 min-w-0 flex-1 justify-start"
            variant="outline"
            disabled={!row.action || !row.valid || running !== undefined}
            aria-label={row.action ? `Run ${row.action.title}` : 'Unavailable'}
            onclick={() => void invoke(row)}
          >
            <span class="truncate">{row.action?.title ?? 'Unavailable'}</span>
          </Button>
          {#if row.action?.params?.length}
            <Button
              size="sm"
              class="min-h-9"
              variant="ghost"
              aria-label="Parameters for {row.action.title}"
              aria-expanded={expanded === row.index}
              onclick={() => (expanded = expanded === row.index ? undefined : row.index)}
            >
              {expanded === row.index ? 'Done' : 'Params'}
            </Button>
          {/if}
        </div>
        {#if expanded === row.index && row.action}
          <div class="grid gap-3 border-t pt-3">
            {#each row.params as param (param.key)}
              <ParamField
                {param}
                value={row.args[param.key]}
                args={row.args}
                provider={row.action.plugin}
                showPluginMark={false}
                onchange={(value) => setParam(row.index, param.key, value)}
              />
            {/each}
            <Button
              size="sm"
              class="min-h-9"
              disabled={!row.valid || running !== undefined}
              onclick={() => void invoke(row)}
            >
              {running === row.index ? 'Running' : `Run ${row.action.title}`}
            </Button>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>
