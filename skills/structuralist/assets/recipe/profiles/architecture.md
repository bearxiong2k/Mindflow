# {{PROJECT_NAME}} Architecture Profile

Status: Current design authority

Parallel profile: [Product](product.md)

## Purpose

This profile owns the durable system shape and authority boundaries that every
conforming implementation of {{PROJECT_NAME}} must preserve.

## System composition

{{SYSTEM_SUMMARY}}

Describe components by responsibility and authority rather than by replaceable
class, module, or directory names. State which component may create, persist,
derive, validate, or present each important kind of state.

## Authority and data flow

Identify the ordinary sources of truth, the direction in which derived state
flows, and the boundary at which invalid or partial state must remain visible.
No adapter, cache, generated view, model interpretation, or remote service may
silently become necessary to recover authoritative project state unless this
profile is deliberately changed.

## Durable constraints

- One fact has one authoritative owner.
- Derived views remain reproducible from their declared inputs.
- Component boundaries preserve failure and invalidation behavior.
- Persistence is introduced only for state that must survive process or agent
  lifetime.
- External integrations adapt the system without creating private semantics.

## Decision tests

A system change fits this profile only if:

1. authority remains recoverable without adapter-private state;
2. component responsibilities stay explicit and non-overlapping;
3. inputs, outputs, lifetime, invalidation, and failure can receive one
   canonical owner;
4. replaceable mechanisms remain outside this durable profile; and
5. product purpose remains governed by the parallel product profile.
