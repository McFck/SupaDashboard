# Subway sound pack

Japanese-train audio, motion data and line manifests for the dashboard's Subway skin. The app stages what it
needs from here at build time. Credits for the
original recordings and sound materials are in [sources.json](sources.json).

| Line          | Kept content                                                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Yamanote E235 | 30 stations; JA next with exit side, EN next, transfers; station/shared melodies; generic speech, terminal/platform PA; four emergencies; doors; E235 movement                      |
| Hibiya 13000  | 22 stations; bilingual station/transfer speech; 40 directional departure melodies and boarding melody; generic/terminal/platform PA; four emergencies, including a connecting Ginza outage; doors; 13000 movement |
| Sakaisuji 66  | 10 stations; bilingual station/transfer speech; approach/departure/notice chimes and platform PA; generic/terminal speech; three emergency examples; doors; Hankyu 1300 movement     |

Each `lines/<line>/pack.json` is the **only playback manifest**. It contains `stations`
(next/arriving/transfer by language, departure melodies by direction), `generic`, `on_station`,
scenario-labelled `emergency`, `doors` (including variants and opening/closing `sequence`) and a
`movement` profile ID. Audio entries have an assets-relative `file`, corrected `text`, review `status`,
`note`, source ID, source start/end and SHA-256. Speech retains raw `asr`; changed boundaries record
their processed archive input. Identical sounds share one file. `line.json` holds station metadata.

Only referenced clips, manifests, credits and runtime files remain here. Movement sound is described by
`motion/motion.json` with its clips under `motion/clips/` (see `motion/README.md`); the cue set used to verify catalogue trims is generated in `motion/cues.js`. Door
sequencing is shared through `motion/door-sequence.js`. The movement source readme is retained.
Yamanote includes the user-supplied “ドアが閉まります。ご注意ください。” warning. All three lines
share the supplied mechanical door effect for opening and closing; one file serves both roles.
The replacement clips have adjusted levels and short fades and need an ear check in playback.

## Rebuild and check

The pack is built with local scripts that are not tracked in this repository (Python, numpy, ffmpeg, Node and Chrome
required). From the repository root:

```powershell
python tools/build_pack.py
python tools/build_station_demo.py
python tools/build_subway_catalog.py
python tools/check_doors.py
python tools/test_pack.py
node tools/test_motion.cjs
node tools/test_pack_browser.cjs
```

`build_pack.py` validates the manifests; `--clean` removes unreferenced files under `clips/`.
The optional review page is **regenerable**, so it is not kept: run `python tools/build_check.py`, then
open `assets/check.html`. It retains the localStorage key `supadashboard-sound-check-v1` and Copy/Download
results. The browser test generates this page temporarily and removes it afterwards.

## Recording archive

Raw recordings and review evidence were moved, with byte counts verified, to
`C:/Users/me\Desktop\Projects\SupaDashboard-archive\raw\<line>\` and `...\reviews\`.
Shared originals/licence snapshots and the supplied mechanical effect are under `raw\shared\door\`;
the supplied warning is under `raw\yamanote\user-supplied\`.
Cutters read archived raw audio and write candidates/indexes under the archive's `prepared/` folder;
they do not change the active pack. Audition selected cuts before copying them into `clips/` and
adding their provenance to `pack.json` and `sources.json`.

## Known gaps

Explicit Yamanote and current seven-car Hibiya 回送 speech, Hibiya-own in-car outage,
and verified 66-series Sakaisuji resumption remain unsourced. Ginza arrival has only generic JA exit-side
wording in the sampled services; K11 northbound goes directly to arrival, with no separate next line
observed in the current-ROM recordings. These reasons are recorded in the manifests. Osaka emergency
examples from other lines remain labelled accordingly.
