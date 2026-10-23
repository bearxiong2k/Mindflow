# {{PROJECT_NAME}} Design Profiles

Status: Current design authority

## Role

Profiles own the durable purpose and design constraints that implementation and
later choices must preserve. They explain the underlying problem, make one
clear commitment, state negative boundaries, and provide tests for future
decisions.

## Authority map

| Profile | Owns |
| --- | --- |
| [Product](product.md) | Purpose, users, value, scope, non-goals, and tests for product decisions |
| [Architecture](architecture.md) | Durable system composition, authority boundaries, component responsibilities, and cross-component constraints |

These profiles are parallel authorities. Their reading order creates no
hierarchy. Exact interfaces, schemas, commands, algorithms, package layouts,
coverage inventories, and roadmaps belong to canonical documentation,
implementation, or steering.

When new purpose or design is still reforming, let it expand in the relevant
profile before demanding exact implementation form. As its consequences
stabilize, absorb them into canonical contracts and artifacts while retaining
only the durable insight and tests that remain authoritative here. Lower-level
evidence may justify an explicit profile reform but does not redefine one by
implication.

Repository-wide change routing is governed by
[governance/Documentation.md](../governance/Documentation.md). Exact implementation contracts are
indexed in [canonical_docs/README.md](../canonical_docs/README.md).
