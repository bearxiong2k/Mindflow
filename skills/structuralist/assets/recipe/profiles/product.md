# {{PROJECT_NAME}} Product Profile

Status: Current design authority

Parallel profile: [Architecture](architecture.md)

## Purpose

{{PROJECT_PURPOSE}}

## Responsible users

{{PROJECT_USERS}}

## Durable value

State here which persistent user or project problem {{PROJECT_NAME}} resolves,
why that problem matters beyond one implementation, and what observable result
would count as meaningful value. Keep the claim narrower than available
evidence and distinguish preview intent from proven general benefit.

## Product boundary

{{PROJECT_BOUNDARY}}

Identify adjacent systems the project complements but does not own. A future
feature belongs only when it strengthens the stated purpose without introducing
a second authority, hidden dependency, or recovery surface outside the project.

## Decision tests

A product change fits this profile only if:

1. it serves the stated responsible users and durable purpose;
2. its benefit can be evaluated without redefining implementation activity as
   product value;
3. it preserves the explicit non-goals and authority boundary;
4. a later implementation can change without rewriting the purpose; and
5. any stronger public claim is supported by evidence rather than aspiration.
