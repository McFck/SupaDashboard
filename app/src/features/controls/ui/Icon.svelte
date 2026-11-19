<script
  lang="ts"
  module
>
  import { icons } from '@lucide/svelte';
  import { customIcons } from '../../plugins/registry';
  import { brandIcons } from '../brand-icons';
  /** Every Lucide icon name plus plugin icons, for the picker. */
  export const iconNames = () => [...Object.keys(icons), ...customIcons.keys()].sort();
  export const appIconNames = () => Object.keys(brandIcons);
  /** A plugin's own icon exists only once it is installed; the Market shows others before that. */
  export const iconOr = (name: string | undefined, fallback: string) =>
    name && (Object.hasOwn(icons, name) || Object.hasOwn(brandIcons, name) || customIcons.has(name))
      ? name
      : fallback;
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { appIcon } from '../../apps/picker.svelte';
  import { appImage, requestAppIcon } from '../../apps/icons.svelte';
  let {
    name,
    app,
    size = 24,
    fallback = '',
  }: { name?: string; app?: string; size?: number; fallback?: string } = $props();
  const icon = $derived(app ? appIcon(app) : name);
  const image = $derived(app ? appImage(app) : undefined);
  let failed = $state<string>();
  $effect(() => {
    if (app) {
      const key = app;
      untrack(() => void requestAppIcon(key));
    }
  });
  const Lucide = $derived(
    icon && Object.hasOwn(icons, icon) ? icons[icon as keyof typeof icons] : undefined,
  );
  const custom = $derived(icon ? (brandIcons[icon] ?? customIcons.get(icon)) : undefined);
  const customImage = $derived(custom?.startsWith('data:image/') ? custom : undefined);
</script>

{#if image && image !== failed}
  <img
    src={image}
    alt=""
    width={size}
    height={size}
    class="shrink-0 object-contain"
    onerror={() => {
      failed = image;
    }}
  />
{:else if customImage}
  <img
    src={customImage}
    alt=""
    width={size}
    height={size}
    class="shrink-0 object-contain"
  />
{:else if Lucide}
  <Lucide
    {size}
    strokeWidth={1.75}
  />
{:else if custom}
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={icon === 'android' ? 'currentColor' : 'none'}
    stroke={icon === 'android' ? 'none' : 'currentColor'}
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"><path d={custom} /></svg
  >
{:else}
  <span
    class="font-semibold"
    style:font-size="{Math.max(10, size * 0.55)}px">{fallback}</span
  >
{/if}
