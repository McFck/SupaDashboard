<script lang="ts">
  let { seconds = false }: { seconds?: boolean } = $props();
  let now = $state(new Date());
  $effect(() => {
    const t = setInterval(() => (now = new Date()), 1000);
    return () => clearInterval(t);
  });
</script>

<time datetime={now.toISOString()}>
  {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: seconds ? '2-digit' : undefined })}
</time>

<style>time { font-variant-numeric: tabular-nums; }</style>
