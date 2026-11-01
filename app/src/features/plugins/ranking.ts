import type { Option } from './contracts';

/** Lower is closer: exact, prefix, word prefix, substring, then letters in order. */
function tier(text: string, query: string) {
  if (text === query) {
    return 0;
  }
  if (text.startsWith(query)) {
    return 1;
  }
  if (text.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(query))) {
    return 2;
  }
  if (text.includes(query)) {
    return 3;
  }
  let at = 0;
  for (const letter of query) {
    at = text.indexOf(letter, at) + 1;
    if (!at) {
      return Infinity;
    }
  }
  return 4;
}

/** Options that match the query, closest first; equal matches keep their order. Empty query keeps all. */
export function rankOptions(options: readonly Option[], query: string): Option[] {
  const search = query.trim().toLocaleLowerCase();
  if (!search) {
    return [...options];
  }
  return options
    .map((option, index) => ({
      option,
      index,
      score: Math.min(
        tier(option.label.toLocaleLowerCase(), search),
        tier(option.value.toLocaleLowerCase(), search) + 0.5,
      ),
    }))
    .filter((entry) => entry.score < Infinity)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.option);
}
