import { describe, expect, it } from 'vitest';
import { uiPlugin } from './ui';
import type { ControlTypeDef, PluginApi } from '../core/registry';

describe('built-in media control defaults', () => {
  it('creates a manual slideshow with wrapping enabled', () => {
    const controls = new Map<string, ControlTypeDef>();
    uiPlugin.setup({
      registerControl: (definition: ControlTypeDef) => controls.set(definition.type, definition),
      registerAction: () => {},
      registerSkin: () => {},
    } as unknown as PluginApi);

    expect(controls.get('media')?.create().options).toEqual({ sources: [], interval: 0, loop: true, muted: true });
  });
});
