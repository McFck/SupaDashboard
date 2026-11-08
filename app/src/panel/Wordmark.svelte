<!-- The app name for a 32 to 40 px title row. Never hit-testable, so the row it sits in stays a drag region. -->
<span
  role="img"
  aria-label="SupaDashboard"
  class="pointer-events-none inline-grid select-none gap-1 leading-none"
>
  <span class="wordmark">SupaDashboard</span>
  <span class="text-[8px] tracking-[0.42em] text-muted-foreground">スーパーダッシュボード</span>
</span>

<style>
  @font-face {
    font-family: 'Plaster';
    font-style: normal;
    font-weight: 400;
    font-display: swap;
    src: url('/fonts/plaster-latin.woff2') format('woff2');
  }

  .wordmark {
    font-family: 'Plaster', var(--font-display);
    font-size: 17px;
    font-weight: 400;
    letter-spacing: 0.025em;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--foreground);
    background: linear-gradient(180deg, #fff0df 0% 46%, #ff7866 46% 62%, #ef4a43 100%);
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  @media (forced-colors: active) {
    .wordmark {
      background: none;
      -webkit-text-fill-color: CanvasText;
    }
  }
</style>
