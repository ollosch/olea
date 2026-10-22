# Syrinscape data audit (Phase 0)

Read-only audit of the Syrinscape XML tree and the current `config.json` classification.
Generated on 2026-10-22 from the local `soundboard/syrinscape` tree.

- Script: `soundboard/tools/audit-syrinscape.js`
- Command: `node soundboard/tools/audit-syrinscape.js`
- Optional full JSON: `node soundboard/tools/audit-syrinscape.js --json`
- `OLEA_AUDIO_DIR` overrides the audio root. Relative values resolve against `soundboard/`.
- The audit only reads `.xml` and `config.json` contents. It never opens audio files, and it does not write to any config.

## 1. Pack inventory

Top-level folders are treated as packs. Campaign containers can hold several XML files and several nested configs.

| Item | Count |
|---|---:|
| Top-level packs | 223 |
| Packs with real XML | 89 (191 XML files) |
| Packs with only `.generated.xml` | 126 (126 XML files) |
| Packs with no XML | 8 (all empty: no audio, no config) |
| `config.json` files | 317 |

All 191 real XML files parsed successfully. `191 real + 126 generated = 317` XML files, matching the 317 configs.

The 8 XML-less packs are empty directories, for example `Syrinscape - D&D - Waterdeep`, `Syrinscape - Pathfinder - Ghoul Battle`, and several Ghosts of Saltmarsh/Strange Aeons folders.

## 2. XML variants and structure

### 2.1 Real XML

Every real XML file has a `<Chapter>` root and `FormatVersion` `2.1.6`.

| Section | Files containing it | Element nodes | Node type |
|---|---:|---:|---|
| `MusicElements` | 191 | 552 | `MusicElement` |
| `SfxElements` | 191 | 5,800 | `SFXElement` |
| `LoopElements` | 191 | 0 | none |
| `OneshotElements` | 191 | 2,089 | `OneshotElement` |

Note the naming: the section is `SfxElements`, but the element node is `SFXElement` (uppercase). `LoopElements` exists in every file but is empty everywhere in this dataset. Loops are represented by `MusicElements`, and trigger-driven effects by `SfxElements`.

Element kinds currently derived by `parseSoundsetXml`:

- `OneshotElement` → `oneshot`.
- `MusicElement` → `random` when `MaxTriggerWait > 0`, otherwise `loop`.
- `SFXElement` → `random` when `MaxTriggerWait > 0`, otherwise `loop`.

#### Field availability

| Field group | `MusicElement` (552) | `SFXElement` (5,800) | `OneshotElement` (2,089) |
|---|---:|---:|---:|
| `Title`, `Slug`, `InitialGain`, `InitialIntensity`, `BypassEffects`, `BypassPosition`, `ReverbPreset`, `Playlist`, `RandomisePlaylist` | 552 (100%) | 5,800 (100%) | 2,089 (100%) |
| `MinTriggerWait`, `MaxTriggerWait`, `MinStartDelay`, `MaxStartDelay`, `RepeatPlaylist`, `AllowPlaylistOverlap` | 552 (100%) | 5,800 (100%) | absent |
| `IsGlobalOneshot` | absent | absent | 2,089 (100%) |
| `MinAngle`, `MaxAngle`, `MinDistance`, `MaxDistance`, `Speed` | absent | 5,800 (100%) | 2,089 (100%) |
| `ReverseDirection` | 382 (69%) | 3,701 (64%) | 1,239 (59%) |

Additional observations:

- `InitialGain` is present on every element but is not always `1`: 4,936 elements are exactly `1`, 3,505 have another value.
- `ReverbPreset` is present on every element; there are 30 distinct values. The most common are `Off` (1,058), `City` (944), `Soft furnished room` (933), `Stone Dungeon` (869), and `Cave` (652).
- `BypassPosition`: `false` 7,156, `true` 1,285.
- `RandomisePlaylist` values: `shuffle` 8,045, `random` 317, `inorder` 79.
- `MaxTriggerWait`: positive 3,765 (random-capable), zero 565, negative 2,022, missing 2,089 (all one-shots).
- `MaxStartDelay`: positive 3,812, zero 2,540, missing 2,089 (all one-shots).
- `ReverseDirection` is the only commonly absent optional field; everything else in the table is either universal or absent by element type.

#### Playlist, samples, and moods

| Structure | Count / fields |
|---|---|
| `Playlist` nodes | 8,441 (9 of them empty) |
| `PlaylistEntry` nodes | 55,997 |
| `PlaylistEntry` fields | `SampleFile`, `MinGain`, `MaxGain`, `Position`, `MinElementIntensity`, `MaxElementIntensity` (all 55,997) |
| `SoundSample` nodes | 47,228, with `Uuid`, `Title`, `Extension`, `Duration`, etc. |
| Moods | 1,670 `Mood` nodes in all 191 files |
| Mood fields | `Title`, `ElementParameters` |
| `ElementParameter` nodes | 89,199, with `ElementSlug`, `Plays`, `Intensity`, `Volume` |

A representative node-path summary:

- `Chapter/MusicElements/MusicElement/Playlist/PlaylistEntry/SampleFile`: 1,855
- `Chapter/SfxElements/SFXElement/Playlist/PlaylistEntry/SampleFile`: 45,553
- `Chapter/OneshotElements/OneshotElement/Playlist/PlaylistEntry/SampleFile`: 8,589
- `Chapter/Moods/Mood/ElementParameters/ElementParameter/ElementSlug`: 89,199

The audit collects 195 distinct node paths in total; the JSON report contains the full list.

### 2.2 Generated XML

