# SupaDashboard

A customizable second-screen dashboard for Windows, built with Tauri 2 and Svelte 5. Widgets run actions,
switch states with gestures, control media and per-app volume, and show media or web content. Skins change
the whole look; the optional Subway skin recreates Japanese train information screens with its own sound pack.

## Repository

| Path                          | Contents                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| [`app/`](app/README.md)       | The application: Svelte frontend, Tauri/Rust backend, tests and browser checks              |
| [`assets/`](assets/README.md) | Subway sound pack: line manifests, audio clips, motion data and source credits             |
| [`tools/`](tools/README.md)   | Building and validating the sound pack, and preparing recordings from the archive          |

## Quick start

```powershell
cd app
pnpm install
pnpm tauri dev
```

## Contributing

Read [AGENTS.md](AGENTS.md) first: it holds the tooling, commit and testing rules. Enable the commit hook and
skip formatter-only commits in blame once per clone:

```powershell
git config core.hooksPath .githooks
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## License

The software is licensed under the [GNU General Public License v3.0 or later](LICENSE): anyone may use, study,
change and share it, provided that what they distribute stays free under the same terms. The audio, motion data
and other assets in `assets/` are free to use; keep the credits to their original authors listed in
[assets/sources.json](assets/sources.json) and the retained author readmes.
