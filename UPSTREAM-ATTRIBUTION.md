# Upstream attribution and source map

Shiny Scenario Workshop is a modified distribution of
[`AsaHikari/ShinyScenarioViewer`](https://github.com/AsaHikari/ShinyScenarioViewer),
which is licensed under the GNU Affero General Public License version 3 only.
The upstream project provides the browser-based ADV player foundation used by
this project. A preserved copy of its README is included as
`README.upstream.md`, and its AGPLv3 license is included as `LICENSE`.

## Code derived from or built on ShinyScenarioViewer

The following areas originate in the upstream player or are modified versions
of upstream code. They must not be described as original work of this fork:

- `index.html`, `main.js`, and `main.css`: player entry point, startup flow,
  loading screen, canvas setup, scenario loading, and player UI styling.
- `scripts/`: the ADV playback engine, track scheduling, layers, text and log
  UI, audio playback, choices, effects, resource conversion, and related
  player modules. Many of these files have been modified in this fork.
- `lib/`: the browser libraries shipped by the upstream player. Their own
  licenses and preserved headers continue to apply; see
  `THIRD-PARTY-NOTICES.md`.
- Root player images such as the language selector, popup examples, screenshots,
  and tap-effect examples where retained from upstream.
- `remote-main.js` and `index.local-only.html`: fork-specific variants derived
  from the upstream player entry flow.

## Major additions in Shiny Scenario Workshop

The following areas were added for this fork, although they operate together
with and sometimes patch the upstream player:

- `app.html`, `app.js`, `app.css`, and `app-related.css`: the Chinese workshop
  UI for loading scenarios, translation/editing, resource management, the
  catalogue, and update logs.
- `serve-viewer.py`, `serve-viewer.ps1`, `start-viewer.cmd`, and
  `start-portable.cmd`: the local application server, resource proxy/cache,
  launcher, and portable startup flow.
- CSV import, translation merge, autosave/edit mode, speaker-name archiving,
  related-story discovery, grouped CSV export, and title/classification logic.
- Local/remote asset fallback, cache inspection, missing-card-image handling,
  Produce-card movie replacement, and the portable runtime manifest.
- The catalogue/update-log metadata pipeline and the optional private
  official-game resource listener. The private listener is not included in
  public portable builds.
- `obs_controller.py` and `obs_export.py`: experimental video-export support.
- `build-portable.ps1`, `tests/`, `CHANGELOG.md`, and the illustrated Chinese
  quick guide.

This is a source-area map, not a claim that every line inside an “addition” is
independent of the upstream player. Integration code that calls or patches the
player remains part of a combined AGPLv3 work.

## Other projects and assets

- The optional local update listener uses a rewritten interception approach
  informed by [`biuuu/ShinyColors`](https://github.com/biuuu/ShinyColors), an
  MIT-licensed project. See `THIRD-PARTY-NOTICES.md`.
- JavaScript libraries under `lib/` retain their own license notices.
- Game names, graphics, audio, scenario data, and other game resources belong
  to their respective rights holders. They are not licensed by the AGPLv3 code
  license.
- Portable builds may contain a small fixed runtime set listed in
  `portable-runtime-assets.json`. Its inclusion does not grant redistribution
  rights; see `DISTRIBUTION-NOTICE.md` and `THIRD-PARTY-NOTICES.md`.

This project is unofficial and is not affiliated with or endorsed by
AsaHikari, Bandai Namco Entertainment, THE IDOLM@STER, or the game service.
