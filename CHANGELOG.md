# Changelog

## 20260907-r12

- Recognized the new 10-digit A.X.E.8. scenario numbering used by unit-wide Produce chapters.
- Classified the 2026-09-07 illumination STARS batch and the 2026-08-28 ALSTROEMERIA batch as full Produce chapters under `育成 -> 星组／花组 -> A.X.E.8.` rather than generic idol stories.
- Added whole-group CSV ZIP export for A.X.E.8.; each seven-story batch is ordered and named `01` through `07`.
- Added stable A.X.E.8. labels to the full resource library and update log, with unit-aware ZIP filenames.
- Refreshed the bundled resource-library/title snapshot through the 2026-09-07 scan.

## 20260831-r11

- Added automatic background prefetch immediately after a scenario JSON is loaded.
- Added hybrid playback: cached files are loaded locally under their original remote resource keys, while only missing files fall back to the network.
- Added one batched cache-status API to both the Python development server and the dependency-free Windows PowerShell portable launcher.
- Added bounded resource download timeouts/retries and a three-second maximum playback wait so one unavailable upstream file cannot hold the player on a black loading screen.
- Kept Spine JSON local only when its atlas and texture companions are also present, preventing partial-cache animation failures.
- Added a sharing/update guide explaining first launch, cache persistence, upgrades and what may be redistributed.
- Restored the legacy `info,<eventType>/<eventId>.json,,` and `译者` CSV footer rows so Workshop exports can be imported by SC-VIEWER and the original page-game translation workflow.
- Kept log portraits bound to the original Japanese speaker name after Chinese speaker-name localisation.
- Added the small circular portraits for all 28 regular idols, four collaboration characters, Hazuki, the president, and the anonymous fallback to the local/portable runtime set.
- Added a remembered Workshop-wide translator signature; single-story, edited and group-ZIP CSV exports now write it into the legacy `译者` footer row.
- Fixed edit/translation binding when the source scenario reuses one track id for an action-only node and its dialogue, or replays the same id later as a flashback. Duplicate ids are now matched to editable text tracks by source text and occurrence order without changing playback tracks.
- Allowed edit mode to open before a card is implemented by omitting only uncached static/animated card media from its preload list. Cached card art still appears, while normal Japanese and translated playback keep the complete resource policy.

## 20260816-r9

- Separated scenario discovery dates from later metadata and resource implementation.
- Card names, story titles, still images, and Produce-card movies now update the original card entry without creating another update-log date or unread marker.
- Migrated the 2026-08-07 Natsuha birthday Support card back to its original update batch while retaining its current implemented status.
- Fixed ShinyColorsDB DataSite story-title extraction by accepting the current `eventName` field as well as the legacy `eventTitle` field.
- Added the missing titles for Mamimi Support card #25: `夏でもひんやり` and `ひんやり超えても夏`.
- Updated the illustrated Chinese quick guide and maintenance log.
- Added an explicit upstream source map identifying the player code derived from
  AsaHikari/ShinyScenarioViewer and the major Workshop additions.

## 20260812-r8

- Updated the illustrated guide to cover the current workshop, editing, resource-library, and update-log workflows.
- Added a version maintenance log to the guide.

## 20260811-r7

- Preserved Auto mode when returning from a choice branch.
- Started the keyed transition earlier to shorten the black-screen interval.
- Reduced UI interaction-sound volume without changing voice, BGM, or scenario SE volume.

Earlier package history remains available in `Quick-Guide-ZH.pdf`.
