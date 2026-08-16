# Third-party notices

The `lib/` directory contains unmodified browser libraries with their original
license headers intact:

- PixiJS 6.5.9 — MIT License.
- `@pixi/sound` 4.3.1 — MIT License.
- `pixi-spine` 3.0.13 — Spine Runtimes License. See the license URL preserved in
  `lib/pixi-spine.umd.js`.
- GSAP and PixiPlugin 3.11.4 — GreenSock Standard License. See the license URL
  preserved in the respective files.
- Font Face Observer 2.3.0 — BSD 3-Clause License.

These components remain governed by their own licenses. This notice does not
replace the license headers distributed with them.

## Portable runtime fonts and common UI files

Portable builds may include the files enumerated in
`portable-runtime-assets.json`, including `FOT-HummingPro-B.OTF`,
`FZFWQINGYINTIJWB.TTF`, common UI atlases, interaction sounds, and effect data.
Their inclusion here does not grant any additional redistribution license.
Packagers and recipients remain responsible for the permissions applicable to
those files.

<!-- LOCAL_MONITOR_BEGIN -->
The development workspace's optional `scripts/ShinyScenarioUpdateMonitor.user.js`
is not included in portable builds. It uses a rewritten
runtime interception approach informed by
[`biuuu/ShinyColors`](https://github.com/biuuu/ShinyColors), Copyright (c) 2019
biuuu, licensed under the MIT License. Its upstream license is reproduced in
the source repository linked above.
<!-- LOCAL_MONITOR_END -->
