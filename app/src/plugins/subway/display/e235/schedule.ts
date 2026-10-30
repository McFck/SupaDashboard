import type { RunSnapshot } from '../../simulation/run';
import type { ScreenLanguage, ScreenPage } from '../../rendering/screens';
import { e235Data as data, e235TrainStop } from './data';

const pages: Record<string, ScreenPage> = {
  RouteMap: 'broad',
  DetailedRouteMap: 'nearby',
  Door: 'door',
  Platform: 'platform',
  Transfers: 'transfers',
  Alert: 'notice',
  PrioritySeat: 'priority',
  MobilePhone: 'mobile',
};
const locale = (value: string | null): ScreenLanguage =>
  value === 'English' ? 'en' : value === 'Hiragana' ? 'kana' : 'ja';
function routineStep(
  steps: { duration: number | null; language: string | null; mode: string | null }[],
  elapsed: number,
) {
  const period = steps.reduce((sum, s) => sum + (s.duration ?? 0) * 1000, 0);
  let position = elapsed % period;
  for (const step of steps) {
    const duration = (step.duration ?? 0) * 1000;
    if (position < duration) return { ...step, deadline: elapsed + duration - position };
    position -= duration;
  }
  throw new Error('Empty E235 display routine');
}

export function e235Routine(
  snapshot: RunSnapshot,
  elapsed: number,
  viewingSide: 'left' | 'right',
  languages: readonly ScreenLanguage[],
  offset = 0,
) {
  const code = ['stopped', 'doorsClosing', 'arriving'].includes(snapshot.state)
    ? snapshot.station
    : snapshot.next || snapshot.station;
  const stop = e235TrainStop(
    code,
    snapshot.direction,
    snapshot.initialStop ? 'initial' : 'regular',
  );
  const stage: { Duration: number; Main?: number; Right?: number; Left?: number } | null =
    snapshot.state === 'stopped' || snapshot.state === 'doorsClosing'
      ? stop.stopping
      : snapshot.state === 'approaching' || snapshot.state === 'arriving'
        ? stop.arriving
        : snapshot.state === 'departing' && stop.departing && stop.departing.Duration > 0
          ? stop.departing
          : stop.running;
  const index = stage?.[viewingSide === 'right' ? 'Right' : 'Left'] ?? 0;
  const steps = data.optionalAreaRoutines[index]!.steps;
  const period = steps.reduce((sum, step) => sum + (step.duration ?? 0) * 1000, 0);
  const running = snapshot.state === 'departing' || snapshot.state === 'cruising';
  const budget = snapshot.screenRunDurationMs;
  const scale = running && budget && budget > 0 ? Math.min(1, budget / period) : 1;
  const body = routineStep(steps, elapsed / scale);
  const main = routineStep(data.mainAreaRoutines[stage?.Main ?? 0]!.steps, elapsed);
  const requested = (value: string | null, header = false) => {
    const lang = locale(value);
    if (header && lang === 'kana' && languages.length > 1 && languages.includes('ja')) return lang;
    const allowed = languages.includes(lang) ? lang : (languages[0] ?? 'ja');
    return (
      languages[(languages.indexOf(allowed) + offset + languages.length) % languages.length] ??
      allowed
    );
  };
  return {
    page: pages[body.mode!]!,
    language: requested(body.language),
    headerLanguage: requested(main.language, true),
    pageDeadline: body.deadline * scale,
    languageDeadline: main.deadline,
  };
}
