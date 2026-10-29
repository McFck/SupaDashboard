import type { Option, Param, Plugin, SettingsGroup } from '../../features/plugins/contracts';
import type { AppletStateField } from '../../features/applets/contracts';
import SubwayButton from './ui/SubwayButton.svelte';
import SubwaySlider from './ui/SubwaySlider.svelte';
import SubwayApplet from './ui/SubwayApplet.svelte';
import {
  ANNOUNCEMENT_LANGUAGE_PRESETS,
  DISPLAY_LANGUAGE_PRESETS,
  SUBWAY_DEFAULT_CONFIG,
  SUBWAY_LINE_IDS,
} from './simulation/config';
import {
  registerSubwayMixerChannel,
  SUBWAY_MIX_MUTED_ID,
  SUBWAY_MIX_VOLUME_ID,
} from './audio/audio-volume';
import {
  requestSubwayLine,
  requestSubwayView,
  dispatchSubwayCommand,
  setSubwayImmersion,
  runtime,
} from './simulation/runtime';

const lineTitles: Record<string, string> = {
  yamanote: 'Yamanote',
  hibiya: 'Hibiya',
  sakaisuji: 'Sakaisuji',
};
const directionIds: Record<string, string[]> = {
  yamanote: ['inner', 'outer'],
  hibiya: ['to-kita-senju', 'to-naka-meguro'],
  sakaisuji: ['southbound', 'northbound'],
};
const stationCodes: Record<string, string[]> = {
  yamanote: Array.from({ length: 30 }, (_, index) => `JY${String(index + 1).padStart(2, '0')}`),
  hibiya: Array.from({ length: 22 }, (_, index) => `H${String(index + 1).padStart(2, '0')}`),
  sakaisuji: Array.from({ length: 10 }, (_, index) => `K${String(index + 11).padStart(2, '0')}`),
};
const lineOptions: Option[] = [
  { value: '', label: 'Next line' },
  ...SUBWAY_LINE_IDS.map((value) => ({ value, label: lineTitles[value] })),
];
const directionTitles: Record<string, string> = {
  inner: 'Inner loop',
  outer: 'Outer loop',
  'to-kita-senju': 'To Kita-senju',
  'to-naka-meguro': 'To Naka-meguro',
  southbound: 'Southbound',
  northbound: 'Northbound',
};
const directionOptions = (line?: string): Option[] => [
  { value: '', label: 'Automatic' },
  ...(directionIds[line ?? ''] ?? Object.values(directionIds).flat()).map((value) => ({
    value,
    label: directionTitles[value] ?? value,
  })),
];
const stationOptions = (line?: string): Option[] =>
  [
    { value: '', label: 'Default start' },
    (stationCodes[line ?? ''] ?? Object.values(stationCodes).flat()).map((value) => ({
      value,
      label: value,
    })),
  ].flat();
const displayOptions = (line?: string): Option[] => {
  const values =
    line === 'sakaisuji'
      ? ['ja-kana']
      : line === 'hibiya'
        ? ['ja-en', 'ja-zh', 'ja-ko']
        : line === 'yamanote'
          ? ['ja-en']
          : DISPLAY_LANGUAGE_PRESETS;
  const titles: Record<string, string> = {
    'ja-en': 'Japanese / English',
    'ja-kana': 'Japanese / kana',
    'ja-zh': 'Japanese / Chinese',
    'ja-ko': 'Japanese / Korean',
  };
  return values.map((value) => ({ value, label: titles[value] }));
};
const announcementOptions: Option[] = ANNOUNCEMENT_LANGUAGE_PRESETS.map((value) => ({
  value,
  label: value === 'ja-en' ? 'Japanese / English' : value === 'ja' ? 'Japanese' : 'English',
}));
const lineParam: Param = {
  key: 'line',
  label: 'Line',
  type: 'select',
  default: '',
  suggestions: lineOptions,
};
const directionParam: Param = {
  key: 'direction',
  label: 'Direction',
  type: 'select',
  default: '',
  suggestions: (args) => directionOptions(args?.line as string | undefined),
};
const startStationParam: Param = {
  key: 'startStation',
  label: 'Start station',
  type: 'select',
  default: '',
  suggestions: (args) => stationOptions(args?.line as string | undefined),
};

