# Movement sound

Motor, rolling and brake sound for the Subway skin's immersion audio. `data.js` embeds the samples and speed
curves, `engine.js` plays them with Web Audio, and `door-sequence.js` plans door cues; the app stages all three.
`cues.js` (built by `tools/build_station_demo.py` from each line's `pack.json`) holds measured trim points and
levels that `tools/build_subway_catalog.py` uses to verify `runtime-cues.json`; every cue fades in/out so
recorded background noise never switches abruptly.

## Sources

| Profile | Material | Creator / original source |
|---|---|---|
| Tokyo | Metro 13000 motor samples and curves, narrow-tunnel rolling, cabin loop, brake rub, full brake release | 21854F / @F21854, [TM13000Sound.zip v0.4](https://uu.getuploader.com/Tob21854F_BVEdate/download/15) |
| Osaka | Metro 30000/30000A motor samples and separate power/brake curves, rolling | Bluegill77, [sound materials](https://bve.bluegill77.jp/assets), [original archive](https://drive.google.com/file/d/1FSe6LXh4ImxF9-d9kkN_bZvsnyNEO7FE/view) |

Osaka is a generic Osaka subway sound, not an exact Sakaisuji 66 recreation.
The Tokyo author describes the samples as muffled. The supplied tables refer to
two absent Tokyo WAVs, but both tracks have zero volume throughout and are omitted.
Neither pack's door sounds, chimes or announcements are imported.

The sound pack is tracked in the repository and free to use.
Keep the source names and original provenance above, including the
preserved [Tokyo readme](tokyo-source-readme.txt), when updating the pack. No
downloaded plugin or executable is used.

## Playback contract

`MotionAudio.update({speed, power, brake})` accepts km/h and normalized 0..1 effort.
The dashboard's vehicle controller must provide these values; acceleration alone
cannot identify whether a train is powered, coasting downhill, or electrically braking.

- Rolling noise follows speed during power, coast and braking. It is independent of motor current.
- Each motor layer uses the supplied sparse speed/pitch/volume tables. Power and braking
  have distinct curves. Power and brake effort ramp at 0.6 s per full step (`EFFORT_SECONDS`), and one must
  reach zero before the other builds, so notching on/off no longer cuts the motor sound.
- Parameters follow their targets with `setTargetAtTime`. The earlier `cancelAndHoldAtTime` + linear-ramp
  pattern made Chrome drop every layer to silence for a few ms (about once a second while coasting).
- Most BVE loops are cut to wrap seamlessly and play untouched. Only loops with a jump at the wrap
  (Tokyo `run5`, Osaka `run0`, a few motor layers) get a blended join: 50 ms motors, 120 ms rolling, 60 ms textures.
  Crossfading the seamless ones smeared their phase and dipped the level at every repeat.
- At zero speed, rolling, motor and brake-rub layers reach zero. A quiet cabin loop remains; Osaka borrows the
  Tokyo one, because its pack has none and standstill otherwise fell to digital silence between door cues.
- Brake release is a one-shot on a real positive-brake-to-zero-brake transition. Arrival
  alone does not fire it. Tokyo includes this sample; Osaka omits it rather than borrowing an unrelated hiss.
- The Tokyo brake-rub sample is low in the mix and restricted to the last 8 km/h under braking.
- `reset()` cancels active one-shots and resets transition history; `dispose()` stops/disconnects all layers.

The layer separation follows [BVE's vehicle sound model](https://bvets.net/jp/edit/formats/vehicle/sound.html).
The rolling pitch uses the conventional 90 km/h reference described by
[openBVE](https://openbve-project.net/documentation/HTML/train_sound_cfg.html).
Layer balance, rolling reference and the blended loop joins still need an ear check on the tablet speakers.
The original relative sample levels are retained; clips are not individually loudness-normalized.

For station sequencing, close doors completely, release brakes, then allow positive
traction. On arrival, reach zero before opening doors. Keep approved door clips in
their own event layer. This audition deliberately isolates movement so it can be judged first.

`demoState(seconds)` is a continuous 65-second test trajectory, including coasting
and a second acceleration. It is not a timetable or a production train physics model.
The demo uses a foreground timer; background-tab scheduling is not a production guarantee.
No fixed-length acceleration or braking recording controls the trip duration.

## Rebuild / verify

```
python tools/import_motion.py <TM13000Sound.zip> <OC30000.zip>
python tools/test_import_motion.py
node tools/test_motion.cjs
python tools/build_station_demo.py
```
Renders of the full station runs were checked offline in Chrome (OfflineAudioContext): no dropouts or
engine clicks remain; the transient detector only hits consonants inside the announcement recordings.

The importer reads only named PCM WAVs and curve files. `data.js` contains the source
paths, curves and embedded WAVs, so the audition also
works from a local file without browser file-fetch permissions. `engine.js` is original
Web Audio playback code; it does not copy or run a BVE plugin.
