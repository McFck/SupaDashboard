import { isRecord } from '../automation/plain-data';

export type WindowSelection = { windows: 'main' | 'all' | 'window' | 'title'; title: string };

export function readWindowSelection(raw: unknown): WindowSelection | undefined {
  if (
    !isRecord(raw) ||
    typeof raw.title !== 'string' ||
    new TextEncoder().encode(raw.title).length > 1024 ||
    /[\u0000-\u001f\u007f-\u009f]/.test(raw.title)
  ) {
    return undefined;
  }
  const windows = raw.windows;
  if (windows !== 'main' && windows !== 'all' && windows !== 'window' && windows !== 'title') {
    return undefined;
  }
  return { windows, title: raw.title };
}
