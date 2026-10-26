import { getContext } from 'svelte';
import type { RuntimeCommands } from './commands';

export const RUNTIME_COMMANDS = Symbol('runtime-commands');

export function getRuntimeCommands(): RuntimeCommands {
  const commands = getContext<RuntimeCommands | undefined>(RUNTIME_COMMANDS);
  if (!commands) {
    throw new Error('Runtime commands were not provided');
  }
  return commands;
}
