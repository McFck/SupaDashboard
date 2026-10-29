/** Tracks the section at the panel's reading edge, including the final section at the bottom. */
export class SettingsIndexController {
  active = $state('');
  private readonly root: HTMLElement;
  private readonly sections: HTMLElement[];
  private readonly resize: ResizeObserver;

  constructor(
    private readonly nav: HTMLElement,
    ids: string[],
  ) {
    this.root = nav.closest<HTMLElement>('.overflow-y-auto') ?? document.documentElement;
    this.sections = ids.flatMap((id) => {
      const section = document.getElementById(id);
      return section ? [section] : [];
    });
    this.root.addEventListener('scroll', this.update, { passive: true });
    this.resize = new ResizeObserver(this.update);
    this.resize.observe(nav);
    this.resize.observe(this.root);
    this.update();
  }

  private update = () => {
    const horizontal = getComputedStyle(this.nav).flexDirection === 'row';
    const edge = horizontal
      ? this.nav.getBoundingClientRect().bottom + 16
      : this.root.getBoundingClientRect().top + 48;
    let current: HTMLElement | undefined = this.sections[0];
    for (const section of this.sections) {
      if (section.getBoundingClientRect().top <= edge) {
        current = section;
      }
    }
    if (
      this.root.scrollTop > 0 &&
      this.root.scrollTop + this.root.clientHeight >= this.root.scrollHeight - 1
    ) {
      current = this.sections.at(-1);
    }
    this.active = current?.id ?? '';
  };

  destroy() {
    this.root.removeEventListener('scroll', this.update);
    this.resize.disconnect();
  }
}
