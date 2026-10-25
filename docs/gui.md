# GUI

The optional GUI is a Tauri desktop application over the same core as the CLI.
Its current source build is for local macOS use; see
[installation](installation.md#optional-local-gui). This beta needs no native
installer, and frontend browser preview is not a standalone Mindflow app.

After synchronization, open this checkout or another project:

```sh
bin/mindflow-app .
bin/mindflow-app /path/to/project
```

The default source build is named **Mind Dev**. One application can contain
several workspace windows, each with independent project tabs. A later launcher
call reuses the most recently focused workspace by default; `--new-window`
requests another one.

## Structure and Files

**Structure** is the main semantic workspace. It shows selected files and
folders in their actual hierarchy, with authored peer relationships. Enter a
folder to inspect its contents; open a document to read it. Depth controls
expand more hierarchy in place. Escape or Backspace returns from a nested
layer when the canvas has focus.

Opening documents and their containing branches receive distinct visual cues
within Structure. Opening is not a separate canvas mode. Unregistered ancestor
folders remain navigation context and do not acquire semantic membership.

**Files** is the persistent literal file navigator. It can expose ordinary
project files that are outside the selected Region. Visibility here does not
register them. Keep changes to registration deliberate, and review their
manifest effects.

## Reader, Region, and Timeline

**Reader** opens document content in a separate native window. Follow ordinary
Markdown links to continue reading. Images, Mermaid, and mathematical notation
are rendered where supported; their presentation does not replace source files.
Each Reader uses its owning workspace's observation. Refreshing or closing a
different workspace on the same project does not replace that observation.
Names and prose wrap at natural boundaries; code blocks preserve their lines
and scroll when needed.

**Region** inspects the validated account, including its counts, relationships,
Opening, Events, and Anchors. It is another view of the project rather than a
separate store.

**Timeline** becomes available from Structure when Events or Anchors exist.
It shows the authored Evolve account and returns to the same structural context.
Git history loads when Timeline opens, with visible loading and retry states.
Dense Git marks are grouped for display. **Browse commits** provides pages and
a commit-number field for selecting every exact commit. Events and Anchors
remain available while history loads.
A Region with empty Opening, Events, and Anchors is valid; a first project does
not need invented history just to populate this view.

## Measurements and refresh

Optional Structure measurements and the QC view show registered-document volume
and Git changes. They do not grade quality, infer progress, or decide when a
document should split. Unknown historical comparison remains unknown.
The **Volume** control groups each entry's line count with its compact growth
chart. Hover or keyboard focus reveals the exact values and comparison baseline.

QC and Volume share completed measurements for the same project observation.
Reopening QC, toggling Volume, and selecting a covered shorter recent window
reuse those results. A small local numeric cache also speeds later app and CLI
sessions. It retains the requested window and current document cohort, replaces
obsolete measurements, and stores no document prose. No setup is required.
Refresh revalidates the inputs and reuses measurements that still match.
A missing or damaged cache is rebuilt through ordinary measurement.

Refresh reloads project content. If a newly synchronized local build is ready,
explicit Refresh can activate it and reconstruct workspace tabs. Passive
window-focus checks do not activate another build. The version inspector helps
distinguish the running release, supported project format, and recorded project
adoption; unknown provenance is shown as unknown.

Canvas position, depth, layout, and other presentation preferences add no
project meaning. CLI use and recovery of ordinary project files remain
independent of the GUI. Although development source contains SSH interaction,
this beta does not advertise supported SSH deployment.

## Beta limitations

The CLI is the primary installation and first-use path. The optional GUI still
has areas that need broader testing:

- Opening Timeline still processes the complete first-parent Git history.
  Very large histories can increase that request's time and memory use.
- The first QC/Volume request or a larger uncached history window still needs
  measurement. Caching reduces repeated work; it does not remove history limits.
- First-time layout of dense graphs can still be slow. Repeated navigation
  reuses bounded caches and superseded queued layouts are cancelled.
- Dense diagrams can exceed rendering limits, including the 500-edge budget.
  A visible rendering error can be recovered from by returning to a smaller
  folder scope or reducing displayed depth.
- Supported two-host SSH deployment has not completed its release qualification.
