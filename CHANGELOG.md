# Changelog

## 20260929-r15 — 2026-09-29

- Restore the complete game-update workflow in the public portable build: bundle
  `ShinyScenarioUpdateMonitor.user.js`, retain the Install/Update Listener and
  Open Game controls, and start recipients in live-listener mode instead of the
  old snapshot-only mode. Personal listener status, unread markers, resource
  requests, credentials and story-specific game assets remain excluded.
- Document the Tampermonkey installation and first-baseline workflow for shared
  copies. Clarify that official-session checks require the recipient's own game
  tab and local workshop server to run together.
- Include the latest local resource preflight fix and refreshed scenario/card/
  speaker metadata available at release time.

## 20260919-r14 — 2026-09-19

- Add a Bilibili illustrated FFmpeg installation link to the background-export
  panel, with a reminder that both FFmpeg and FFprobe must be discoverable by
  the workshop.
- Add a standalone four-page Chinese PDF for FFmpeg/FFprobe setup, queueing,
  progress, output locations, memory pause and troubleshooting. Bundle it with
  the portable ZIP and publish it as a separate release asset.

## 20260919-r13 — 2026-09-19

- Refine the workshop's desktop and narrow-screen visual hierarchy: clearer
  player/editor and background-export sections, aligned subsection headings,
  consistent controls, visible keyboard focus, and reduced-motion support.
  The resource-library collapse shortcut appears only while that catalogue is
  on screen, instead of covering unrelated controls.
- Refresh the illustrated Chinese quick guide with the new background-export
  layout, manual memory pause, and portable release prerequisites.
- The portable build now carries the complete fixed startup asset manifest,
  including the workshop font and both `016` dialogue/log frames, plus bundled
  Node.js and Playwright for background export. FFmpeg/FFprobe remain a
  separately installed prerequisite for this public release; story-specific
  copyrighted assets remain downloaded on demand. Existing r12 packages are
  never overwritten by the builder.

### Changes completed 2026-09-18

- Keep the current offline-export job paused on a memory safety budget instead
  of failing it and advancing the serial queue. The progress popup shows the
  reason, offers manual “继续任务”, and flashes its Windows taskbar button without
  taking focus. Resume rechecks memory; an unsafe recheck remains paused. An
  interrupted FFmpeg command restarts from its inputs after a safe resume;
  missing resources and disk errors still fail normally. Cancel and service
  restart do not silently continue a paused job.
- Bulk importing associated translated CSVs now fetches each matching Japanese
  scenario JSON, merges the CSV into a Chinese snapshot, and stages successful
  stories in the offline-export queue with their checkboxes selected. Importing
  does not start rendering and no separate “提取关联剧情” step is required. Per-story
  fetch/merge failures are reported without staging an untranslated substitute.
  Missing speaker-name mappings are warnings only; required assets are acquired
  and checked by export preflight, which blocks an unavailable story before
  rendering. The unfinished queue limit is 50.

### Changes completed 2026-09-17

- The output-directory button now attempts to restore and foreground the
  exact Explorer window for the validated save path, in both Python and
  PowerShell hosts. The lightweight progress popup also has this button;
  if Windows declines the foreground request, the UI says so explicitly.
- After Start, move the export status to a lightweight popup that does not
  load the player; close the workshop tab where allowed, or park it without
  polling where browsers forbid scripted tab closure. The popup shows this
  batch's jobs, can return to the workshop, and can update the running/queued
  jobs' memory limits and system-free reserve without restarting the export.
- Add per-start offline-export memory controls: owned-process private-memory
  ceiling and system-free-memory reserve. Defaults remain machine-derived
  (3072/1609 MiB on the current 16 GiB host). Settings are validated,
  snapshotted for each selected job, persisted through queue restarts, and
  passed only to that job's worker; old services cannot silently ignore them.
  Raising the process ceiling alone does not bypass the system reserve, CPU
  throttling or disk guard. The UI warns before lowering the reserve and can
  restore defaults. No speed claim is made without a new benchmark.
