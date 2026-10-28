export type SortableRect = { start: number; end: number };

export function sortablePosition(
  from: number,
  requestedTranslation: number,
  bounds: readonly SortableRect[],
) {
  if (
    !bounds.length ||
    from < 0 ||
    from >= bounds.length ||
    !Number.isFinite(requestedTranslation)
  ) {
    return { translation: 0, destination: from };
  }
  const source = bounds[from];
  const translation = Math.max(
    bounds[0].start - source.start,
    Math.min(bounds.at(-1)!.end - source.end, requestedTranslation),
  );
  const centers = bounds.map((rect) => (rect.start + rect.end) / 2);
  const destination =
    translation > 0
      ? from +
        centers.filter((center, index) => index > from && center < source.end + translation).length
      : from -
        centers.filter((center, index) => index < from && center > source.start + translation)
          .length;
  return { translation, destination: Math.max(0, Math.min(bounds.length - 1, destination)) };
}
