# Structuralist Recipe

## One comparison, at any project phase

This recipe illustrates developing reasoning, accepted meaning, and current
focus with few files. It is a comparison, not an adoption unit, document tree
requirement, or project lifecycle. Use existing owners and names when they work.
Consulting the recipe authorizes no mutation; inspect assets only when adapting
or materializing them is part of the request.

## Compact example

Fieldbook is a fictional project for reading field notes. Its example begins
during a browsing-design discussion, without claiming to reconstruct the
project's beginning.

```text
project.md                         current purpose and accepted behavior
evolve/
  browsing-question.md             an initially unresolved discussion
  browsing-evidence.md             a later observation and remaining uncertainty
  browsing-summary.md              synthesis linking the finer Events and owner
MINDFLOW.yaml                      selected files, current Opening, Event grouping
AGENTS.md                          concise reading and editing guidance
```

In the question, recent visits and place grouping are plausible alternatives.
The later evidence changes the choice without settling how to compare visits.
The summary explains why recent visits became the default and why place
grouping remains useful. Accepted browsing behavior lives in `project.md`;
the remaining comparison question stays in the evidence discussion. No
separate deferred-question register is needed yet.

The manifest registers all four documents. Evolve selects the three discussions,
with the summary naming the other two as ordered children. Current Opening
explicitly selects the evidence discussion because it carries the remaining
question. None of these Events claims an Opening-file transition.

This demonstrates three independent choices: what to maintain, what to keep
open now, and how to read the reasoning. One useful discussion would also be a
valid starting point; the three-file example exists to show summarization, not
to impose a minimum.

Use the [Event guidance](practice-realization.md#authoring-event-discussions-and-summaries)
for authoring, grouping, optional transitions, and conservation during removal.
Summarizing supplies a readable synthesis; folding preserves access to the
children. It does not by itself eliminate duplicate authority.

## Optional extensions

Introduce a responsibility when the project needs it, and separate files only
when their authority or change needs differ. These extensions can be combined,
renamed, or left within an existing owner.

| Pressure | Possible extension | What changes |
| --- | --- | --- |
| A continuing direction outlives individual discussions | `long_term_steering/` | Keep intent, present edge, and absorption destination; link Event reasoning |
| A durable perspective needs independent review | `profiles/` | Move the relevant purpose or design commitment from its current owner and leave a link |
| Exact implementation behavior needs its own change surface | `canonical_docs/` | Move the contract and link its governing perspective; keep rationale in Events |
| A consequential choice cannot safely be resolved yet | `deferred_questions/` | Give it a safe boundary and evidence-based revisit condition; link its discussion |
| Repeated coordination makes ownership rules hard to find | `governance/Documentation.md` | Own local routing and authority once; keep `AGENTS.md` a concise entry |
| A maintenance problem demonstrably recurs | `trim_manual/` | Preserve a reusable procedure, not current findings or a new product rule |
| One active investigation needs temporary coordination | A project-local scaffold | Keep it unregistered under a steering owner with reciprocal links; absorb results and delete both links with it |

The worked steering extension continues Fieldbook's visit-comparison question.
It adds one steering file and a truthful root relationship to `project.md`.
In this example current Opening moves from the evidence discussion to steering;
the earlier Events stay unchanged. This illustrates independent current focus,
not a missing historical transition that must be filled in.

The other rows are options, not empty folders to create in advance. A small
project can keep purpose and behavior together in `project.md` indefinitely.
A unique useful Event needs no recurring-pressure justification; adding a
standing documentation layer deserves stronger justification.

## Adapting the assets

The assets are a complete fictional worked example, not a placeholder template
or a record of the target project's past:

- `assets/recipe/compact/` is the independently valid example.
- `assets/recipe/extensions/steering/` contains one optional file plus
  `manifest-additions.yaml`, an illustrative fragment, not a loadable manifest.
  Its document path is relative to the target root.

Copy neither directory wholesale into an existing project. First map the
example's responsibilities to existing owners and inspect every proposed
destination. Reuse existing discussions in place where possible. Replace the
fictional purpose, evidence, decisions, and current question with supported
local meaning; omit any Event the target does not need. Never manufacture
history or a decision merely to fill the example.

For an isolated demonstration, copy only `compact/` to an empty target and
initialize Git there. For the optional extension, place its steering file at
the matching relative path, merge the fragment's components and relationship
definitions, and append its relationship. Explicitly choose current Opening:
the worked extension replaces the compact selection with the fragment's list.
Do not replace a real project's whole manifest or infer this selection for it.

For real adoption, preserve stable IDs for existing entries and reconcile paths,
links, relationships, Event references, and Opening with the chosen meaning.
Register only what the project intends to maintain. Relationships obey actual
folder locality; finer cross-folder claims remain ordinary prose links.
Keep the result understandable without Structuralist installed.

Require a format `2026-10-27` executable. Validate the complete adapted Region,
Opening and Evolve views, follow the
[navigation review](practice-realization.md#checking-navigable-relationships),
and review exact prose and the diff. Mermaid may be generated afterward; it is
never a second authored carrier. Earlier formats require a separately reviewed
manual adoption.
