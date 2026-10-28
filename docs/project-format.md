# Project format

Format **`2026-10-27`** uses one authored metadata carrier, `MINDFLOW.yaml`,
inside a Git worktree. Ordinary files own content; the filesystem owns names,
entry kinds, and hierarchy. [Semantics](semantics.md) explains their meaning.

## Empty Region

`mindflow init` writes this empty carrier for release `2026.10.27`:

```yaml
format: "2026-10-27"
adopted-release: "2026.10.27"
components: {}
relationship-types: {}
relationships: []
anchor-connection-types: {}
opening:
  files: []
evolve:
  events: []
anchors: {}
```

`format` and `components` are required. The other families, including the
optional `historical-components` map, default to empty. `adopted-release` may be
absent when adoption is unknown. The format is a fixed schema identifier, not
today's date. The adopted release records an explicit project decision and is
not changed by launching another executable.

## A small connected example

First write ordinary Markdown files at `README.md`, `docs/design.md`,
`docs/next.md`, `events/design-review.md`, and `events/try-the-next-idea.md`.
The two Event files contain a summary and its finer discussion. This is a
complete manifest over those files:

```yaml
format: "2026-10-27"
adopted-release: "2026.10.27"
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
  design_review:
    path: events/design-review.md
  next_idea:
    path: events/try-the-next-idea.md
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
    - component: design_review
      children: [next_idea]
    - component: next_idea
      opening:
        successors: [next]
```

`docs` and `events` appear as necessary navigation context without being
registered. The relationship joins registered peers in `docs`. The summary
contains the finer Event, whose optional transition introduces `next` to the
recorded file flow. These paths are examples, not a required folder layout.
Current Opening can be maintained independently of the recorded flow.

## Records and constraints

| Record | Fields and boundary |
| --- | --- |
| Component | Stable ID mapped to required `path`, optional nonempty `description`, and optional Markdown-only `index: true`. |
| Relationship type | Exact project phrase with nonempty `description` and `direction: directional`, `bidirectional`, or `either`. |
| Relationship | `source`, `type`, `direction`, `target`; endpoints are distinct registered IDs with the same actual immediate parent. |
| Opening | Ordered, distinct `files` IDs for current non-index Markdown documents outside Anchors. |
| Event | Unique `component` selecting a current non-index Markdown file; optional ordered `children` and optional `opening` transition. |
| Event transition | `predecessors` and `successors`, each defaulting to `[]`; at least one side is nonempty. |
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

## Event discussions, summaries, and file flow

Reasoning stays in the Event's Markdown file; its title comes from the filename.
Every child must also occur once in the Event registry. Each Event has at most
one parent, with no cycles or repeated children. Roots follow registry order;
children follow the parent's list. At most 4096 Events and 32 hierarchy levels
are supported. Grouping does not change filesystem containment.

A discussion can omit `opening` entirely. When present, each side of its
transition contains distinct current non-index Markdown IDs or explicit
historical IDs. An ID may appear on both sides for continuity. Transitions run
in depth-first reading order, applying a parent's transition before its children.
The first predecessor reference carries a file in from before the selected
account; the first successor reference introduces it. Subsequent predecessors
must be open. Remove predecessors before adding successors, which must not
already be open after removal.

The recorded end does **not** have to equal `opening.files`. Current Opening may
be nonempty with no Events. If a participant loses current registration while
retained transitions still reference it, keep its ID under `historical-components`.
That map does not load missing files or identify exact Git bytes.

An Anchor component is a current non-index Markdown document outside Opening.
Its connection targets are normalized paths at its stored commit, not current
component IDs. Use the [CLI](cli.md) to resolve and create an Anchor after
preparing its document and vocabulary.

## Adoption and ordinary files

Format `2026-10-20` Events used named junction records. For this release, write
or select ordinary discussion files, register their IDs, and replace those
records with `component` entries. Move retained transition metadata beneath
`opening`; preserve useful reasoning in Markdown and review any grouping.
Simply changing the format header is not a conversion. Run
`mindflow update-handoff` for the complete manual procedure, including older
`0.1.0` projects. Installation does not perform this adoption.

There is no `.mindthese` registry, authored Mermaid carrier, role vocabulary,
stored layout, or inferred workflow state in this format. Markdown headings
and links remain normal document navigation. Generated Mermaid is disposable.

Unknown fields, duplicate YAML keys, aliases, merge keys, tags, and multiple
YAML documents are rejected. Run `mindflow check --json` after semantic edits.
Other format versions fail explicitly.
