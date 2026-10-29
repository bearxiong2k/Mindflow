# Current Practice Realization

Use the project's own vocabulary. The responsibility glossary is advisory;
Mindflow mechanics must agree with the installed version. The five patterns
supply judgment; this reference supplies the relevant operations.

## Mindflow operations

Before editing metadata, inspect the selected executable's public help and
version-linked documentation. This realization targets format `2026-10-27`.
Resolve a mismatch through authorized toolchain work or separately reviewed
manual adoption as needed. Do not invent commands, translate old carriers
automatically, or create a fallback map.

The filesystem supplies names, kinds, containment, and folder role context.
`MINDFLOW.yaml` selects entries explicitly by stable ID and exact path, with
optional descriptions/index markers, folder-local typed relationships, and SOE.
Selecting a directory does not select its descendants; necessary unregistered
ancestors remain context. Descriptions add useful orientation rather than
copying prose. Roles, names, kinds, and parents are not authored again.
`PROJECT_MAP.mmd`, when exported, is disposable generated output.

| Aspect | Meaning |
| --- | --- |
| Structure | The selected present account and its actual hierarchy, exact language, and authored relationships |
| Opening | An explicit ordered current selection of non-index Markdown component IDs |
| Evolve | Authored Event discussions and summaries, optional Opening-file transitions, maintained Anchors, and selected exact Git evidence |

Opening is independent of Event history. Discussion, activity, folder
membership, and agent plans never select it implicitly. An Event file may also
be in Opening when explicitly selected. A current Anchor document cannot.
Leaving Opening means neither completion nor deletion. An Anchor is a current
interpretive document tied to fixed Git evidence; exact historical selection
is request-local. Registration, historical identity, and exact Git bytes are
different things.

For a bounded folder question, start with `mindflow topology probe DIRECTORY
--depth 1 --max-nodes 128 --mermaid`. Use `topology read OWNER` for the exact
owner and follow its ordinary links. Use `mindflow status --json` only for
complete semantic orientation. Inspect other SOE views as the task needs them.

Authorized `mindflow init` creates an empty manifest, not a documentation
system or intent. Edit ordinary project files directly. Keep stable IDs on
moves, update exact bindings and affected links, and repair relationships and
SOE references together. Run `mindflow check --json` after semantic changes and
inspect the affected views and Git diff. Invalid bindings or references require
repair; do not hide them by dropping content.

Formal artifacts retain their ordinary tools and validators. Mindflow validates
declared structure, not the truth of the prose or the success of absorption.
Formalized meaning is sufficiently explicit to execute or check for a purpose;
unformalized meaning still needs situated judgment. These are kinds of
participation, not file types, quality ranks, or permanent stages. One artifact
may participate in both; repository visibility alone never selects the Region.
Procedures, execution, lifecycle judgments, and formalization levels remain
outside SOE. Unregistering a file and deleting it are separate actions.

## Responsibilities in ordinary files

These are functions that may share a file, not required directories or stages.

| Responsibility | What it keeps intelligible |
| --- | --- |
| Current owner | An accepted commitment, durable perspective, or exact contract |
| Event discussion | A developing question, alternatives, evidence, changed understanding, or decision |
| Summary Event | The meaning of a group of finer Events, including what remains unsettled |
| Steering | Continuing intent, the current edge, and where its results should be absorbed |
| Deferred question | A consequential protected choice, its safe boundary, and evidence that would justify revisiting it |
| Scaffold | Disposable coordination under a steering owner, with reciprocal prose links and an explicit disposition |
| Maintenance guidance | A reusable response to a demonstrated recurring pressure |

An Event need not be settled. A summary need not declare closure. An unanswered
question may remain in its discussion; give it a distinct deferred owner when
it needs a protected boundary and revisit condition. Steering keeps the current
direction readable without becoming a transcript or a second contract.

For a new standing owner, folder, or procedure, consider the distinct recurring
responsibility, why existing owners are insufficient, carrying cost, and when
to simplify it. This is not an admission ceremony for each registration,
relationship, or Event. A useful one-time development can deserve an Event.
Ordinary registrations and relationships need truthful scope and clear purpose,
not evidence of recurrence.

