import type { WidgetCopy } from './layout-actions';
export const clipboard = $state<{ value: WidgetCopy | null }>({ value: null });
