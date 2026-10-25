# Project format

Format **`2026-10-20`** uses one authored metadata carrier, `MINDFLOW.yaml`,
inside a Git worktree. Ordinary files own content; the filesystem owns names,
entry kinds, and hierarchy. [Semantics](semantics.md) explains their meaning.

## Empty Region

`mindflow init` writes this empty carrier for release `2026.10.25`:

```yaml
format: "2026-10-20"
adopted-release: "2026.10.25"
components: {}
relationship-types: {}
relationships: []
anchor-connection-types: {}
opening:
  files: []
evolve:
  events: []
historical-components: {}
anchors: {}
```

`format` and `components` are required. The other families default to empty;
`adopted-release` may be absent when adoption is unknown. The format is a fixed
schema identifier, not today's date. The adopted release records an explicit
project decision and is not changed by launching another executable.

## A small connected example

If `README.md`, `docs/design.md`, and `docs/next.md` already exist, this is a
complete manifest:

```yaml
format: "2026-10-20"
adopted-release: "2026.10.25"
components:
  overview:
    path: README.md
    index: true
  design:
    path: docs/design.md
    description: The current design contract.
  next:
    path: docs/next.md
    description: The next question the project wants to resolve.
relationship-types:
  guides:
    description: The source supplies constraints for the target.
    direction: directional
relationships:
  - source: design
    type: guides
    direction: source-to-target
    target: next
opening:
  files: [next]
evolve:
  events:
    - name: open-next-question
      predecessors: []
      successors: [next]
```

Here `docs` appears as necessary navigation context without being registered.
The relationship joins two registered peers in that folder. The Event opens
exactly the document named in Opening.

## Records and constraints

| Record | Fields and boundary |
| --- | --- |
| Component | Stable ID mapped to required `path`, optional nonempty `description`, and optional Markdown-only `index: true`. |
| Relationship type | Exact project phrase with nonempty `description` and `direction: directional`, `bidirectional`, or `either`. |
| Relationship | `source`, `type`, `direction`, `target`; endpoints are distinct registered IDs with the same actual immediate parent. |
| Opening | Ordered, distinct `files` IDs for current non-index Markdown documents outside Anchors. |
| Event | Unique `name`, optional `description`, ordered `predecessors` and `successors`; at least one side is nonempty. |
| Historical component | Former ID mapped to last-known Markdown `path` and optional `description`; it cannot also be current. |
| Anchor connection type | Exact project phrase with a nonempty `description`. |
| Anchor | Unique name mapped to current `component`, full resolved `commit`, optional `description`, and ordered `connections` of `{type, target}`. |

Component IDs match `[A-Za-z][A-Za-z0-9_-]*`. Paths are unique, normalized,
root-relative paths; `.` can register the root. Paths must exist and be
Git-visible rather than ignored. Symbolic links are not registered targets.
Registration is per entry: a registered directory does not include its children.
Markdown paths end in `.md`; other regular files remain coarse targets.

Relationship direction is `source-to-target` or `bidirectional` and must satisfy
its type. Duplicate relationships are invalid. Use ordinary Markdown links for
cross-folder references instead of inventing cross-folder semantic edges.

Event replay starts empty. Each Event removes its currently open predecessors
and appends its successors without duplication. The final ordered selection
must equal `opening.files`. If a participant leaves current registration while
history still references it, retain its ID under `historical-components`.

An Anchor component is a current non-index Markdown document outside Opening.
Its connection targets are normalized paths at its stored commit, not current
component IDs. Use the [CLI](cli.md) to resolve and create an Anchor after
preparing its document and vocabulary.

## Ordinary files remain ordinary

There is no `.mindthese` registry, authored Mermaid carrier, role vocabulary,
group registry, stored layout, or inferred workflow state in this format.
Markdown headings and links remain normal document navigation. Save generated
Mermaid wherever useful; editing or deleting it changes no Mindflow meaning.

Unknown fields, duplicate YAML keys, aliases, merge keys, tags, and multiple
YAML documents are rejected. Run `mindflow check --json` after semantic edits.
Other format versions fail explicitly. Use `mindflow update-handoff` for manual
adoption from the historical `0.1.0` preview or another older project.
