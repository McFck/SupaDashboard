import { writable } from 'svelte/store';
import type { VariableSnapshot } from '../../features/automation/variables';

export type RuntimeSnapshot = {
  online: boolean;
  owner: boolean;
  revision: number;
  activePage: string;
  variables: VariableSnapshot;
  busy: Readonly<Record<string, number>>;
  content: Readonly<Record<string, { slide: number; reload: number }>>;
};
export const EMPTY: RuntimeSnapshot = {
  online: false,
  owner: false,
  revision: 0,
  activePage: 'page-1',
  variables: { revision: 0, records: {} },
  busy: {},
  content: {},
};
export const runtimeView = writable<RuntimeSnapshot>(EMPTY);
