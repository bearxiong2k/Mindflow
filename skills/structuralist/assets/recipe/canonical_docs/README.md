# {{PROJECT_NAME}} Implementation Specification

Status: Canonical

## Role

Canonical documents are the implementation contract before and during
implementation. They define the observable behavior on which independent
conforming implementations must agree.

## Reading order

| Document | Responsibility |
| --- | --- |
| [system.md](system.md) | Current components, inputs, outputs, invariants, state lifetimes, invalidation, and failure behavior |

Read the owning profiles before changing this contract. Product purpose and
durable architecture remain in [profiles/](../profiles/README.md); current
implementation gaps remain in
[long-term steering](../long_term_steering/README.md).

Canonical prose contains no design history, roadmap, coverage inventory, or
replaceable algorithm snapshot. Code and direct tests realize this contract but
do not redefine it silently.

Canonical documents absorb settled consequences from the owning profiles and
steering. Once an exact consequence is carried here and realized by artifacts,
remove duplicate implementation obligation from its provisional source while
preserving governing rationale in the appropriate higher owner. Contradictory
implementation evidence must remain visible and pressure an explicit contract
or profile correction.
