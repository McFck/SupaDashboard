import type { WidgetCopy } from './widget-insert';
export const clipboard = $state<{ value: WidgetCopy | null }>({ value: null });
