export const EFFECTS = [
  { id: 'shake', label: 'Shake', icon: '〰' },
  { id: 'hearts', label: 'Hearts', icon: '♥' },
  { id: 'lightning', label: 'Lightning', icon: 'ϟ' },
  { id: 'sparkles', label: 'Sparkles', icon: '✦' },
  { id: 'confetti', label: 'Confetti', icon: '▰' },
  { id: 'ripple', label: 'Ripple', icon: '◯' },
  { id: 'glow', label: 'Glow pulse', icon: '◉' },
  { id: 'snow', label: 'Snow', icon: '❄' },
  { id: 'fire', label: 'Fire', icon: '♦' },
  { id: 'bubbles', label: 'Bubbles', icon: '○' },
] as const;

export type EffectId = (typeof EFFECTS)[number]['id'];

export function isEffectId(value: unknown): value is EffectId {
  return EFFECTS.some((effect) => effect.id === value);
}
