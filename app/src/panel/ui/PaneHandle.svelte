<script lang="ts">
  // Pane divider in the look of shadcn's ResizableHandle: an invisible hit area whose line lights up on hover and while held.
  let {
    label,
    active = false,
    class: className = '',
    onpointerdown,
    onkeydown,
  }: {
    label: string;
    active?: boolean;
    class?: string;
    onpointerdown: (e: PointerEvent & { currentTarget: HTMLButtonElement }) => void;
    onkeydown: (e: KeyboardEvent) => void;
  } = $props();
</script>

<button
  type="button"
  aria-label={label}
  data-active={active}
  {onpointerdown}
  {onkeydown}
  class="group absolute z-20 w-3 cursor-col-resize touch-none bg-transparent outline-none {className}"
>
  <span
    aria-hidden="true"
    class="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent transition-colors duration-150
    group-hover:bg-foreground/20 group-focus-visible:bg-ring group-data-[active=true]:bg-primary"
  ></span>
</button>
