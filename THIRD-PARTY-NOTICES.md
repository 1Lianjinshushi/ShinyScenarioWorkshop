# Third-party notices

The `lib/` directory contains browser libraries with their original license
headers intact. Local modifications are listed below:

- PixiJS 6.5.9 — MIT License.
- `@pixi/sound` 4.3.1 — MIT License.
- `pixi-spine` 3.0.13 — Spine Runtimes License. See the license URL preserved in
  `lib/pixi-spine.umd.js`.
- GSAP and PixiPlugin 3.11.4 — GreenSock Standard License. See the license URL
  preserved in the respective files.
- Font Face Observer 2.3.0 — BSD 3-Clause License.

These components remain governed by their own licenses. This notice does not
replace the license headers distributed with them.

### Local runtime corrections

- 2026-09-16: `pixi-spine` 3.0.13, bundled Spine 3.7 `DeformTimeline.apply`:
  prevent the final-keyframe `first`/`replace` branch from falling through to
  `add` when alpha is below one. This fixes doubled mesh deformation and
  attachment-reset flicker for every model using that runtime (including the
  3.6 compatibility path). No game models or animation timelines are changed.
  The 3.8 and 4.0 branches already terminate this branch correctly.
  Regression coverage is in `tests/spine-deform-mixing.test.js`.
- In the same bundled 3.7 compatibility path, models explicitly marked 3.6
  retain the game's legacy deformation blend when an attachment resets, retain
  populated setup buffers before the first deform key, and keep the previous
  pose before the first rotation key during mixing. Native 3.7 and later
  models keep their own version's behavior. These focused compatibility fixes
  were verified against the public game runtime; no game bundle is added to
  the shipped application. The local-only integration runner is
  `experiments/offline-export/verify-spine-models.cjs`.

## Portable runtime fonts and common UI files

Portable builds may include the files enumerated in
`portable-runtime-assets.json`, including `FOT-HummingPro-B.OTF`,
`FZFWQINGYINTIJWB.TTF`, `AlimamaShuHeiTi.ttf`, common UI atlases, interaction sounds, and effect data.
Their inclusion here does not grant any additional redistribution license.
Packagers and recipients remain responsible for the permissions applicable to
those files.

## Background-export tools in the 20260919-r13 portable build

The builder copies Node.js and Playwright from explicit local installations,
not from a browser download or the recipient's PATH. The default build sources
are Node.js 24.20.0 and Playwright/playwright-core 1.62.1. FFmpeg/FFprobe are
excluded by default; `-BundleOfflineRuntime` opts in to copying the 2026-01-05
Gyan.dev Windows static build. If a builder overrides these sources, the
resulting versions and licenses must be checked again before distribution.

- `tools/node.exe`: Node.js, licensed under its bundled terms and third-party
  notices in `tools/licenses/node-LICENSE.txt`.
- `tools/node_modules/playwright/` and `playwright-core/`: Microsoft Playwright,
  Apache License 2.0. Their `LICENSE`, `NOTICE`, `ThirdPartyNotices.txt`, and
  per-bundle `.LICENSE` files are preserved inside each copied package.
- When explicitly bundled, `tools/ffmpeg.exe` and `tools/ffprobe.exe`: Gyan.dev FFmpeg full build,
  declared GPL version 3 by its distributor. The supplied GPL text and build
  README (including source revision and configuration) are copied to
  `tools/licenses/ffmpeg-LICENSE.txt` and `ffmpeg-README.txt`.

Microsoft Edge and Google Chrome are not bundled. Their presence and H.264 WebCodecs support depend
on the recipient's computer. Including these files does not, by itself, prove
cross-computer operation or settle the redistributor's obligations for the exact
FFmpeg binary and its dependencies, including corresponding-source availability.

<!-- LOCAL_MONITOR_BEGIN -->
The development workspace's optional `scripts/ShinyScenarioUpdateMonitor.user.js`
is not included in portable builds. It uses a rewritten
runtime interception approach informed by
[`biuuu/ShinyColors`](https://github.com/biuuu/ShinyColors), Copyright (c) 2019
biuuu, licensed under the MIT License. Its upstream license is reproduced in
the source repository linked above.
<!-- LOCAL_MONITOR_END -->
