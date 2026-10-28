import { runtimeView } from '../../app/runtime/state';
import type { VariableRecord } from './variables';

/** Keep each value reactive independently so unrelated ticks do not invalidate control bindings. */
export const runtimeVariables = $state({
  revision: 0,
  records: {} as Record<string, VariableRecord>,
});

runtimeView.subscribe(({ variables }) => {
  for (const id of Object.keys(runtimeVariables.records)) {
    if (!Object.hasOwn(variables.records, id)) {
      delete runtimeVariables.records[id];
    }
  }
  for (const [id, record] of Object.entries(variables.records)) {
    const previous = runtimeVariables.records[id];
    if (!previous) {
      runtimeVariables.records[id] = structuredClone(record);
      continue;
    }
    if (previous.value !== record.value) {
      previous.value = record.value;
    }
    if (JSON.stringify(previous.definition) !== JSON.stringify(record.definition)) {
      previous.definition = structuredClone(record.definition);
    }
  }
  runtimeVariables.revision = variables.revision;
});