The 126 `.generated.xml` files are the minimal variant produced by `xml.js`:

- `<Chapter>` with `Slug`, `Title`, `InitialGain`, and `Samples`.
- `MusicElements` for filename-detected loops and `OneshotElements` for everything else.
- Empty `SfxElements`, `LoopElements`, and `Moods`.
- No `FormatVersion`.

These files are intentionally excluded from XML parsing by the audit. Their pack classification comes from the config scan below.

## 3. Current `config.json` classification

| Metric | Value |
|---|---:|
| Soundsets | 317 |
| Elements | 16,867 |
| Loop elements | 2,622 |
| Random elements | 3,538 |
| One-shot elements | 10,707 |
| Disabled soundsets | 0 |
| All-one-shot soundsets | 62 (19.6%) |
| Zero loops **and** zero randoms | 62 |
| Empty soundsets | 0 |

### Cross-tab by XML source

| Source | Configs | Loop | Random | One-shot | All-one-shot | Disabled |
|---|---:|---:|---:|---:|---:|---:|
| Real XML | 191 | 2,461 | 3,538 | 1,619 | 0 | 0 |
| Generated only | 126 | 161 | 0 | 9,088 | 62 | 0 |

Key finding: **all 62 all-one-shot soundsets come from generated-only packs**, and generated-only packs contain **zero random elements**. Real-XML packs are never all-one-shot and account for all 3,538 random elements.

Examples of all-one-shot soundsets: Blaster Battle (33 elements), Brindol Town [124] (37), Demon Haunted Crypt (34), and several `Community Content - Music - ...` packs (1–20 elements each).

## 4. Notable examples

| Pack | Source | Real / generated XML | Configs | Elements (loop/random/one-shot) | Note |
|---|---|---:|---:|---:|---|
| `Syrinscape - D&D - Carrion Crawler Battle` | generated-only | 0 / 1 | 1 | 0 / 0 / 24 | 136 audio files; all 24 elements are one-shots |
| `Syrinscape_D&D_Waterdeep_Dragon_Heist_Chapter_4` | real XML | 10 / 0 | 10 | 147 / 108 / 40 | Full classification from XML |
| `Syrinscape_D&D_Waterdeep_Dragon_Heist_Chapters_1_3` | real XML | 9 / 0 | 9 | 114 / 111 / 97 | Full classification from XML |
| `Syrinscape_D&D_Waterdeep_Dragon_Heist_Chapter_4_Soundpack_124` | generated-only | 0 / 1 | 1 | 4 / 0 / 440 | 1,246 audio files; no randoms |
| `Syrinscape_D&D_Waterdeep_Dragon_Heist_Chapters_1_3_Soundpack_124` | generated-only | 0 / 1 | 1 | 8 / 0 / 472 | 1,635 audio files; no randoms |

The Dragon Heist real-XML packs show the desired fidelity: the same content is cleanly split into loops, randoms, and effects. The matching `Soundpack_124` generated-only packs are dominated by single-file one-shots and have no random classification at all.

## 5. Implications for import heuristics and implementation

1. **Prefer real XML unconditionally.** Section/type and trigger fields are reliable, and real-XML configs already classify cleanly (2,461 loops / 3,538 randoms / 1,619 one-shots, zero all-one-shot packs).
2. **Do not rely on `LoopElements`.** It is empty in all 191 real files. Support `MusicElements` and trigger-capable `SfxElements`; keep `LoopElements` parsing for compatibility but do not expect it in this data.
3. **The generated-only packs are the actual classification problem.** They contain zero randoms and 62 all-one-shot configs. The current filename heuristic only recognises a narrow loop keyword set, so music/ambience packs such as `Community Content - Music - ...` become effects.
4. **Filename heuristics need the full keyword sets from §11.2.** Add loop/music words (`music`, `theme`, `score`, `soundtrack`, `bed`, …), random/ambient words (`noise`, `rustle`, `growl`, `breath`, `crowd`, `wind`, …), and effect/action words. Use file count and size to separate one-shots from random beds, and default random triggers to `10–30s` with `2–10s` start delay.
5. **Keep XML-derived trigger semantics.** `MaxTriggerWait > 0` is the reliable random signal; zero/negative waits are used for loops and non-triggered elements. `MaxStartDelay` is only present where start delay applies.
6. **Many real playlists already exist.** 8,441 elements have playlists and 55,997 entries, so merging is mostly a review concern for generated-only packs and large single-file music tracks, not for real-XML packs.
7. **Preserve gain/reverb/moods.** `InitialGain` is non-1 for roughly 42% of XML elements, `ReverbPreset` is universal, and all real XML files carry moods (1,670 moods). Do not flatten these during migration.
8. **Intensity and 3D data are present but out of scope.** `InitialIntensity`, playlist `Min/MaxElementIntensity`, mood `Intensity`, position angles/distances, and `Speed` can be preserved in schema but need not drive playback yet.
9. **Mark generated-only imports for review.** Every generated-only pack lacks authoritative kinds; `reviewed: false` is appropriate. The 8 empty folders can be ignored or reported as unavailable packs.
10. **No disabled soundsets and no empty configs** were found, so migration/reclassification risk is limited to content changes, not disabled or malformed data.

## 6. Reproduce

```sh
node soundboard/tools/audit-syrinscape.js
# optional, writes a full JSON report (default: soundboard/SYRINSCAPE_AUDIT.json)
node soundboard/tools/audit-syrinscape.js --json
```

Use `OLEA_AUDIO_DIR=/path/to/syrinscape` to audit a different tree. The script completes in a few seconds on this repository because it reads only XML and config JSON, never audio contents.
