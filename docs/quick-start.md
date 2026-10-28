# First use

Install the [CLI](installation.md) and try the [repository tour](tutorial/README.md)
first. Adopting Mindflow is a project change you choose; installing an executable
or a skill does not perform it.

## A minimal example

In a new directory, create an ordinary Git project and one document:

```sh
mkdir mindflow-example
cd mindflow-example
git init
printf '# Example project\n\nKeep one useful project account understandable.\n' > README.md
mindflow init
```

`init` creates an empty `MINDFLOW.yaml`. It creates no document tree and does
not register existing files. Replace its empty `components` mapping with:

```yaml
components:
  overview:
    path: README.md
    index: true
```

Keep the generated format and release fields. Then inspect the result:

```sh
mindflow check --json
mindflow topology probe --depth 1 --max-nodes 128 --mermaid
mindflow topology read overview
```

You now have one explicitly selected document. Opening and Evolve can remain
empty. Add other registrations or relationships only when they help explain
this project; [Project format](project-format.md) gives a small connected example.

## Adopting an existing project

Start from its existing files, local instructions, and Git state. Preserve
unrelated work. Choose the bounded set of open meaning that someone can maintain
and understand together. Ordinary folders supply hierarchy; a folder
registration does not register its descendants.

For a project without a manifest, `mindflow init` creates the empty carrier in
its Git worktree. Edit `MINDFLOW.yaml` and ordinary documents directly, then run
`mindflow check --json` and review the diff. No skill is required.

If you install [Structuralist](structuralist.md), an explicit request can combine
method selection with a clearly bounded authorization:

> Use $structuralist to understand this project and adopt the smallest useful
> Mindflow Region in its existing natural-language system. Preserve local
> authority and unrelated changes. You may edit the selected documentation and
> MINDFLOW.yaml; justify additions, validate the result, and show the diff.

The included recipe is optional. Do not copy its entire document tree merely
because it is available. Existing owners may already provide the right shape.

Review whether each registration and relationship is useful, whether project
language remains accurate, and whether open concerns have been selected
explicitly. Validation checks structure; it cannot decide that a design claim
or an agent's judgment is correct.

## Record a discussion when useful

Write the discussion in an ordinary Markdown file, register its stable component
ID, and select that ID in `evolve.events`. A summary can list finer Event IDs as
its `children`; an optional `opening` record adds explicit file transitions.
See the complete example in [Project format](project-format.md). No Event is
required merely because you edited a file or changed current Opening.

## Continuing work

For a bounded question, begin with a directory probe, then read its owners and
follow their ordinary links. Use `status --json` when you need a complete Region
index. Use Git and normal file tools for edits and history, and validate after
semantic changes.

For a project using an older format, including the `0.1.0` preview, begin with
`mindflow update-handoff`. Adoption is manual and reviewed; changing an old
format header alone is not a conversion.