- Hide the choice-jump button as soon as a branch is selected; restore it only
  when the choice node reappears. Conservatively speed up the low-CPU,
  memory-caution export tier while retaining pause and memory/disk guards.
  A 554-frame Edge sample improved from 56.0 to 45.2 seconds of visual render;
  event timeline, mastered PCM and final MP4 hashes matched. Concurrent local
  Edge 1080p60 playback showed zero dropped frames.
- Show a story-node progress bar during offline visual rendering, with actual
  encoded seconds/frames alongside it. Revisited choice nodes do not reduce
  progress. Audio mixing/transfer have their own progress; other phases show
  activity without a misleading whole-job percentage. Prefer headless Edge,
  falling back to Chrome. A local 554-frame Edge render and MP4 probe passed.
- Simplify workshop offline export: remove the old recorder UI, settings, iframe
  and handlers; remove preview selection and historical job cards. Unified 14px
  help/status typography, bounded pending list and responsive layout.
- Stage immutable pending snapshots without launching workers. Explicit selection
  and Start enqueue only chosen jobs; unselected snapshots persist across refresh
  and service restart. Add a fixed, validated Open Save Directory endpoint for
  `exports/offline-videos/`. Legacy services cannot auto-start from the new UI.
- 1,116 Node / 30 Python checks pass. Browser checks cover staging, selection,
  unchanged unselected items, both hosts, no history, typography, mobile layout
  and completed download. First selected fixture hit the unchanged memory budget;
  the next completed successfully. No renderer/encoder settings were changed.
- Group new workshop video exports by resource-library card/chapter names and
  episode titles under `exports/offline-videos/`. Preserve Japanese/preview
  suffixes, use exclusive collision numbering, keep IDs when titles are missing,
  and retain the completed file if metadata/naming fails. No network name lookup.
  Sources/reports remain in per-job folders; existing videos are not moved.
- Adapt Open Directory and completed queue labels to the persisted named output.
  Both Python and PowerShell hosts validate the matching completed job, reject
  path escapes/links, and remain compatible with legacy output directories.
  Naming/queue/host regression: 1,112 Node and 29 Python checks pass.
- Actual 554-frame Chinese queue export verifies named output publication,
  unchanged input snapshot, Chinese production font, 1080p60, MP4 range requests,
  rendered queue labels and Windows shell opening. Evidence is retained in
  `exports/offline-proof/naming-20260917/`; no release/package was created.
- Fixed offline Chinese typography: pass the job language to the worker and use
  the production language/font selector for dialogue, speaker names and choices.
  Previously the worker always selected Japanese, causing mixed fallback glyphs
  in Chinese videos. CLI `.zh-cn.json` inputs now select Chinese automatically;
  `SSV_PROOF_LANGUAGE` provides an explicit override. Existing MP4s are unchanged.
- Fixed Open Directory: the detached queue now returns a validated target to
  the interactive Python/PowerShell host, which invokes the Windows shell.
  Removed hidden Explorer launches and swallowed errors. Verified a visible
  Explorer window; failures are now returned to the workshop.
- 1,106 Node and 27 Python checks pass. A new 554-frame Chinese fixture uses
  the same FZ FW QingYin font as ordinary playback; source and timing remain intact.

- Added an experimental workshop offline-export panel: immutable Japanese or
  translated snapshots, batch JSON submission, one shared serial queue for both
  Python and PowerShell hosts, real phase progress, cancel and final MP4 access.
  The worker continues after the page closes; old OBS/live-recording paths stay frozen.
- Batched preview preroll without skipping any virtual frame or Spine render.
  Chiyoko's 3,304-frame MP4 and mastered PCM are byte-identical to the accepted
  sample; measured rendering time fell from 847.6 to 323.5 seconds.
- Managed jobs remove only validated, reproducible intermediates after workers
  close. Source snapshots, caches, final videos and reports remain. Decode-check
  partial MP4s before publishing; interrupted jobs are not silently restarted.
- 1,104 Node and 25 Python checks pass. Isolated UI integration verifies both
  hosts, current-translation and batch snapshots, queued/running cancellation,
  page-close continuation, refresh recovery, downloads and cleanup. Local only;
  no release/package or cross-machine dependency guarantee yet.

