# Changelog

This file records user-visible changes in the official Mindflow release
entrance. Living design and implementation development occurs in a separate
private laboratory; this repository receives reviewed source releases.

## [2026.10.29](https://github.com/bearxiong2k/Mindflow/releases/tag/v2026.10.29) — Navigation and Structuralist prerelease

- Gives Structure, Opening, and Evolve distinct labeled icon buttons. Structure
  returns home to the root overview; Opening frames the current selection in
  the graph; Evolve opens the history view.
- Starts Files navigation alongside the graph transition, including returns to
  a parent. Folding and reveal scrolling run together and finish sooner when
  listings are available, with delayed responses kept independent of rendering.
- Simplifies Structuralist guidance while preserving all five patterns. Event
  discussions can carry unresolved questions and evidence; summaries connect
  finer reasoning and link accepted consequences to their current owners.
- Replaces the full recipe template with a compact worked example and optional
  extensions. The supplied steering extension demonstrates changing current
  Opening independently of Event history. Package checks validate both forms.
- Keeps project format `2026-10-27`. Projects already using this format need no
  structural conversion. Updating the app or skill does not automatically
  change a project's recorded adoption.

Includes source and standalone Structuralist archives with SHA-256 checksums.
The optional macOS GUI is built locally; no prebuilt application is included.
The existing [beta limitations](docs/gui.md#beta-limitations) still apply.

## [2026.10.27](https://github.com/bearxiong2k/Mindflow/releases/tag/v2026.10.27) — Evolve prerelease

- **Format changes to `2026-10-27`.** Events now select ordinary registered
  Markdown discussions and nested summaries. Existing projects, including
  `2026-10-20`, need reviewed manual adoption through `mindflow update-handoff`.
  Installing this release does not convert their files or manifest.
- Renames Timeline to **Evolve** and combines nested Event reading with
  Opening-file lifelines. Folding a summary composes its whole section;
  expanding it reveals finer discussions and detailed file transitions.
  Current Opening remains independent of the recorded historical flow.
- Adds a progressive Event navigator with independent zoom at each hierarchy
  level and one coordinated history position. Empty child ranges inherit the
  ancestor's navigation scale. Every level uses the same compact controls,
  readable centered titles, and ancestry colors.
- Integrates Git evidence into the inspector: selecting a commit shows its
  message, author, committer, parents, and exact identity. Event prose appears
  when an Event is selected, with snapshot-bound reads and retry handling.
- Keeps Event-bar scrolling synchronized with the lifelines, bounds rendering
  to visible geometry, and reuses geometry when the lane order is unchanged.
  Focus, folding, navigation, and document reading retain their own state.
- Preserves completed QC and Volume observations when returning to an unchanged
  window, including when unrelated filesystem activity occurs.
- Ships portable Event validation tests, updated public setup and format guides,
  and the complete Structuralist package and recipe for this source release.

Source and standalone Structuralist archives are accompanied by release notes
and SHA-256 checksums. The optional macOS GUI is built locally from source;
there is no prebuilt application asset. First measurements, large Git histories,
and dense initial graph layouts can still take time. Two-host SSH deployment
remains unqualified.

## [2026.10.25](https://github.com/bearxiong2k/Mindflow/releases/tag/v2026.10.25) — QC and volume caching prerelease

- Reuses numeric documentation measurements across app and CLI sessions, so
  unchanged Git history does not need repeated measurement. Each project keeps
  one replaceable cache of the requested window, capped at 8 MiB, in local Git
  state. It contains counts and source identities, not document prose.
- Shares completed observations between QC and graph volume/growth displays.
  Reopening a panel, toggling Volume, or choosing an already covered shorter
  recent window avoids another measurement request and loading flash.
- Refresh revalidates the captured project inputs. Working edits, changed
  registrations, and Git replacements are reflected correctly; unavailable or
  damaged cache files fall back to ordinary measurement. Workspace snapshots
  remain independent. Cached reports still reject missing historical Git
  objects instead of concealing unavailable history.
- Adds portable regression coverage for process reuse, cache replacement,
  corruption, concurrent requests, retained snapshots, and linked worktrees.
- Keeps format `2026-10-20`, the Structuralist installation route, and source-only
  distribution. First measurements and dense initial graph layouts can still
  take time; two-host SSH deployment remains unqualified.

## [2026.10.24](https://github.com/bearxiong2k/Mindflow/releases/tag/v2026.10.24) — GUI integration prerelease

- Loads Git history only when Timeline opens, with loading, failure, and retry
  states. Groups dense commit markers while preserving exact commit selection
  through bounded pages and a commit-number field.
- Reuses graph geometry and bounded render caches, prioritizes foreground
  navigation, and cancels superseded queued layouts.
- Keeps Reader, Timeline, and measurement observations independent across
  workspace windows, including when another window refreshes or closes.
- Wraps graph names, relationships, and Reader prose at natural boundaries,
  preserving long filenames, Unicode graphemes, and table-header words.
- Groups entry line counts with their growth charts and removes excess space
  so more of the graph fits on screen.
- Keeps project format `2026-10-20` and the optional Structuralist setup route.
  Source and standalone skill archives include checksums; no prebuilt app is
  included. Dense initial layouts and explicit long-history requests remain
  performance limits, and two-host SSH deployment remains unqualified.

## [2026.10.20](https://github.com/bearxiong2k/Mindflow/releases/tag/v2026.10.20) — Source beta prerelease

- Uses ordinary paths and one `MINDFLOW.yaml` in format `2026-10-20` for
  explicit registrations, relationships, Opening, Events, and Anchors.
- Replaces the old Practice Skill in the current slice with the complete living
  Structuralist package, an installer that preserves existing copies, and
  separate human/agent setup instructions. The recipe remains optional.
- Fixes large Git-history loading, Reader state when leaving a Region, refreshed
  inline images, folder-only Structure views, graph-render failure recovery,
  minimap navigation, and dialog keyboard focus.
- Replaces obsolete public guides and screenshots with a small current manual.
- Records exact committed source provenance and ships portable tests and a
  GitHub Actions workflow. Hosted workflow results are reported by GitHub.
- Provides CLI-first source installation; no macOS application download is
  required. Optional GUI source remains included. SSH is not a supported beta
  installation route. See the guides for remaining performance limitations.

Source and standalone Structuralist archives are available from the prerelease
page, with checksums for the convenience assets. No prebuilt application is
included.

The older format is not loaded automatically. `mindflow version --json` and
`mindflow update-handoff` support a deliberate manual adoption review.

## 0.1.0 — Source preview candidate

- Introduces the coordinated Mindflow Core, CLI, macOS GUI, and
  `integrate-mindflow` Practice Skill as one exact source slice.
- Supports format 13 project regions over ordinary Markdown, `.mindthese`,
  `MINDFLOW.yaml`, and Git.
- Exposes complete current semantic orientation through `mindflow status
  --json`, continuous and discrete frontiers, and Git-backed anchors.
- Presents Structure, Tension, Timeline, Files, Region, and native Reader
  surfaces in the desktop application. Files is an always-available, read-only
  navigator for the complete project folder without enlarging the semantic
  region.
- Leads the public entrance with the natural-language-layer paradigm, the
  boundary between Mindflow's light semantics and project-owned pragmatics,
  and recorded glimpses of the stable GUI views those semantics enable.
- Makes the public repository itself an independently valid light Mindflow
  region for inspecting its real documentation through Structure, Region,
  Reader, Tension, and a branch-and-merge Timeline before integrating another
  project.
- Separates product insight from a rigorous public semantics reference covering
  object meaning, ownership, lifetime, invariants, and non-implications.
- Ships a progressively disclosed Practice Skill for pressure-triggered
  construction and evolution, read-only drift diagnosis, and explicitly
  authorized conservation-first trimming. Its complete intensive personal
  practice remains an opt-in CC0 reference rather than a required endpoint.
- Establishes deterministic promotion and exact development-laboratory revision
  provenance in `release-source.json`.

This candidate is source-only. It does not include signed or notarized binaries,
automatic updates, package-registry distribution, general cross-platform GUI
support, or stable compatibility across future preview versions.
