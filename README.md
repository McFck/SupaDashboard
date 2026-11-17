# SupaDashboard

A customizable second-screen dashboard for Windows, built with Tauri 2 and Svelte 5. Widgets run actions,
switch states with gestures, control media and per-app volume, and show media or web content. Applets change
a page's whole look; the Subway applet from the Market recreates Japanese train information screens.

## Repository

| Path                    | Contents                                                |
| ----------------------- | ------------------------------------------------------- |
| [`app/`](app/README.md) | The application: Svelte frontend and Tauri/Rust backend |

## Quick start

```powershell
cd app
pnpm install
pnpm tauri dev
```

## License

The software is licensed under the [GNU General Public License v3.0 or later](LICENSE): anyone may use, study,
change and share it, provided that what they distribute stays free under the same terms.
