import type { Component } from 'svelte';
import type { ControlFaceProps } from '../controls/model';
import type { SkinDef } from './contracts';

export function skinFaceFor(
  skin: SkinDef,
  typeId: string,
  defaultFace?: Component<ControlFaceProps>,
) {
  if (!defaultFace) return undefined;
  return skin.controlSkins?.[typeId]?.component ?? defaultFace;
}
