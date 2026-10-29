<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import { backOut, cubicOut } from 'svelte/easing';
  import { toast } from 'svelte-sonner';

  export type MenuAction = {
    label: string;
    run: () => void | Promise<void>;
    disabled?: boolean;
    danger?: boolean;
  };
  let {
    open,
    x,
    y,
    actions,
    onclose,
    ariaLabel = 'Widget actions',
  }: {
    open: boolean;
    x: number;
    y: number;
    actions: MenuAction[];
    onclose: () => void;
    ariaLabel?: string;
  } = $props();
  let menu = $state<HTMLDivElement>();
  let closing = $state(false);
  let restoreFocus = true;
  let actionRun = false;

  function position(node: HTMLElement, pose: { x: number; y: number }) {
    const apply = ({ x, y }: { x: number; y: number }) => {
      const left = Math.max(8, Math.min(x, window.innerWidth - node.offsetWidth - 8));
      const top = Math.max(8, Math.min(y, window.innerHeight - node.offsetHeight - 8));
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
      node.style.transformOrigin = `${Math.max(0, Math.min(x - left, node.offsetWidth))}px ${Math.max(0, Math.min(y - top, node.offsetHeight))}px`;
    };
    apply(pose);
    return { update: apply };
  }

  function intro(node: HTMLElement) {
    const duration = prefersReducedMotion.current ? 0 : 170;
    return {
      duration,
      easing: backOut,
      css: (t: number) => `opacity:${t};transform:scale(${0.92 + 0.08 * t})`,
    };
  }
  function outro(node: HTMLElement) {
    const duration = prefersReducedMotion.current ? 0 : 120;
    return {
      duration,
      easing: cubicOut,
      css: (t: number) => `opacity:${t};transform:scale(${0.97 + 0.03 * t})`,
    };
  }

  function visible(element: HTMLElement | null): element is HTMLElement {
    if (!element || !element.isConnected || element.closest('[inert], [aria-hidden="true"]'))
      return false;
    const style = getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      element.getClientRects().length > 0
    );
  }
  function close(restore = true) {
    if (closing) return;
    restoreFocus = restore;
    closing = true;
    onclose();
  }

  $effect(() => {
    if (!open && !closing) {
      restoreFocus = true;
      closing = true;
    }
  });

  $effect(() => {
    const target = menu;
    if (!target || !open || closing) return;
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void tick().then(() => {
      if (!open || closing || !target.isConnected) return;
      const first = target.querySelector<HTMLButtonElement>('button:not(:disabled)');
      (first ?? target).focus({ preventScroll: true });
    });
    return () => {
      const active = document.activeElement;
      if (
        restoreFocus &&
        (active === target || target.contains(active)) &&
        visible(invoker) &&
        invoker !== document.body
      ) {
        invoker.focus({ preventScroll: true });
      }
    };
  });

  $effect(() => {
    const target = menu;
    if (!target || !open || closing) return;
    const containsEvent = (event: Event) => event.composedPath().includes(target);
    const outsidePointer = (event: PointerEvent) => {
      if (!containsEvent(event)) close(false);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'Tab') close(false);
    };
    const scroll = (event: Event) => {
      if (!containsEvent(event)) close();
    };
    const wheel = (event: WheelEvent) => {
      if (!containsEvent(event)) close(false);
    };
    const blur = () => close(false);
    const resize = () => close();

    document.addEventListener('pointerdown', outsidePointer, true);
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('wheel', wheel, { capture: true, passive: true });
    window.addEventListener('blur', blur);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outsidePointer, true);
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('scroll', scroll, true);
      document.removeEventListener('wheel', wheel, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', resize);
    };
  });

  onDestroy(() => {
    if (menu) {
      menu.inert = true;
      menu.setAttribute('aria-hidden', 'true');
    }
  });

  function keyboard(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (!buttons.length) return;
    event.preventDefault();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : at < 0
            ? 0
            : (at + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next]?.focus({ preventScroll: true });
  }
  function choose(action: MenuAction) {
    if (closing || actionRun || action.disabled) return;
    actionRun = true;
    close(false);
    const fail = (error: unknown) => {
      console.error(error);
      toast.error(`${action.label} failed`);
    };
    try {
      void Promise.resolve(action.run()).catch(fail);
    } catch (error) {
      fail(error);
    }
  }
</script>

<div
  bind:this={menu}
  use:position={{ x, y }}
  role="menu"
  tabindex="-1"
  aria-label={ariaLabel}
  aria-hidden={!open || closing}
  inert={!open || closing}
  onkeydown={keyboard}
  oncontextmenu={(event) => event.preventDefault()}
  in:intro
  out:outro
  class="fixed z-50 grid max-h-[calc(100dvh-16px)] w-56 gap-0.5 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
>
  {#each actions as action (action.label)}
    <button
      type="button"
      role="menuitem"
      tabindex="-1"
      disabled={action.disabled}
      aria-label={action.label}
      onclick={() => choose(action)}
      class="flex min-h-8 items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm outline-none hover:bg-accent focus:bg-accent disabled:pointer-events-none disabled:opacity-40 {action.danger
        ? 'text-destructive'
        : ''}"
    >
      {action.label}
    </button>
  {/each}
</div>
