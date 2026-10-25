<script lang="ts">
  // Pane divider grip in the look of shadcn's ResizableHandle withHandle.
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  let { label, class: className = '', onpointerdown, onkeydown }: { label: string; class?: string;
    onpointerdown: (e: PointerEvent & { currentTarget: HTMLButtonElement }) => void;
    onkeydown: (e: KeyboardEvent) => void } = $props();
</script>

<button type="button" aria-label={label} {onpointerdown} {onkeydown}
  class="group absolute z-20 flex w-3 cursor-col-resize touch-none items-center justify-center bg-transparent outline-none {className}">
  <span aria-hidden="true" class="z-10 flex h-4 w-3 items-center justify-center rounded-sm border border-[#2e2e2e] bg-[#262626] text-muted-foreground transition-colors group-hover:text-foreground group-focus-visible:ring-1 group-focus-visible:ring-ring">
    <GripVertical size={10} />
  </span>
</button>
