# Changelog

## Unreleased

- Restored the legacy `info,<eventType>/<eventId>.json,,` and `译者` CSV footer rows so Workshop exports can be imported by SC-VIEWER and the original page-game translation workflow.
- Kept log portraits bound to the original Japanese speaker name after Chinese speaker-name localisation.
- Added the small circular portraits for all 28 regular idols, four collaboration characters, Hazuki, the president, and the anonymous fallback to the local/portable runtime set.
- Added a remembered Workshop-wide translator signature; single-story, edited and group-ZIP CSV exports now write it into the legacy `译者` footer row.

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
