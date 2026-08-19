# Distribution notice

This is a modified source distribution of
[AsaHikari/ShinyScenarioViewer](https://github.com/AsaHikari/ShinyScenarioViewer).
The upstream player foundation and this fork's additions are identified in
`UPSTREAM-ATTRIBUTION.md`; a preserved upstream README is included as
`README.upstream.md`.

- License: GNU Affero General Public License version 3 (`LICENSE`).
- Modification date: 2026-08-16.
- This archive includes the corresponding source code for the modified viewer,
  local workshop, launchers, and tests.
- This is an unofficial fan-made tool and is not affiliated with or endorsed by
  Bandai Namco Entertainment, THE IDOLM@STER, or the original game service.
- No warranty is provided.

The portable archive contains a small fixed runtime set needed to render the
player consistently on a new Windows computer: two font files, common UI
atlases, dialogue/select frames, the small circular log portraits for the
regular idols/collaboration characters/Hazuki/president, four interaction
sounds, and tap-effect data.
The exact list is recorded in `portable-runtime-assets.json`.

It intentionally does not include scenario JSON, story-specific voices, music,
backgrounds, character or card artwork, movies, Spine data, or user
translations. Those are retrieved or supplied by users as needed. Anyone who
redistributes a build remains responsible for confirming that they have the
right to redistribute the included font and common runtime files and for
respecting applicable terms, copyright, and local law.

Notable local modifications include remote/local scenario loading, the Chinese
CSV merge workflow, speaker-name archiving, related-scenario extraction, full
resource caching, audio-channel fixes, card/still playback fixes, choice and End
continuation handling, Support-card local still fallback, font selection hooks,
community Support-card still retrieval, local Produce-card MP4 fallback,
batch translation import, adaptive high-DPI rendering, and Windows portable
startup. Portable builds also include a snapshot of the resource-library
catalogue and update-log UI. The private official-game asset-map listener is not
distributed in portable builds. The catalogue contains resource identifiers and
labels only; it does not bundle the corresponding story-specific game assets.