const settings: SettingsGroup[] = [
  {
    id: 'route',
    title: 'Route',
    params: [
      {
        key: 'line',
        label: 'Line',
        type: 'select',
        default: SUBWAY_DEFAULT_CONFIG.line,
        suggestions: SUBWAY_LINE_IDS.map((value) => ({ value, label: lineTitles[value] })),
      },
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        default: SUBWAY_DEFAULT_CONFIG.direction,
        suggestions: (args) =>
          directionOptions(args?.line as string | undefined).filter((option) => option.value),
      },
      {
        key: 'startStation',
        label: 'Start station',
        type: 'select',
        default: SUBWAY_DEFAULT_CONFIG.startStation,
        suggestions: (args) =>
          stationOptions(args?.line as string | undefined).filter((option) => option.value),
      },
      {
        key: 'carNumber',
        label: 'Car number',
        type: 'select',
        default: '1',
        suggestions: (args) =>
          Array.from(
            { length: args?.line === 'hibiya' ? 7 : args?.line === 'sakaisuji' ? 8 : 11 },
            (_, index) => ({ value: String(index + 1), label: String(index + 1) }),
          ),
      },
      {
        key: 'speed',
        label: 'Run speed',
        type: 'select',
        default: '1',
        suggestions: [0.5, 1, 2].map((value) => ({ value: String(value), label: `${value}×` })),
      },
    ],
  },
  {
    id: 'languages',
    title: 'Languages',
    params: [
      {
        key: 'displayLanguages',
        label: 'Display',
        type: 'select',
        default: SUBWAY_DEFAULT_CONFIG.displayLanguages,
        suggestions: (args) => displayOptions(args?.line as string | undefined),
      },
      {
        key: 'announcementLanguages',
        label: 'Announcements',
        type: 'select',
        default: SUBWAY_DEFAULT_CONFIG.announcementLanguages,
        suggestions: announcementOptions,
      },
    ],
  },
  {
    id: 'sound',
    title: 'Sound',
    params: [
      {
        key: 'immersion',
        label: 'Immersion',
        type: 'boolean',
        default: SUBWAY_DEFAULT_CONFIG.immersion,
      },
      {
        key: 'announcementVolume',
        label: 'Announcement volume',
        type: 'number',
        default: SUBWAY_DEFAULT_CONFIG.announcementVolume,
        min: 0,
        max: 1,
        step: 0.05,
      },
    ],
  },
];

const state: AppletStateField[] = [
  { key: 'station', type: 'string', initialValue: 'JY01' },
  { key: 'next', type: 'string', initialValue: 'JY02' },
  { key: 'state', type: 'string', initialValue: 'stopped' },
  { key: 'line', type: 'string', initialValue: 'yamanote' },
  { key: 'direction', type: 'string', initialValue: 'inner' },
  { key: 'doorSide', type: 'string', initialValue: 'unknown' },
  { key: 'speed', type: 'float', initialValue: 0 },
  { key: 'progress', type: 'float', initialValue: 0 },
  { key: 'paused', type: 'boolean', initialValue: true },
  { key: 'immersion', type: 'boolean', initialValue: false },
  { key: 'audioReady', type: 'boolean', initialValue: false },
];

