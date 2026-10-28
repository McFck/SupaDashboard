<script lang="ts">
  // Volume mixer widget: one pill per channel. Channels are the master volume plus every app currently
  // playing audio ("auto"), or a fixed list chosen in the editor. Tap a channel's icon to mute it.
  import { toast } from 'svelte-sonner';
  import { mixerLayout } from '../geometry';
  import { DEFAULT_MIXER_MAX_CHANNELS, type ControlConfig } from '../model';
  import { findVolumeChannel, setMuted, setVolume, volumeChannels } from '../../media/volume';
  import { appIcons } from '../../plugins/registry';
  import { settings } from '../../settings/state.svelte';
  import PressFeedback from './PressFeedback.svelte';
  import SliderTrack from './SliderTrack.svelte';

  type Fixed = { target: string; label?: string; icon?: string };
  let {
    control,
    pixelWidth,
    pixelHeight,
    pressFeedbackDisabled = false,
  }: {
    control: ControlConfig;
    pixelWidth: number;
    pixelHeight: number;
    pressFeedbackDisabled?: boolean;
  } = $props();
  let feedback = $state<PressFeedback>();
  const options = $derived(
    (control.options ?? {}) as {
      channels?: 'auto' | Fixed[];
      max?: number;
      layout?: 'auto' | 'vertical' | 'horizontal';
    },
  );
  const variant = $derived(
    control.variants[settings.variants[control.id] ?? 0] ?? control.variants[0],
  );
  const accent = $derived(variant?.color ?? '#b5a0e8');

  const title = (t: string) => (t === 'system' ? 'System' : t.charAt(0).toUpperCase() + t.slice(1));
  const channels = $derived.by(() => {
    const list: Fixed[] =
      options.channels === 'auto' || !options.channels
        ? $volumeChannels.map((c) => ({ target: c.target }))
        : options.channels;
    return list.slice(0, options.max ?? DEFAULT_MIXER_MAX_CHANNELS).map((f) => {
      const c = findVolumeChannel($volumeChannels, f.target);
      return {
        ...f,
        label: f.label ?? c?.label ?? title(f.target),
        icon: f.icon || c?.icon || (f.target === 'system' ? 'Volume2' : appIcons.get(f.target)),
        volume: c?.volume ?? null,
        muted: c?.muted ?? false,
      };
    });
  });
  const vertical = $derived(
    (options.layout === 'auto' || !options.layout
      ? mixerLayout(
          pixelWidth,
          pixelHeight,
          channels.length,
        )
      : options.layout) === 'vertical',
  );

  function set(target: string, v: number) {
    void setVolume(target, v).catch((error) =>
      toast.error(`${control.name}: ${error?.message ?? error}`),
    );
  }
  function mute(target: string) {
    const c = findVolumeChannel($volumeChannels, target);
    if (!c) return;
    void setMuted(target, !c.muted).catch((error) =>
      toast.error(`${control.name}: ${error?.message ?? error}`),
    );
  }
</script>

<div
  data-dashboard-tile
  style:--accent={accent}
  class="relative h-full w-full"
>
  <PressFeedback
    bind:this={feedback}
    disabled={pressFeedbackDisabled}
    class="tile flex h-full w-full p-3"
  >
    {#snippet children()}
      {#if !channels.length}
        <div
          data-dashboard-tile
          class="widget-content grid flex-1 place-items-center text-xs text-zinc-500"
        >
          No audio playing
        </div>
      {:else}
        <div
          data-dashboard-tile
          class="widget-content flex min-h-0 min-w-0 flex-1 gap-2.5 {vertical ? '' : 'flex-col'}"
        >
          {#each channels as ch (ch.target)}
            <div
              data-dashboard-tile
              class="min-h-0 min-w-0 flex-1"
            >
              <SliderTrack
                {vertical}
                level={ch.volume}
                muted={ch.muted}
                sourceKey={ch.target}
                {accent}
                icon={ch.icon}
                label={ch.label}
                onchange={(v) => set(ch.target, v)}
                onmute={() => mute(ch.target)}
                {feedback}
              />
            </div>
          {/each}
        </div>
      {/if}
    {/snippet}
  </PressFeedback>
</div>
