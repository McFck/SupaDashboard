<script lang="ts">
  import { onDestroy, onMount, tick, untrack, type Snippet } from 'svelte';
  import { Collapsible } from 'bits-ui';
  import { cn } from '$lib/utils';
  import { animateGroupLayout, cancelGroupLayout, contentFrames, contentPose, MotionLifecycle } from './motion';

  let { open = false, onOpenChange = () => {}, list, disabled = false, trigger, children, class: className = '', triggerClass: triggerClassName = '' }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    list?: HTMLElement;
    disabled?: boolean;
    trigger: Snippet;
    children: Snippet;
    class?: string;
    triggerClass?: string;
  } = $props();

  const motion = new MotionLifecycle();
  const initialOpen = untrack(() => open);
  let internalOpen = $state(initialOpen);
  let requestedOpen = initialOpen;
  let renderedOpen = $state(initialOpen);
  let closing = $state(false);
  let reducedMotion = $state(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  let triggerNode = $state<HTMLButtonElement | null>(null);
  let contentNode = $state<HTMLElement | null>(null);
  let bodyNode = $state<HTMLElement>();

  function requestOpen(next: boolean, from = contentPose(bodyNode)) {
    if (next === requestedOpen) return;
    requestedOpen = next;
    internalOpen = next;
    const hadBody = renderedOpen;
    const generation = motion.begin();

    if (next) {
      animateGroupLayout(list);
      renderedOpen = true;
      closing = false;
      if (reducedMotion) return;
      void tick().then(() => {
        if (!motion.current(generation) || !bodyNode) return;
        const start = hadBody ? from : { opacity: 0, y: 4 };
        motion.animate(bodyNode, contentFrames(start, { opacity: 1, y: 0 }),
          { duration: 180, easing: 'ease-out', fill: 'both' });
      });
      return;
    }

    closing = hadBody;
    if (contentNode?.contains(document.activeElement)) triggerNode?.focus();
    if (reducedMotion || !hadBody) {
      animateGroupLayout(list);
      renderedOpen = false;
      closing = false;
      return;
    }

    void tick().then(() => {
      if (!motion.current(generation) || !bodyNode) return;
      motion.animate(bodyNode, contentFrames(from, { opacity: 0, y: -4 }),
        { duration: 100, easing: 'ease-out', fill: 'both' });
      motion.after(generation, 100, () => {
        animateGroupLayout(list);
        renderedOpen = false;
        closing = false;
      });
    });
  }

  function handleOpenChange(next: boolean) {
    requestOpen(next);
    onOpenChange(next);
  }

  $effect.pre(() => {
    const desired = open;
    if (desired !== requestedOpen) requestOpen(desired);
  });

  onMount(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => {
      reducedMotion = query.matches;
      if (!reducedMotion) return;
      motion.cancel();
      cancelGroupLayout(list);
      closing = false;
      renderedOpen = requestedOpen;
      internalOpen = requestedOpen;
    };
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  });

  onDestroy(() => motion.dispose());
</script>

<Collapsible.Root bind:open={internalOpen} onOpenChange={handleOpenChange}
  data-disclosure-group class={cn('disclosure-group group border-b py-1.5', className)}>
<Collapsible.Trigger bind:ref={triggerNode} disabled={disabled}
    class={cn('flex min-h-[44px] w-full cursor-pointer list-none items-center gap-3 rounded-lg p-3 text-left hover:bg-accent disabled:cursor-default', triggerClassName)}>
    {@render trigger()}
  </Collapsible.Trigger>
  <Collapsible.Content bind:ref={contentNode} forceMount inert={!renderedOpen || closing}
    aria-hidden={!renderedOpen || closing} class="disclosure-content">
    {#if renderedOpen}
      <div bind:this={bodyNode} class="disclosure-body">
        {@render children()}
      </div>
    {/if}
  </Collapsible.Content>
</Collapsible.Root>
