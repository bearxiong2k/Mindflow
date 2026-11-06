# Structuralist Recipe

## One comparison, at any project phase

This recipe illustrates one project choosing work, learning from it, and
absorbing its consequences with few files. The project's own maintained
practice determines how it develops. The worked cycle is one local choice,
not an adoption unit, document tree requirement, or project lifecycle.
Use existing owners and names when they work. Consulting the recipe authorizes
no mutation; inspect assets only when adapting or materializing them is part of
the request.

## Compact example

Fieldbook is a fictional project for reading field notes. The example captures
one completed browsing-design cycle with a remaining comparison question. Its
work and observations are illustrative, not evidence about a real application.

```text
project.md                         current purpose, behavior, and working practice
evidence/browsing-walkthrough.md    worked observation, conditions, and limits
evolve/
  browsing-question.md             an initially unresolved discussion
  browsing-evidence.md             a later observation and remaining uncertainty
  browsing-summary.md              synthesis linking the finer Events and owner
MINDFLOW.yaml                      selected files, current Opening, Event grouping
AGENTS.md                          concise reading and editing guidance
```

### One completed cycle

The table describes this fictional history. It is not a sequence to apply to
every task or a claim that development must begin with a discussion.

| What happened in Fieldbook | Where the result lives |
| --- | --- |
| The browsing question compared a recent-visits list with place grouping. The local task was to choose a default while preserving access to every note; a paper walkthrough was sufficient to begin | `browsing-question.md` retains the alternatives and starting assumptions |
| Two paper layouts were walked through using the same four note cards. Returning to the latest visit favored recency; comparing conflicting observations still required reading both notes | `evidence/browsing-walkthrough.md` retains the inputs, procedure, observations, and limits; the temporary comparison worksheet is no longer needed |
| The project accepted recent visits with a place filter. It also refined its working practice: judge the complete reading task and preservation of differences, rather than navigation effort alone | `project.md` owns the behavior and current local practice; the evidence does not claim implementation, measured usability, or performance |
| The interpretation changed from choosing one organization for every purpose to distinguishing resumption from comparison | `browsing-evidence.md` explains that change; `browsing-summary.md` synthesizes it and links the current owner and finer Events |
| The bounded default-view choice ended. Comparing visits remains open, with conflicting observations as a useful next test if that work is selected | The question stays in `browsing-evidence.md`; Opening explicitly selects it, without scheduling another task |

This completes the selected design work, including a changed local method and
the removal of temporary coordination after its useful content is preserved.
It does not claim a completed implementation or product. The evidence account
keeps observations apart from the Event's interpretation and the owner's
accepted behavior. No separate deferred-question register is needed yet.

The manifest registers the five maintained documents. Evolve selects the three
discussions, with the summary naming the other two as ordered children. Current Opening
explicitly selects the evidence discussion because it carries the remaining
question. None of these Events claims an Opening-file transition.

This demonstrates three independent choices: what to maintain, what to keep
open now, and how to read the reasoning. One useful discussion would also be a
valid starting point; the three Event files illustrate summarization, not
to impose a minimum.

### Adapt to the situation

The transferable lesson is to connect work, evidence, interpretation, and
project-owned consequences. The sequence and carriers remain local choices.
Fieldbook could repair a broken filter directly against its accepted behavior,
using focused checks without a new Event or steer. A later inquiry into what
field researchers need could reopen its purpose and require different evidence.
An operational project could organize around restoration and review instead.
The responsible local guidance determines that practice and may itself be
revised. None of these situations needs to imitate the paper walkthrough or
complete every movement in its cycle.

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
| A durable perspective needs independent review | `profiles/` | Explain its question, causal argument, and tradeoffs for the intended reader; move the commitment and leave a link |
| Readable behavior needs its own change surface | `canonical_docs/` | Move the semantic contract and link its governing perspective; keep rationale in Events |
| Mechanical detail interrupts that explanation | A subordinate specification | Separate exact schemas or procedures while preserving their governing contract |
| Evidence needs independent maintenance or reuse | An evidence account | Preserve conditions, observations, checks, and claim limits beside their actual artifacts |
| A consequential choice cannot safely be resolved yet | `deferred_questions/` | Give it a safe boundary and evidence-based revisit condition; link its discussion |
| Repeated coordination makes ownership rules hard to find | `governance/Documentation.md` | Own local routing and authority once; keep `AGENTS.md` a concise entry |
| A maintenance problem demonstrably recurs | `trim_manual/` | Preserve a reusable procedure, not current findings or a new product rule |
| One active task needs temporary coordination | A project-local scaffold | Keep its purpose, accountable context, and disposal condition clear; follow local linking rules and absorb results before removal |

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
