import { ImageSet } from '../../rendering/engine/image-set';

const E235_TRIMMED = new Set([
  'UpStairs',
  'UpStairs_small',
  'DownStairs',
  'UpEscalator',
  'DownEscalator',
  'Elevator',
]);
export const e235Images = new ImageSet(
  Object.fromEntries(
    [...E235_TRIMMED, 'PrioritySeat', 'MobilePhone'].map((name) => [
      name,
      `${import.meta.env.BASE_URL}subway/e235/${name}.svg`,
    ]),
  ),
  (name) => E235_TRIMMED.has(name),
);
