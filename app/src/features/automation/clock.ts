import type { VariableStore } from './variables';

export function startClock(variables: VariableStore) {
  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const date = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
  const update = () => {
    const now = new Date();
    const values: Record<string, string> = {
      'clock.time': time.format(now),
      'clock.date': date.format(now),
      'clock.day': day.format(now),
    };
    for (const [id, value] of Object.entries(values)) {
      if (variables.getValue(id) !== undefined && variables.getValue(id) !== value) {
        variables.set(id, value, 'core');
      }
    }
  };
  update();
  const timer = setInterval(update, 1000);
  return () => clearInterval(timer);
}
