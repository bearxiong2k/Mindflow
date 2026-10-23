# {{PROJECT_NAME}} Documentation System

Status: Normative repository process

## Purpose

This document governs how project meaning is owned, changed, reviewed,
absorbed, tightened, and removed. It governs documentation process rather than
product design or implementation behavior.

The document system is located by project function, not file format. Natural
language used as implementation or delivered output remains in the artifact
layer unless it also carries deliberate project-level authority. Do not use the
managed region as an inventory of textual artifacts.

## Layers

| Location | Owns | Must not become |
| --- | --- | --- |
| `governance/Documentation.md` | Documentation roles, routing, admission, absorption, and completion | Product profile or system specification |
| `profiles/` | Durable purpose, design boundaries, architecture, and tests for later choices | Command reference, roadmap, or history |
| `canonical_docs/` | Exact current implementation-facing contracts | Philosophy, rationale ledger, or active plan |
| Implementation, artifacts, and direct tests | Realized behavior, delivered output, and evidence | Project document-system membership merely because some artifacts use natural language |
| `long_term_steering/` | Current developing intents that must remain understandable across turns | A second specification or task log |
| `design_discussion/` | Focused reasoning behind accepted decisions | Current authority or unresolved-work tracker |
| `deferred_questions/` | Live protected choices with safe boundaries and revisit evidence | Backlog or optional idea list |
| `temp_scaffold/` | Disposable coordination owned by one steering direction | Durable state or archive |
| `trim_manual/` | Nonnormative procedures for recurring documentation drift | Current findings or repository policy |
| `AGENTS.md` | Concise operational entry for project agents | Duplicate design or governance manual |

Profiles govern canonical documents; canonical documents are realized by code
and direct tests. Steering tracks development toward those owners. Discussions
preserve accepted reasoning, while deferred questions preserve only choices
that genuinely cannot yet be resolved. Temporary scaffolds remain external to
the managed region and disappear after absorption or disposition.

This is a directional responsibility map rather than a total file hierarchy.
Durable profiles may remain abstract after their consequences reach exact
contracts and artifacts; peer profiles remain parallel; governance, guidance,
and evidence can cross several levels.

## Change routing

| Change | Route |
| --- | --- |
| Durable purpose, product boundary, philosophy, or architecture | Update the owning profile and record focused decision reasoning when the change is meaningful |
| Observable system behavior, input, output, invariant, lifetime, or failure | Update the owning canonical document with or before implementation |
| Implementation coverage without a semantic change | Update code and direct tests; update steering only when the current edge changes |
| Developing direction | Update one steering owner and its Mindflow Opening selection; retain an Event only for an important semantic transition |
| Accepted differential reasoning | Keep one focused design discussion pointing to the owner that absorbed it |
| Genuinely unresolved protected choice | Record its safe boundary and evidence-based revisit condition |
| Temporary plan, experiment, or review | Keep one disposable scaffold under one steering owner |
| Reusable response to a recurring drift pattern | Add a trim procedure after evidence of recurrence |
| Region topology or SOE change | Update ordinary files and `MINDFLOW.yaml` registrations, links, relationships, Opening, Events, historical identities, and Anchors together; regenerate views as needed |

## Ownership discipline

Every durable commitment has one current owner. A second document may explain
a different aspect or link to the owner, but it does not restate the same rule
with equal authority. Existing behavior is evidence, not permission to redefine
a profile or canonical contract silently.

Formalized participation is sufficiently closed under explicit semantics for a
purpose; unformalized participation still depends on situated interpretation
and judgment. These are not file types, quality ranks, or lifecycle stages.
The Mindflow Region is the bounded part of the unformalized layer maintained as
a whole.

Managed Markdown remains ordinary prose and contains no Mindflow metadata.
The filesystem owns names, entry types, and hierarchy. `MINDFLOW.yaml` owns
only explicit per-entry registrations with stable IDs and paths, optional short
descriptions/indexes, relationships and their vocabulary, and SOE records. A
folder's actual name supplies its role in its path context. Required unmanaged
ancestors remain context; selecting a folder does not register descendants.

Mermaid is generated from that account, never an authored Structure carrier.
Format `2026-10-20` has no legacy parser or compatibility template. Other projects adopt
it through a separately reviewed manual handoff. Opening remains an ordered
selection of document IDs; Evolve preserves Events, replay, historical IDs,
Anchors, and exact Git evidence. Consolidation creates no generic graph,
workflow, lifecycle, or formalization ledger.

