# SupaDashboard app

Tauri 2 (Rust) + Svelte 5 + TypeScript + shadcn-svelte. A customizable dashboard for a second screen
(e.g. a spacedesk tablet). Skins change the whole look; the subway display is one optional skin.

```
pnpm install
pnpm tauri dev      # run the app
pnpm test           # logic tests;  cd src-tauri && cargo test  (read-only audio checks)
pnpm tauri build    # installer in src-tauri/target/release/bundle
```

## Windows

- **Dashboard** (`main`): transparent and frameless, only the widgets are drawn. Closing hides it to the tray.
- **Control panel** (`panel`): opened from the tray icon (left click or menu). Layout editor, strips, skin & display,
  plugins. Every change is written to the shared settings store and appears on the dashboard instantly.
- **Tray menu**: open control panel, show / hide dashboard, quit.

One frontend bundle serves both; `src/main.ts` picks the view from the window label (`?view=panel` in a plain browser).

## Layout editor

Centre: the selected skin at scale. Deck keeps its grid editor: tap a widget to select it, drag it to move, drag the
corner handle to resize, and tap an empty spot to add a widget or place an existing control. For other skins, the
editor shows that skin's frozen scene and its visible slots as drop zones. Page tabs select stored layouts; the local
skin view preview does not change the dashboard's active page or view.

Placements are stored per skin and page. Deck's `main` slot uses the existing `deck.pages[pageId].items` array;
other skin slots use `skinLayouts[skinId][pageId][slotId]`. Slot rules filter widget kinds and sizes before adding or
moving a placement. Widgets keep the shared control behavior, with optional skin-specific face renderers.

### Skins

Plugins can register skin views, slots, control faces, settings, owner-scoped state and events, quick actions, and page
navigation. Swipe is the default page navigation; a skin can own it and use the host's `page.prev()` and
`page.next()` methods for its own controls. The dashboard remains a non-activating surface; native foreground and
hide/resume behavior needs an isolated Tauri check and is not established by browser validation.

## Pieces

| Piece | Where | What it is |
|---|---|---|
| Widgets | `src/controls/` | `button`, `slider` (pill; tall = vertical), `mixer` (several pills: master + apps) |
| Layout | `src/core/layout.ts` | deck items with x/y/w/h, collision, drop/swap (tested) |
| Actions | `src/core/registry.ts` | named commands with args; core includes media/volume, `page.next`/`page.prev`/`page.goto`, `button.off`/`button.on`/`button.toggle`/`button.variant`, `variable.set`/`variable.toggle`/`variable.increment`, `event.emit`, `open`, `delay`, and `sequence` |
| Media sources | same | where media commands go: core `system` (current Windows player); plugins add more |
| Values | same | what a slider controls: `volume {target: "system" \| process name}` |
| Plugins | `src/plugins/` | `core`, `ui` (built-in widgets + skins), `spotify` (media source, icon, mixer icon, `spotify.open`) |
| Native | `src-tauri/src/` | `media.rs` (Windows media sessions), `volume.rs` (master + per-app volume, mute, mixer list), tray + windows in `lib.rs` |

Deck settings: `%APPDATA%\dev.supadashboard.app\settings.json` (version 5; older versions migrate on load). Pages share controls and scenario definitions; page selection is runtime state for the current dashboard launch. Persistent variables are stored separately in `variables.json`.

### Pages

The layout editor supports up to ten named pages, each with its own grid density and widget placements. Add, rename,
duplicate, reorder, move widgets between pages, and undo page edits from the page tabs. The dashboard changes pages
through empty-gap swipes, the bottom dots, `page.next`/`page.prev`/`page.goto` actions, or optional auto-rotation.
Navigation is owned by the dashboard runtime and resets to the first page on a fresh launch.

### Media and Web widgets
Media widgets show URL or picked image, GIF, and video sources. Fit, mute, loop, and auto-advance interval are
per-widget settings; interval `0` disables auto-advance. The `media.next`, `media.prev`, and `media.goto` actions
can target this widget or another placed Media widget across pages. Picked files keep their selected paths and
individual asset grants; deleting or moving a file can make that slide unavailable.

Web widgets accept HTTPS URLs and HTTP URLs whose host is exactly `localhost`. They block credentials, application
and asset origins, and other HTTP hosts. Zoom ranges from 50% to 200%; refresh `0` disables refresh. Interactive is
off by default, so tile gestures remain available; turn it on to use the embedded page. The iframe keeps its
scripts, forms, and popups sandboxed and does not allow top-level navigation. `web.reload` can target this or another
placed Web widget. Failed or blocked frames show `Unavailable`; page-hidden refresh timers pause.

### Subway skin
The Subway skin displays the Yamanote, Hibiya, and Sakaisuji line information screens, a route overview, and a
deterministic simulated run. Immersion audio uses the bundled motion profiles and compatible sound-pack cues; it
creates audio only in the visible dashboard owner. The shared mixer exposes it as **Subway**, independently of
Windows app channels. Mixer gain and mute persist as `subway.mixVolume` and `subway.mixMuted`; the skin's
announcement-volume setting affects voice cues only. The Sakaisuji motion profile is generic Osaka Metro sound,
not a Hankyu recording. See [Subway assets](docs/subway-assets.md) for the content and timing limits.

### Gestures
Buttons have separate ordered scenarios for Press, Release, Long press, Long press release, Double tap, Pull up,
Pull down, Pull left, Pull right, and filtered Events. A short tap runs Press followed by Release. A held pointer
runs Long press when the hold threshold is reached and Long press release on pointer-up. Slider value-axis input
remains reserved for the slider; only cross-axis pulls enter its scenario runner. A pull commits only on release
after it arms.

### Scenarios, views, and variables
Select a button and choose **Edit scenario** to edit each trigger in one draft. Lists can contain registered actions,
Wait steps, and nested If/Else branches. Each trigger may also have a state-specific override. Save commits the draft
as one settings change; Cancel discards it. Existing legacy action bindings migrate into editable scenario steps.

The Views tab edits each variant's label, icon, text/icon colour, and background, with preview faces rendered by the
dashboard's button renderer. Optional Off/On roles can bind a Boolean, integer, float, or text variable to state IDs;
the existing manual variant selection remains the fallback. Labels interpolate bounded `{variable}` tokens, and
double braces escape a literal brace. If/Else conditions support variable and button-state checks and bounded
Boolean/comparison expressions; they do not run JavaScript or Cottle.

The Variables panel manages typed user values and persistence. Core also publishes read-only `clock.time`,
`clock.date`, and `clock.day`; `variables.changed` is available to scenario listeners. Variables are authoritative in
the dashboard runtime. The panel requests changes from that owner, including when it is a separate webview.

### Writing a plugin
```ts
export const myPlugin: Plugin = { id: 'my', title: 'My plugin', setup(api) {
  api.registerMediaSource({ id: 'foobar', title: 'foobar2000', command: c => invoke('media_command', { target: 'foobar', command: c }) });
  api.registerAction({ id: 'my.hello', title: 'Hello', params: [{ key: 'who', label: 'Who', type: 'text' }], run: a => console.log(a.who) });
  api.registerAppIcon('foobar2000', 'Music');
} };
```
Add it to `install(...)` in `src/main.ts`. Declared `params` give the action an editor form automatically.
Actions receive an `ActionContext` with the control/item, trigger, abort signal, state and variable access, and event
emission. Plugins may also register typed variables and events, provide parameter suggestions, and mark an action's
variable argument as bindable. Loading plugins from a folder at runtime comes later.
