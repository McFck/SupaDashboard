export function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  }
  return value;
}

/** Copies plain objects and arrays, including Svelte state proxies, which structuredClone rejects. */
export function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clonePlain(item)) as T;
  if (value && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>))
      copy[key] = clonePlain(child);
    return copy as T;
  }
  return value;
}
