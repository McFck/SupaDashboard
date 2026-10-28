import { isRecord, object } from './validation';

export function savedControls(raw: unknown): (Record<string, unknown> & {
  id: string;
  name: string;
  type: string;
  variants: Record<string, unknown>[];
  gestures: Record<string, unknown>;
})[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new Error('Settings controls must be an array');
  }
  return raw.map((value: unknown) => {
    const control = object(value);
    if (typeof control.id !== 'string' || !control.id || typeof control.type !== 'string') {
      throw new Error('Settings contain a malformed control');
    }
    if (control.name !== undefined && typeof control.name !== 'string') {
      throw new Error('Control name must be text');
    }
    if (control.variants !== undefined && !Array.isArray(control.variants)) {
      throw new Error('Control variants must be an array');
    }
    if (control.options !== undefined) {
      object(control.options);
    }
    if (control.stateBinding !== undefined && control.stateBinding !== null) {
      const binding = object(control.stateBinding);
      if (
        typeof binding.variableId !== 'string' ||
        !Array.isArray(binding.cases) ||
        !binding.cases.every(
          (entry: unknown) =>
            isRecord(entry) &&
            typeof entry.stateId === 'string' &&
            (typeof entry.value === 'string' ||
              typeof entry.value === 'boolean' ||
              (typeof entry.value === 'number' && Number.isFinite(entry.value))),
        )
      ) {
        throw new Error('Settings contain a malformed state binding');
      }
    }
    const variants: Record<string, unknown>[] = (control.variants ?? []).map((variant: unknown) => {
      if (
        !isRecord(variant) ||
        (variant.label !== undefined && typeof variant.label !== 'string')
      ) {
        throw new Error('Settings contain a malformed variant');
      }
      for (const field of ['icon', 'color', 'background']) {
        if (variant[field] != null && typeof variant[field] !== 'string') {
          throw new Error(`Variant ${field} must be text`);
        }
      }
      return { ...variant, label: variant.label ?? '' };
    });
    return {
      ...control,
      id: control.id,
      name: control.name ?? control.id,
      type: control.type,
      variants,
      gestures: object(control.gestures),
    };
  });
}
