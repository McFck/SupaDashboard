<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: DialogPrimitive.OverlayProps = $props();
</script>

<DialogPrimitive.Overlay
	bind:ref
	data-slot="dialog-overlay"
	class={cn("data-open:opacity-100 data-closed:opacity-0 transition-opacity duration-150 bg-black/10 supports-backdrop-filter:backdrop-blur-xs fixed inset-0 isolate z-50", className)}
	{...restProps}
/>
