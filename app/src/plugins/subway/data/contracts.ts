export interface CatalogueDirection {
  id: string;
  delta: 1 | -1;
  title: string;
  /** Terminus station code; the Japanese direction label names it. Absent on loops. */
  target?: string;
}

export interface LineFacts {
  id: string;
  title: string;
  code: string;
  carCount: number;
  loop: boolean;
  /** Display presets the line supports; the first one is the default. */
  displayLanguages: readonly string[];
  directions: readonly CatalogueDirection[];
  stations: readonly string[];
}
