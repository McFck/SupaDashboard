<script lang="ts">
  import Icon from './Icon.svelte';

  let { icon }: { icon: string } = $props();
</script>

<div class="absolute inset-0 grid place-items-center text-muted-foreground opacity-40">
  <Icon
    name={icon}
    size={32}
  />
</div>
