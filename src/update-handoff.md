# Mindflow format `2026-10-20` adoption handoff

Source release `2026.10.25` accepts project format `2026-10-20` only.
Adoption is a reviewed manual project change; there is no migration command or
backward compatibility mode.

## Select the updated executable

Use the CLI installed from the selected Mindflow source release, or the exact
CLI from a synchronized source checkout. If `mindflow` is already on PATH,
verify which executable it resolves before editing a project:

```sh
command -v mindflow
mindflow --version
mindflow version --json
mindflow update-handoff
```

The version output must identify release `2026.10.25`, project format
`2026-10-20`, and bridge protocol `7`. Version reporting and `update-handoff`
work from an older project even when its manifest cannot load; do not pass
`--root` to `update-handoff`. If PATH selects another checkout, invoke the
intended installed executable by its exact path throughout this handoff.
`bin/mindflow` is the optional synchronized desktop checkout's launcher;
`cargo install --locked --path . --bin mindflow` also supplies a standalone CLI
without building a desktop application.

Keep a recoverable Git revision or external copy of the existing project
before changing carriers. Preserve unrelated working changes. Updating the
Mindflow executable does not update a consuming project's files.

## Choose the adoption path

After reviewing and validating adoption, record `adopted-release: "2026.10.25"`
at the manifest root. This records the release the project chose; it is separate
from `format` and never updated just by launching a newer app or CLI. Existing
current-format projects without this field need only this explicit provenance
edit after review. Missing values and unsupported old projects show `Unknown`
in the app (`null` in `mindflow version --json`); there is no old-version reader.

For a project already using the integer-18 single-manifest contract, change
the header to `format: "2026-10-20"` and record the adopted release above.
Preserve registrations, relationships, and all SOE records exactly. A project
already using `2026-10-20` needs no structural conversion.
The date names a fixed schema revision; do not replace it with today's date
when editing a project or rebuilding Mindflow.

For format 17 or another older format, first complete the manual reconstruction
below. Changing its header alone is not adoption. Do not use `mindflow init`
to update an existing project; it creates an empty manifest.

## Reconstruct older projects

The filesystem owns names, entry types, and containment. `MINDFLOW.yaml` is the
only authored Mindflow carrier. Its `components` mapping registers stable IDs
with exact `path` bindings, optional `description`, and optional Markdown
`index`. Record presence is the managed switch. Folder names supply context;
there is no role vocabulary or override. Unregistered ancestors remain
navigation context. Registering a folder does not register its descendants.

Before adoption, preserve the current IDs, exact descriptions and prose,
relationships, ordered Opening, Events, historical identities, Anchor commits,
and historical connections. Review every removed or changed reference.

1. Bind each retained component to one existing root-relative directory or
   regular file; use `.` for the root. Remove copied labels, kinds, parents,
   role declarations, and placement rules from metadata. Preserve useful
   meaning from old labels and role descriptions in ordinary names, concise
   descriptions, or their governing prose. Review virtual, missing, URL, or
   glob entries explicitly; do not invent bindings or create a fake filesystem
   entry just to retain an old graph node.
2. Put ordered `{source,type,direction,target}` relationships in the manifest.
   Endpoints must be distinct registered peers with the same actual immediate
   folder parent. Preserve each relationship's meaning; explicitly reform any
   edge that does not meet that boundary. Cross-folder companion links can
   remain in owner prose; a directory-level relationship does not imply a
   relationship between its descendants.
3. Preserve SOE references by stable ID. Event replay must converge on the exact
   ordered Opening. Historical records retain `path` and optional description.
   Anchors retain `component`, exact `commit`, ordered `connections`, and optional
   description; their current path is derived, so remove duplicate `file` fields.
4. Keep only the current root keys: `format`, `adopted-release`, `components`,
   `relationship-types`, `relationships`, `anchor-connection-types`, `opening`,
   `evolve`, `historical-components`, and `anchors`. The format and components
   are required; omitted optional families are empty. Preserve each retained
   family's actual records rather than replacing them with empty defaults.
   Review removed groups, role vocabularies, legacy Actions, or Frontier
   records for project meaning that must be absorbed into current owners.
   Unresolved semantic choices require project-owner judgment, not silent
   deletion or an inferred conversion.
5. Once their meaning has a disposition, remove the authored `PROJECT_MAP.mmd`
   and old registries from the active carrier set and update project-local
   instructions or scripts that still treat them as authoritative. Mermaid
   is disposable generated output, never parsed input. Keep generated views
   outside managed registration.
6. Set `format: "2026-10-20"` and validate the complete candidate. The current
   Structuralist recipe and the public `docs/project-format.md` guide provide
   exact examples (`specs/02-project-format.md` is the development companion).
   Adapt them to existing project
   authority; do not overwrite a project's prose or SOE with the recipe.

## Validate and adopt

From the consuming project's root, using the selected updated executable:

```sh
mindflow check --json
mindflow version --json
mindflow status --json
mindflow topology probe --depth 1 --max-nodes 128 --mermaid
mindflow opening show --json
mindflow evolve events --offset 0 --limit 64 --json
mindflow anchor list
git diff --check
git diff
```

Check every Event page when history exceeds 64 entries, and inspect each
Anchor's exact commit and connections with `mindflow anchor show NAME`.
Compare retained IDs and bindings, relationship meanings, ordered Opening,
all Events, historical identities, Anchor commits/connections, and prose
against the preserved source. A passing structural check does not prove this
semantic conservation. Resolve every changed or removed reference deliberately.

If you built the optional desktop, open the adopted project in that synchronized
Mindflow application. CLI-only adoption does not require a desktop build.
Verify Structure, Opening cues, Timeline, and Reader access to exact content.
Use the version button beside the project tabs to verify Dev/Stable identity,
the serving core, project format, and adopted release separately. A different
adopted release is provenance to review, not proof of incompatibility.
Use Refresh to activate a newly synchronized build in an already-running
source-linked app. A project-only edit needs content Refresh, not an app rebuild.
SSH users must separately update the remote executable to a matching bridge;
local synchronization does not install it, and protocol mismatches fail.

Initialization creates only an empty manifest. Markdown sections remain
ordinary headings and links. Git continues to own byte history, including
exact evidence from projects whose old format is no longer loadable.

Review and commit the consuming project's adoption through its own ordinary
change process before using the new contract in other working environments.
This handoff does not announce a new published release or authorize
modifications to a consuming project.
