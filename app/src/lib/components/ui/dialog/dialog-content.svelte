<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from "$lib/components/ui/button/index.js";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import * as Dialog from "./index.js";
	import DialogPortal from "./dialog-portal.svelte";
	import type { Snippet } from "svelte";
	import type { ComponentProps } from "svelte";

	let {
		ref = $bindable(null),
		class: className,
		portalProps,
		children,
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DialogPortal>>;
		children: Snippet;
	} = $props();
</script>

<DialogPortal {...portalProps}>
	<Dialog.Overlay />
	<DialogPrimitive.Content
		bind:ref
		data-slot="dialog-content"
		class={cn(
			"modal-content bg-popover text-popover-foreground chamfer grid max-h-[calc(100dvh-2rem)] max-w-96 gap-4 overflow-y-auto rounded-xl p-4 text-sm fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 outline-none",
			className
		)}
		{...restProps}
	>
		{@render children?.()}
		<DialogPrimitive.Close data-slot="dialog-close">
			{#snippet child({ props })}
				<Button variant="ghost" class="absolute top-2 right-2" size="icon-sm" {...props}>
					<XIcon  />
					<span class="sr-only">Close</span>
				</Button>
			{/snippet}
		</DialogPrimitive.Close>
	</DialogPrimitive.Content>
</DialogPortal>
