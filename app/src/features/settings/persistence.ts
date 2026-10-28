/** Serialize writes and retain the latest unsaved snapshot after a failed write. */
export class SettingsPersistence {
  saved: string;
  private pending: string;
  private writing?: Promise<void>;

  constructor(
    private write: (json: string) => Promise<void>,
    initial = '',
  ) {
    this.saved = initial;
    this.pending = initial;
  }

  save(json: string): Promise<void> {
    this.pending = json;
    if (!this.writing) {
      this.writing = this.flush().finally(() => {
        this.writing = undefined;
      });
    }
    return this.writing;
  }

  private async flush() {
    while (this.pending !== this.saved) {
      const json = this.pending;
      await this.write(json);
      this.saved = json;
    }
  }
}
