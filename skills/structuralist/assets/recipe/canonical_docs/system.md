# {{PROJECT_NAME}} System Contract

Status: Canonical

Index: [{{PROJECT_NAME}} Implementation Specification](README.md)

## Role

This document owns the current implementation-facing contract for the system
composition governed by the
[Architecture Profile](../profiles/architecture.md).

## Components and responsibilities

{{COMPONENT_CONTRACTS}}

For each component, state its accepted inputs, produced outputs, authoritative
dependencies, derived state, and forbidden responsibilities. Use exact project
language and stable interface names only where independent implementations must
agree.

## State and lifetime

Identify which state is persistent, process-local, request-local, generated, or
external. State how each derived value is invalidated and reconstructed. Do not
promote a cache, view, conversation, or interpretation into authority by
omission.

## Validation and failure

Define the validity gate for each public operation. Invalid input must fail
explicitly rather than becoming a smaller apparently valid result. Specify
diagnostics, partial-output behavior, and recovery boundaries at implementable
granularity.

## Compatibility boundary

State the exact formats and interfaces whose compatibility is promised now.
Anything not specified here remains unsupported rather than implicitly stable.

## Verification

Direct tests must cover successful formation, invalid input, boundary
conditions, state invalidation, and the typed negative behavior declared above.
Coverage reports and current source inventories remain implementation evidence,
not part of this contract.