export const subwayPlugin: Plugin = {
  id: 'subway',
  title: 'Subway',
  description: 'Japanese passenger-information displays with a compact control strip.',
  icon: 'TrainFront',
  author: 'SupaDashboard',
  version: '1.0.0',
  updated: '2026-10-24',
  source: 'bundled',
  size: 1618,
  setup(api) {
    api.registerVariable({
      id: SUBWAY_MIX_VOLUME_ID,
      name: 'Subway mixer volume',
      type: 'float',
      initialValue: 1,
      persistent: true,
      readOnly: false,
    });
    api.registerVariable({
      id: SUBWAY_MIX_MUTED_ID,
      name: 'Subway mixer muted',
      type: 'boolean',
      initialValue: false,
      persistent: true,
      readOnly: false,
    });
    registerSubwayMixerChannel(api);
    api.registerAction({
      id: 'subway.line',
      title: 'Change Subway line',
      params: [lineParam, directionParam, startStationParam],
      run: (args, context) =>
        context?.signal.aborted
          ? false
          : requestSubwayLine(
              { line: args.line, direction: args.direction, startStation: args.startStation },
              context?.eventAncestry,
            ),
    });
    api.registerAction({
      id: 'subway.emergency',
      title: 'Subway emergency stop',
      run: (_args, context) =>
        context?.signal.aborted
          ? false
          : dispatchSubwayCommand({ type: 'emergency' }, context?.eventAncestry),
    });
    api.registerAction({
      id: 'subway.immersion',
      title: 'Toggle Subway immersion',
      run: (args, context) => {
        if (context?.signal.aborted) return false;
        return setSubwayImmersion(
          typeof args.enabled === 'boolean' ? args.enabled : undefined,
          context?.eventAncestry,
        );
      },
    });
    api.registerAction({
      id: 'subway.resume',
      title: 'Resume Subway service',
      run: (_args, context) =>
        context?.signal.aborted
          ? false
          : dispatchSubwayCommand({ type: 'resume-service' }, context?.eventAncestry),
    });
    api.registerAction({
      id: 'subway.suspend',
      title: 'Suspend Subway service',
      params: [{ key: 'enabled', label: 'Suspended', type: 'boolean', default: true }],
      run: (args, context) =>
        context?.signal.aborted
          ? false
          : dispatchSubwayCommand(
              args.enabled === false ? { type: 'resume-service' } : { type: 'suspend' },
              context?.eventAncestry,
            ),
    });
    api.registerAction({
      id: 'subway.view',
      title: 'Change Subway view',
      params: [
        {
          key: 'view',
          label: 'View',
          type: 'select',
          default: 'display',
          suggestions: [
            { value: 'display', label: 'Display' },
            { value: 'map', label: 'Map' },
            { value: 'cab', label: 'Run' },
          ],
        },
      ],
      run: (args, context) =>
        context?.signal.aborted
          ? false
          : requestSubwayView(String(args.view ?? 'display'), context?.eventAncestry),
    });

    api.registerApplet({
      id: 'subway',
      title: 'Subway',
      component: SubwayApplet,
      start: runtime,
      pageNavigation: 'applet',
      design: { width: 1920, height: 480 },
      slots: [
        {
          id: 'strip',
          kind: 'strip',
          accepts: ['button', 'slider'],
          max: 8,
          grid: { rows: 1, cols: 8, size: 112, gap: 8, sizing: 'auto' },
        },
        {
          id: 'side',
          kind: 'grid',
          accepts: ['button'],
          max: 2,
          grid: { rows: 2, cols: 1, size: 112, gap: 8, sizing: 'auto' },
        },
      ],
      views: [
        { id: 'display', title: 'Display', slots: ['strip'] },
        { id: 'map', title: 'Map', slots: ['strip'] },
        { id: 'cab', title: 'Run', slots: ['strip', 'side'] },
      ],
      defaultView: 'display',
      settings,
      quickActions: [
        { id: 'subway.line', args: { line: '', direction: '', startStation: '' } },
        { id: 'subway.emergency' },
        { id: 'subway.immersion' },
        { id: 'subway.resume' },
      ],
      controlFaces: { button: { component: SubwayButton }, slider: { component: SubwaySlider } },
      state,
      events: [
        { id: 'subway.departed', title: 'Train departed', parameterSuggestions: () => [] },
        { id: 'subway.arrived', title: 'Train arrived', parameterSuggestions: () => [] },
        { id: 'subway.stateChanged', title: 'Run state changed', parameterSuggestions: () => [] },
        { id: 'subway.emergency', title: 'Emergency stop' },
        { id: 'subway.suspended', title: 'Service suspended' },
      ],
    });
  },
};
