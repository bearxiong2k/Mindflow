# Tour this repository

This checkout's public guides form a small Mindflow Region. They are ordinary
files you can inspect directly; the root `MINDFLOW.yaml` selects the maintained
account. You do not need to copy the laboratory's document system to use it.

After [installing the CLI](../installation.md), run from the checkout root. If
you extracted a source archive, first initialize its Git worktree as described
in that guide:

```sh
mindflow check --json
mindflow topology probe --depth 1 --max-nodes 128 --mermaid
mindflow topology probe docs --depth 1 --max-nodes 128 --mermaid
```

The first command validates the complete Region. The probes show its selected
filesystem hierarchy and scoped relationships. Generated Mermaid is a view,
not another input file.

## Read the explanation behind the structure

```sh
mindflow topology read docs/semantics.md
mindflow topology read docs/project-format.md
mindflow topology neighbors docs/semantics.md --direction both --json
```

Read [semantics](../semantics.md), then follow its ordinary link to
[project format](../project-format.md). The relationship response contains only
explicit declarations; an empty result does not prevent ordinary document
navigation. Files that are visible on disk need not be registered components.

For complete orientation when you need it:

```sh
mindflow status --json
mindflow opening show --json
mindflow evolve events --json
mindflow anchor list
```

Opening, Events, or Anchors may be empty. This is a small public entrance, so
it does not invent release tasks or fictional history to fill every feature.
A project's own open concerns determine what belongs there.

## Inspect with the optional GUI

After the [local GUI build](../installation.md#optional-local-gui):

```sh
bin/mindflow-app .
```

Enter `docs` in Structure and open a guide in Reader. Compare the selected
Structure with the literal Files rail. Opening cues stay within Structure;
Evolve appears when Opening files, authored Events, or Anchors are present.
Region inspection shows the same validated account available through the CLI.

## Make a small example of your own

Follow [first use](../quick-start.md) in a new directory before adopting an
existing project. The goal is a useful bounded account, not the largest graph
or the most elaborate document hierarchy.
