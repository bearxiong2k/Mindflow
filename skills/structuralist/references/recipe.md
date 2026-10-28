# Structuralist Recipe

## Role

Use this recipe when one coherent realization of Structuralist's current
practice would help a project understand or change its document system. It is
lifecycle-neutral: a new, established, migrating, drifting, or refactoring
project may consult it without being treated as if it were starting over.

The recipe is a reference, not a target architecture, adoption unit, maturity
stage, or required sequence. Comparing a project with it authorizes no change.
A project may reuse none, some, or all of its responsibilities and may realize
them through different vocabulary, files, or relations.

`assets/recipe/` is an optional materialization of the recipe. Do not inspect or
copy those files merely because the reference is useful.

## Candidate responsibilities

| Recipe element | Possible responsibility |
| --- | --- |
| `AGENTS.md` | Concise local reading, editing, review, and validation guidance |
| `governance/Documentation.md` | Documentation-system governance |
| Ordinary folders and files | Names, containment, role context, exact prose, and ordinary navigation |
| `MINDFLOW.yaml` | Explicit registrations, stable IDs and paths, optional descriptions/indexes, relationships, and SOE records |
| Generated Mermaid | Disposable visualization of the selected filesystem structure and relationships |
| `profiles/` | Durable perspectives |
| `canonical_docs/` | Current implementation-facing meaning |
| `long_term_steering/` | Developing direction |
| `deferred_questions/` | Protected unresolved choices |
| `evolve/` | Event discussions and authored summaries |
| `trim_manual/` | Reusable maintenance guidance |

These are possible responsibilities, not evidence that the target needs every
element or that one element must own only one responsibility.
Choose understandable folder and file names for those responsibilities. A
managed folder's actual name supplies its role in its path context. This
recipe's vocabulary is optional; it creates no role glossary, aliases, defaults,
or overrides. A short description adds scope or contribution when the name
alone is insufficient.

## Possible responsibility gradient

The recipe can make one expansion–absorption direction legible without turning
its directories into levels:

| Evolutionary tendency | Possible responsibility |
| --- | --- |
| Open developing pressure | `long_term_steering/`, `deferred_questions/`, or a project-local temporary scaffold |
| Durable interpretation | `profiles/` |
| Exact current commitment | `canonical_docs/` |
| Formal realization and direct evidence | Project implementation, artifacts, and tests outside the recipe |
| Retained decision evidence | `evolve/`, with links to current owners when consequences settle |
| Cross-gradient governance and working invariants | `governance/Documentation.md` and concise `AGENTS.md` guidance |
| Reusable project-specific maintenance experience | `trim_manual/` |
| Minimal Structure and SOE metadata | `MINDFLOW.yaml` over the ordinary filesystem; generated views |

This is a partial order of responsibilities, not a universal pipeline. A
consequence may move from open pressure to a durable perspective, exact
contract, and artifact while its originating purpose remains authoritative.
Evidence can pressure a higher interpretation without silently replacing it.
Some responsibilities remain peer, cross-cutting, unresolved, or unnecessary.

## Consulting the recipe

- Locate the target project's document-system and artifact boundaries before
  comparison.
- Understand responsibilities and pressures before choosing names. Use
  coherent existing folder and file names as the visible organization; improve
  unclear naming when the task authorizes it. Do not hide a mismatch behind a
  second role assignment.
- Use the recipe to notice missing, overloaded, duplicated, or unnecessary
  responsibilities, then select only movements justified by the task. An owner
  is overloaded only when meanings need independent authority or change
  surfaces, not because it is long, dense, or combines roles separated here.
- For genuinely new meaning, identify the highest relevant open owner rather
  than automatically choosing the broadest profile. As consequences stabilize,
  check whether more exact owners and artifacts carry them.
- Treat trimming as post-absorption conservation: retain governing insight,
  evidence, and live uncertainty; release duplicated obligation, expired
  coordination, and misplaced realization detail.
- Preserve deliberate combinations and departures. A comparison may conclude
  that the current system should remain unchanged.
- Do not infer adoption, initialization, or permission to mutate from the act
  of consulting this reference.

## Optional materialization

The assets target format `2026-10-27` only. Confirm that the selected executable supports
the single-manifest contract before claiming a valid materialization. Earlier
projects require a separately reviewed manual adoption; no fallback carrier or
automatic converter is included.

Inspect `assets/recipe/` only when the requested work calls for adapting exact
reusable files. Materialization may occur at any project phase and may use any
subset that remains coherent after adaptation.

- Inspect every prospective destination and preserve existing meaning and
  unrelated changes.
- Omit, merge, rename, or relocate material to fit the target rather than
  making the target conform to the asset.
- Replace every retained template token with substantive local prose. Preserve
  real uncertainty instead of fabricating an answer.
- Register only entries worth maintaining. A record's presence is the managed
  switch; selecting a directory does not select its descendants. Required
  unregistered ancestors remain navigational context.
- Keep one path per stable ID, with only useful descriptions and explicit index
  markers. Let disk supply names, entry kinds, containment, and folder roles.
  Update path bindings and ordinary links together on a move; preserve IDs and
  deliberately repair affected relationships and SOE references.
- Reconcile folder-local relationships, Opening, Event discussions and summary groups,
  any retained transition participants and historical identities,
  and Anchors with the actual document system. Preserve relationship vocabulary
  where it adds meaning beyond placement. Keep procedure in ordinary guidance.
- Generate Mermaid after validating the result; do not maintain or round-trip a
  second tree in `PROJECT_MAP.mmd`. A saved diagram is optional output.
- Validate the complete result, perform the
  [navigation review](practice-realization.md#checking-navigable-relationships),
  and review the diff. Adapting the manifest includes reading its authored relationships alongside
  the actual folders and document templates. Reconcile
  those relationships with local meaning instead of copying or dropping them
  by default.

Materialized output contains none of these tokens:

- `{{PROJECT_NAME}}`
- `{{PROJECT_PURPOSE}}`
- `{{PROJECT_USERS}}`
- `{{PROJECT_BOUNDARY}}`
- `{{SYSTEM_SUMMARY}}`
- `{{COMPONENT_CONTRACTS}}`
- `{{CURRENT_DEVELOPMENT_EDGE}}`

The resulting project must remain intelligible without the recipe or
Structuralist being installed.
