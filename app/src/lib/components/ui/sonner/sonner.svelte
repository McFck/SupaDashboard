<script lang="ts">
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from "svelte-sonner";
	import { cn } from '$lib/utils';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import OctagonXIcon from '@lucide/svelte/icons/octagon-x';
	import InfoIcon from '@lucide/svelte/icons/info';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	let {
		theme = 'dark',
		position = 'bottom-center',
		offset = 24,
		mobileOffset = 16,
		duration = 4000,
		visibleToasts = 3,
		gap = 8,
		expand = false,
		richColors = false,
		toastOptions,
		class: className = '',
		style: customStyle = '',
		...restProps
	}: SonnerProps = $props();
</script>

<Sonner
	{...restProps}
	{theme}
	{position}
	{offset}
	{mobileOffset}
	{duration}
	{visibleToasts}
	{gap}
	{expand}
	{richColors}
	class={cn('toaster group', className)}
	style="{customStyle}; --normal-bg: var(--popover); --normal-text: var(--popover-foreground); --normal-border: var(--border);"
	toastOptions={{
		...toastOptions,
		classes: {
			...toastOptions?.classes,
			toast: cn(toastOptions?.classes?.toast, '!text-xs !w-auto !min-w-0 !max-w-[calc(100vw-2rem)] !py-2 !px-3'),
			actionButton: cn(toastOptions?.classes?.actionButton, '!rounded-md !outline-none focus-visible:!ring-2 focus-visible:!ring-ring/30'),
		},
	}}
>
	{#snippet loadingIcon()}
		<Loader2Icon class="size-4 animate-spin" />
	{/snippet}
	{#snippet successIcon()}
		<CircleCheckIcon class="size-4" />
	{/snippet}
	{#snippet errorIcon()}
		<OctagonXIcon class="size-4" />
	{/snippet}
	{#snippet infoIcon()}
		<InfoIcon class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<TriangleAlertIcon class="size-4" />
	{/snippet}
</Sonner>