Reusable procedure and agent execution remain outside SOE. Keep recurring
maintenance guidance in ordinary project files or provide an independent
practice when justified. Do not invent a fourth aspect or hidden invocation
state.

Git owns byte history. Mindflow's deterministic core validates declared
structure, while humans or replaceable semantic backends interpret prose and
perform authorized work. Generated views, layouts, conversations, selections,
and agent interpretations are not project authority. Useful
semantic results enter the project only through deliberate edits to an ordinary
owner; invocation state itself is not preserved.

## Evolution discipline

For genuinely new meaning or substantial reform, begin in the highest relevant
interpretive owner that can hold the uncertainty. Do not automatically choose
the broadest profile or demand an exact contract before the project's durable
interpretation is clear.

As consequences stabilize, absorb them into progressively more exact owners
and formal realizations. Keep durable purpose and rationale in their governing
owners. Let implementation, tests, use, and other evidence pressure explicit
upstream reform; existing behavior does not silently redefine profiles or
contracts.

After semantic conservation, narrow, recast, unregister, or remove provisional
residue, duplicate obligation, expired coordination, and misplaced realization
detail. Trimming closes absorption rather than optimizing word count, age, or
document count. Some meaning should remain interpretive, plural, evidential, or
unresolved when further formalization would not improve coherence.

An owner is structurally overloaded when meanings forced together require
independent authority, change cadence, audience treatment, disclosure, or
realization consequences. Preserve or clarify a crowded but coherent owner;
separate or reposition only meanings that need independent change, restore
their relations, and release duplicated obligation after conservation. Length,
density, or mismatch with this suggested structure does not decide the move.

## Admission and removal

Admit a durable file only when the present project needs its exact owner to
remain understandable. Do not create empty future modules or register every
natural-language file. First establish what the project produces or operates
and whether the candidate acts on the project, realizes an artifact, or
deliberately serves both roles.

Before adding a folder, owner, registration, relationship, SOE record, or
maintenance procedure, name the recurring pressure it resolves, its distinct
responsibility and authority, why an existing owner is insufficient, its
negative boundary, its exit or simplification condition, and its continuing
carrying cost. If those answers are weak, clarify or reuse an existing owner.
This recipe suggests several responsibilities. Omit unnecessary folders and
registrations rather than preserving them for symmetry. Use names to express
organization, short descriptions for orientation, and prose for governing rules.

Unregistration removes a document from the current Region but does not delete
it or declare it forgotten. Deletion is a separate ordinary file
operation. Git continues to retain exact earlier versions. Recall is a positive
selection for one concern; material not selected has no stored opposite state.

## Steering and temporary work

A steering plan states durable intent, a concise present account, one current
edge, and an absorption boundary. It changes when that account or edge changes,
not after every command. New pressure may expand here while its proper durable
or exact owners remain under interpretation; settled consequences must not stay
here merely because steering originated them.

A scaffold remains unregistered, names its steering owner, outcome,
next action, evidence gate, and deletion condition. Completion absorbs or
disposes of its result, removes its relationship, and deletes the scaffold.
Completed scaffolds are not archived.

## Completion contract

A documentation-affecting change is complete only when:

1. every changed meaning has one current owner;
2. affected profiles, canonical contracts, implementation, and tests agree;
3. steering reflects the remaining edge rather than completed chronology;
4. every scaffold is still explicitly live or has been removed after
   disposition;
5. required discussions and deferred records exist and no resolved question
   remains live;
6. settled consequences have reached their intended profiles, contracts, or
   artifacts, and provisional residue has an explicit disposition;
7. real paths, `MINDFLOW.yaml`, indexes, links, and generated views agree;
8. `mindflow check --json` is valid, `mindflow status --json` manifests the
   intended complete Region, and relevant topology and SOE views agree;
9. the complete Git diff is reviewable and preserves pre-existing work; and
10. no durable rule or unresolved choice survives only in a conversation,
   generated summary, or duplicated prose.

Tightening removes duplication and misplaced detail without weakening semantic
boundaries or suppressing necessary expansion. If the whole becomes difficult
to grasp, reconsider absorption, owners, registration, topology, and prose
rather than hiding scale behind retrieval or applying a word-count threshold.
