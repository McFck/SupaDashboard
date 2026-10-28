// The dashboard window as display transitions drive it: each step checks that its controller is still live, moves
// the controller makes are marked so their own events are not saved, and placements are validated first.
import type { Window } from '@tauri-apps/api/window';
import { readWindowBounds, setDashboardBounds } from '../../platform/window';
import { sameGeometry, validGeometry } from './geometry';
import type { Geometry } from './geometry';

export class ControlledWindow {
  topmost = false;
  /** Set while the controller itself moves the window, so its own move/resize events are not saved. */
  transition = false;

  constructor(
    readonly win: Window,
    readonly live: () => boolean,
  ) {}

  /** Throws once the controller is disposed, ending the transition that called it. */
  step() {
    if (!this.live()) {
      throw new Error('Dashboard display controller disposed');
    }
  }

  async moving<T>(operation: () => Promise<T>) {
    this.transition = true;
    try {
      return await operation();
    } finally {
      this.transition = false;
    }
  }

  readBounds() {
    return readWindowBounds(this.win);
  }

  async place(bounds: Geometry) {
    if (!validGeometry(bounds)) {
      throw new Error('Refusing invalid dashboard bounds');
    }
    return setDashboardBounds(bounds);
  }

  async placeIfDifferent(desired: Geometry) {
    if (!validGeometry(desired)) {
      throw new Error('Monitor returned invalid dashboard bounds');
    }
    const actual = await this.readBounds();
    return sameGeometry(actual, desired) ? actual : this.place(desired);
  }

  async setTopmost(topmost: boolean) {
    if (this.topmost === topmost) {
      return;
    }
    await this.win.setAlwaysOnTop(topmost);
    this.step();
    this.topmost = topmost;
  }

  /** Best-effort return to `topmost` after a failed transition. */
  async rollbackTopmost(topmost: boolean) {
    if (!this.live() || this.topmost === topmost) {
      return;
    }
    try {
      await this.setTopmost(topmost);
    } catch (rollbackError) {
      console.warn('could not restore dashboard topmost state', rollbackError);
    }
  }
}
