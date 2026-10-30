import type { ScreenSchedule } from '../../rendering/screens';
import { e235TrainStop } from './data';

export function target(model: ScreenSchedule) {
  return ['stopped', 'doorsClosing', 'arriving'].includes(model.snapshot.state)
    ? model.station.code
    : (model.nextStation?.code ?? model.station.code);
}

export function stopFor(model: ScreenSchedule) {
  return e235TrainStop(
    target(model),
    model.snapshot.direction,
    model.snapshot.initialStop ? 'initial' : 'regular',
  );
}

export function thisSide(model: ScreenSchedule) {
  return stopFor(model).door?.toLowerCase() === (model.viewingSide ?? 'right');
}
