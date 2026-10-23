# Changelog

This file records user-visible changes in the official Mindflow release
entrance. Living design and implementation development occurs in a separate
laboratory whose public release is deferred.

## 2026.10.20 — Source beta candidate (unreleased)

- Uses ordinary paths and one `MINDFLOW.yaml` in format `2026-10-20` for
  explicit registrations, relationships, Opening, Events, and Anchors.
- Replaces the old Practice Skill in the current slice with the complete living
  Structuralist package, an installer that preserves existing copies, and
  separate human/agent setup instructions. The recipe remains optional.
- Fixes large Git-history loading, Reader state when leaving a Region, refreshed
  inline images, folder-only Structure views, graph-render failure recovery,
  minimap navigation, and dialog keyboard focus.
- Replaces obsolete public guides and screenshots with a small current manual.
- Records exact committed source provenance and ships portable tests and CI.
- Provides CLI-first source installation; no macOS application download is
  required. Optional GUI source remains included. SSH is not a supported beta
  installation route. See the guides for remaining performance limitations.

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
