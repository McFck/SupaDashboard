// Display time that only advances while the screen is visible. A new key (a new run phase) restarts it.
export class VisibleClock {
  private key = '';
  private elapsed = 0;
  private startedAt: number | null = null;
  private active = false;

  update(key: string, now: number, active: boolean): number {
    if (!Number.isFinite(now)) throw new Error('Screen clock must be finite');
    if (key !== this.key) {
      this.key = key;
      this.elapsed = 0;
      this.startedAt = active ? now : null;
      this.active = active;
    } else {
      if (this.active && !active && this.startedAt !== null) {
        this.elapsed += Math.max(0, now - this.startedAt);
      }
      if (!this.active && active) {
        this.startedAt = now;
      }
      if (this.active && active && this.startedAt !== null && now < this.startedAt) {
        this.startedAt = now;
      }
      this.active = active;
    }
    return (
      this.elapsed + (active && this.startedAt !== null ? Math.max(0, now - this.startedAt) : 0)
    );
  }
}