## Authoring Event discussions and summaries

### Preserve developing reasoning

Use an existing ordinary discussion file when possible. Write enough to explain
the question or pressure, meaningful alternatives, evidence and uncertainty,
and how understanding changed. These are useful prompts, not required headings.
A brief unresolved discussion is valid. Do not capture every conversation or
invent an outcome to make a record look complete.

Register the file as a non-index Markdown component and add
`{component: its_id}` to `evolve.events`. Keep all reasoning in the file; titles
come from filenames. No Event frontmatter, status, duplicated manifest prose,
date, commit, or Opening transition is required. When consequences are accepted,
update their current owners and link to them from the Event. Retain useful
reasoning without making it a competing rule.

### Summarize when a group has meaning

Add a summary when a reader benefits from seeing a shared question, a changed
interpretation, or the relationship between several developments before opening
their details. File count, age, or a desire to hide clutter is not sufficient.

Write a synthesis that explains the group's pressure, the meaningful
alternatives and evidence, what changed or remains contested, and where any
accepted consequences now live. Link to the finer discussions. Avoid merely
listing their titles or repeating a final conclusion.

Register the summary as another Event and add ordered `children` IDs to its
record. Children remain separately registered Events and may be summaries
themselves. Each Event has at most one parent; grouping is acyclic. Root order
follows the Event registry, child order follows the list. Grouping is a reading
structure, not causality, filesystem hierarchy, or exhaustive chronology.

Evolve folds the group's Events and recorded file transitions together; the
summary stays readable and expansion restores detail. The app keeps expansion
as personal presentation. Folding does not remove redundant obligations, resolve
contradictory claims, or absorb a decision into its owner.

### Consolidate only when the reasoning survives

Revising or regrouping Events is ordinary authoring; Git retains earlier bytes.
Keeping children for expansion is often sufficient. If consolidation or removal
is useful and authorized, first read the affected discussions and incoming
references. Preserve unique alternatives, evidence, reasons for changed views,
remaining uncertainty, and links to current consequences. Do not replace these
with an unexplained verdict.

Update prose links, the Event registry, parent `children`, registrations, and
any owned transitions coherently. Disposition children explicitly when removing
a summary. Review the diff for lost meaning; Git recovery does not make loss of
necessary present understanding acceptable.

### Record file transitions only when they happened

An Event may add
`opening: {predecessors: [old_id], successors: [new_id]}` when its discussion
records an actual change in open files. Either side may be empty; omit
`opening` when both are empty. A discussion or summary alone needs none.

Use current non-index Markdown IDs, or retain retired IDs and last-known
Markdown paths in root `historical-components`. These records neither register
a missing file nor select exact Git bytes. Do not give an ID both current and
historical registrations.

Review the full root/child flow: a parent's own transition applies once before
its children; a first predecessor may carry a file in from before the recorded
account; later predecessors must be open; a successor must not already be open
after predecessor removal. A summary composes its subtree's effect rather than
repeating child transitions. Never fabricate history to make the recorded end
equal current `opening.files`.

After authoring, run `mindflow check --json`, inspect
`mindflow evolve events --json` and affected Opening views, and read the exact
files. Structural validation alone cannot judge the quality of a summary.

## Checking navigable relationships

After constructing or reforming Structure:

1. Inspect the root with `mindflow topology probe --depth 1 --max-nodes 128
   --mermaid`, then the affected folders with the same bounded command and a
   directory address. Read hierarchy first and incident relationships next.
   Descend to relevant owners; a shallow or budget-limited sample is partial.
2. Follow consequential authority, evidence, and realization connections using
   `mindflow topology read OWNER` and exact prose links.
3. Author a relationship between peers in one folder only when their own
   meaning supports it. A coarse folder edge implies nothing about descendants.
   Keep exact cross-folder claims in prose when aggregation would overstate them.
4. Report consequential connections deliberately left in prose or unresolved
   when relevant to the task.

A valid hierarchy or successful lookup does not establish useful navigation.
There is no edge quota, connectedness target, automatic lifting, preferred
layout, or stored health result. A deliberate containment-only scope is valid.
