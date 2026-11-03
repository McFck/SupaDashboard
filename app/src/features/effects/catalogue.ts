// `tint` is the one muted accent each effect's visual and picker icon share.
export const EFFECTS = [
  { id: 'shake', label: 'Shake', tint: '#cdc8dc' },
  { id: 'hearts', label: 'Hearts', tint: '#e9bcc5' },
  { id: 'lightning', label: 'Lightning', tint: '#cfe0ff' },
  { id: 'sparkles', label: 'Sparkles', tint: '#f2e6c8' },
  { id: 'confetti', label: 'Confetti', tint: '#e8dccb' },
  { id: 'ripple', label: 'Ripple', tint: '#c3dce6' },
  { id: 'glow', label: 'Glow pulse', tint: '#f1ddb8' },
  { id: 'snow', label: 'Snow', tint: '#e2ecf3' },
  { id: 'fire', label: 'Fire', tint: '#f0ae86' },
  { id: 'bubbles', label: 'Bubbles', tint: '#c0d7ea' },
] as const;

export type EffectId = (typeof EFFECTS)[number]['id'];

export function isEffectId(value: unknown): value is EffectId {
  return EFFECTS.some((effect) => effect.id === value);
}

export function effectTint(effect: EffectId) {
  return EFFECTS.find((entry) => entry.id === effect)?.tint ?? '#e5e7eb';
}
