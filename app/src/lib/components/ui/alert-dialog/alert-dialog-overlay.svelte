<script lang="ts">
	import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: AlertDialogPrimitive.OverlayProps = $props();
</script>

<AlertDialogPrimitive.Overlay
	bind:ref
	data-slot="alert-dialog-overlay"
	class={cn("data-open:opacity-100 data-closed:opacity-0 transition-opacity duration-150 bg-black/10 supports-backdrop-filter:backdrop-blur-xs fixed inset-0 z-50", className)}
	{...restProps}
/>