- Split ordinary offline export from diagnostic PNG/hash/snapshot capture and
  artificial-stall testing. The default CLI mode is now `offline`; `all` and
  explicit diagnostics retain the verification evidence. Governor sampling and
  pressure waits are no longer charged again as rendering duty time.
- Close the entire visual Chromium instance before mixing, then master audio in
  a fresh audio-only page. Keep one continuous browser compressor; add bypass
  media in one-second Float32 chunks instead of another full-duration buffer.
  Collapse constant gain-record plateaus without changing interpolation.
- All 1,096 JavaScript checks pass. New ordinary-export output matches the old
  short sample in all 554 decoded video frames, events and mastered PCM bytes.
  Three audio comparisons (9.23 / 53.07 / 245.15 seconds) are byte-identical;
  diagnostic mode also passes its 13-frame repeatability check. No visual-quality
  or story-timing settings were reduced, and the production UI is still disabled.
- Recycled 3.03 GiB of allowlisted duplicate samples, diagnostic PNGs and decoded
  intermediates. Retained source JSON, downloaded resources, reports, representative
  videos and audio/video regression baselines. Cleanup is recoverable from the
  Windows Recycle Bin; it does not immediately free that much disk space.
- Added an exclusive-job lock and cooperative Windows load governor to the
  offline-export prototype: adaptive 18/12/6 generation fps, low priorities,
  system-memory pauses, owned-process memory budgets, disk-space checks and
  preallocation guards. Output remains 1080p60 with unchanged story timing.
- Added aggregated preflight reports for runtime files, fonts, UI/Spine texture
  dependencies, audio/image/movie decoding and encoder support. Rendering uses
  only prepared local resources. Partial PCM and MP4 output are not treated as
  complete results; existing user assets/scenarios are not rewritten.
- All 1,091 JavaScript checks pass. A deliberately missing background/voice/movie
  fixture fails before encoding; the animated-card sample passes all 72 resource
  checks. Load protection has also been exercised under actual memory pressure.
- Completed a controlled concurrent headless Edge 1080p60 playback probe:
  5,881 played frames with zero reported drops while the short export completed.
  Output hashes/timing match the prior sample. This is not a guarantee of
  physical foreground responsiveness or a substitute for cross-machine testing.
- Added a live two-second final-dialogue hold to the isolated offline-export
  prototype. Text and voice finish naturally; character animation and active
  BGM/ambience keep advancing, without entering the terminal fade or End page.
- Applied the hold only to the final output boundary, including the requested
  branch-preview cutoff; intermediate branch returns keep their original timing.
- Added route-aware ending detection and regression checks for early autoWait,
  looping dialogue sounds, duplicate advances and three-branch completion.
  All 1,080 JavaScript checks pass. A fresh 4902005026 sample verifies live
  animation/audio during the hold and repeatable output at different render rates.
- Added optional isolated proof-run directories so new samples need not overwrite
  earlier comparisons. The production direct-export UI remains disabled.

### Changes completed 2026-09-16

- Corrected a shared Spine 3.7-runtime deform-mixing fallthrough (also used for
  3.6 models). Replacement deformation no longer gets added a second time,
  fixing exaggerated eyebrows and eye-corner flicker when lower and upper
  animation tracks switch attachments at different blink times.
- Applied the correction at the shared library level for normal playback,
  edit mode and the offline-export prototype; no character-specific overrides,
  disabled blinking, altered scenario/model data or changed animation timing.
- Restored game-compatible 3.6 attachment-reset deformation and pre-keyframe
  rotation behavior, without changing native 3.7/3.8/4.0 semantics. This also
  avoids extra eyelash/mouth and pose-transition deviations in other models.
- Added regression coverage for all three bundled runtime versions, weighted
  and unweighted meshes, blend modes, keyframe boundaries, partial alpha and
  attachment resets. All 1,070 JavaScript checks pass. Integration comparison
  covers 24 models across 12 characters, 192 pose sequences and 115,200 frames;
  displayed mesh deviation from the verified game runtime stays below 0.0001
  model units (Float32 rounding). The two reported Chiyoko sequences match
  the reference exactly for the sampled eye/brow geometry over 600 frames each.

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
