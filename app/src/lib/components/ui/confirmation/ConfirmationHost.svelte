<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { buttonVariants } from '$lib/components/ui/button';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { completeConfirmation, confirmationState, disposeConfirmations, settleConfirmation } from './confirm.svelte';

  let open = $state(false);
  let actionButton = $state<HTMLButtonElement | null>(null);
  let cancelButton = $state<HTMLButtonElement | null>(null);
  let closing: { id: number; invoker: HTMLElement | null; restored: boolean } | null = null;
  const request = $derived(confirmationState.current);

  $effect(() => {
    if (request && !request.settled) open = true;
  });

  function visible(element: HTMLElement | null): element is HTMLElement {
    if (!element?.isConnected || element.closest('[inert], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  }

  function restoreFocus(id: number) {
    if (!closing || closing.id !== id || closing.restored) return;
    closing.restored = true;
    const invoker = closing.invoker;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (confirmationState.current) {
        if (closing?.id === id) closing = null;
        return;
      }
      if (visible(invoker)) invoker.focus({ preventScroll: true });
      else {
        const fallback = document.querySelector<HTMLElement>('main [role="tab"][aria-selected="true"], main h1, main');
        if (visible(fallback)) {
          if (!fallback.hasAttribute('tabindex')) fallback.tabIndex = -1;
          fallback.focus({ preventScroll: true });
        }
      }
      if (closing?.id === id) closing = null;
    }));
  }

  function settle(result: boolean) {
    const active = confirmationState.current;
    if (!active || !settleConfirmation(active.id, result)) return;
    closing = { id: active.id, invoker: active.invoker, restored: false };
    open = false;
  }

  function openChange(value: boolean) {
    open = value;
    if (!value && request && !request.settled) settle(false);
  }

  function focusInitial(event: Event) {
    event.preventDefault();
    const id = request?.id;
    void tick().then(() => {
      const active = confirmationState.current;
      if (!open || !active || active.id !== id) return;
      (active.cancel === false ? actionButton : cancelButton)?.focus();
    });
  }

  function closeAutoFocus(event: Event) {
    event.preventDefault();
  }

  function openChangeComplete(value: boolean) {
    if (value) return;
    const active = confirmationState.current;
    if (!active?.settled) return;
    const id = active.id;
    completeConfirmation(id);
    restoreFocus(id);
  }

  onDestroy(disposeConfirmations);
</script>

<AlertDialog.Root {open} onOpenChange={openChange} onOpenChangeComplete={openChangeComplete}>
  {#if request}
    <AlertDialog.Content aria-describedby={undefined} interactOutsideBehavior="close" onOpenAutoFocus={focusInitial} onCloseAutoFocus={closeAutoFocus}
      onEscapeKeydown={() => settle(false)} onInteractOutside={() => settle(false)}
      class="w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto max-w-96 rounded-xl p-4">
      <AlertDialog.Header><AlertDialog.Title>{request.title}</AlertDialog.Title></AlertDialog.Header>
      {#if request.details?.length}
        <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          {#each request.details as { label, value }, index (index)}
            <dt class="font-medium">{label}</dt>
            <dd class="break-words text-muted-foreground">{value}</dd>
          {/each}
        </dl>
      {/if}
      <AlertDialog.Footer>
        {#if request.cancel !== false}
          <AlertDialog.Cancel bind:ref={cancelButton} onclick={() => settle(false)}>Cancel</AlertDialog.Cancel>
        {/if}
        <AlertDialog.Action bind:ref={actionButton} class={buttonVariants({ variant: request.destructive ? 'destructive' : 'default' })}
          onclick={() => settle(true)}>{request.action}</AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  {/if}
</AlertDialog.Root>
