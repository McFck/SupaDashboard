import { isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'svelte-sonner';

export class DashboardCursor {
  visible = $state(false);
  private contact: { x: number; y: number; time: number } | undefined;
  private unlisten: UnlistenFn | undefined;
  private disposed = false;
  private readonly native = isTauri();

  constructor(private readonly root: HTMLElement) {
    for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      root.addEventListener(name, this.pointer, true);
    }
    root.addEventListener('pointerleave', this.leave);
    if (this.native) {
      void this.listen();
    }
  }

  private pointer = (event: Event) => {
    // Windows owns provenance in the native app; Chromium cannot identify SendInput reliably.
    if (this.native || !(event instanceof PointerEvent)) {
      return;
    }
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      this.contact = { x: event.clientX, y: event.clientY, time: event.timeStamp };
      this.visible = false;
    } else if (event.pointerType === 'mouse' && event.type === 'pointermove') {
      const last = this.contact;
      // Chromium can promote a contact into mouse input at its release point.
      const compatibility =
        last &&
        event.timeStamp - last.time < 1000 &&
        Math.hypot(event.clientX - last.x, event.clientY - last.y) <= 4;
      if (!compatibility) {
        this.visible = true;
      }
    }
  };

  private leave = () => {
    if (!this.native) {
      this.visible = false;
    }
  };

  private async listen() {
    try {
      const unlisten = await listen<unknown>('dashboard-cursor', ({ payload }) => {
        if (!this.disposed && typeof payload === 'boolean') {
          this.visible = payload;
        }
      });
      if (this.disposed) {
        unlisten();
      } else {
        this.unlisten = unlisten;
      }
    } catch (error) {
      console.warn('dashboard cursor listener', error);
      toast.error('Could not track dashboard cursor');
    }
  }

  destroy() {
    this.disposed = true;
    this.unlisten?.();
    for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      this.root.removeEventListener(name, this.pointer, true);
    }
    this.root.removeEventListener('pointerleave', this.leave);
  }
}
