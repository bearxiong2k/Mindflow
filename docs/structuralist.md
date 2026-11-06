# Structuralist

Structuralist is Mindflow's optional, explicitly invoked methodology for
understanding and evolving a project's natural-language system. It first
locates that system within the wider project, then helps an agent reason about
owners, distinctions, relationships, perspectives, history, and transformation.

It complements Evolve's authored historical record. It does not predict the
future, store plans in SOE, run continuously, or become a new project authority.
Core, CLI, and GUI work without it.

## Install the complete package

The [2026.11.6-r1 prerelease](https://github.com/bearxiong2k/Mindflow/releases/tag/v2026.11.6-r1) includes the complete package
in its source and offers a separate skill archive:

```text
skills/structuralist/
├── SKILL.md
├── agents/openai.yaml
├── references/
│   ├── patterns/
│   ├── practice-realization.md
│   └── recipe.md
└── assets/recipe/
    ├── compact/
    └── extensions/
```

With Python 3, run from this source checkout:

```sh
./distribution/install-structuralist.sh
./distribution/install-structuralist.sh --check
```

The default destination is `~/.agents/skills/structuralist`. Codex supports
user skills under `~/.agents/skills` and explicit `$skill` invocation; this
package disables implicit invocation. See the official
[skill documentation](https://learn.chatgpt.com/docs/build-skills).

The installer refuses any existing destination. Inspect an existing copy before
moving it aside; `--check` verifies that all installed files match this source.
For another agent, copy the whole package into its supported skill location or
pass the exact destination to the installer:

```sh
./distribution/install-structuralist.sh /path/to/agent/skills/structuralist
```

For the separate skill archive, extract it and enter `structuralist-2026.11.6-r1/`.
Run the same `./distribution/install-structuralist.sh` and `--check` commands
there. The archive includes its installer and license notices. For manual
installation, copy its complete `skills/structuralist/` directory into your
agent's skill location, preserving any existing installation.

Confirm that the agent discovers the skill. If it does not appear, refresh or
restart the agent. Installing the package changes future agent capability only;
it does not initialize, register, or edit a consuming project.

## Invoke it with a clear scope

For inspection:

> Use $structuralist to understand this project's natural-language system.
> Identify its current owners and concrete maintenance pressures. Do not edit
> files.

For an authorized change:

> Use $structuralist to resolve the duplicated guidance in these two documents.
> Preserve unique meaning and project authority, make the smallest useful edits,
> and show the resulting diff and validation.

Method selection does not itself authorize every possible project change.
State the project, intended outcome, and editing scope. Ordinary project
instructions and human decisions remain authoritative afterward.

## Recipe and adoption

The five patterns remain distinction, position and relation, perspective,
temporality, and transformation. The guidance loads only what the task needs;
ordinary Event authoring can go directly to its focused instructions.

Events preserve developing questions, alternatives, evidence, and decisions.
A summary explains how finer Events belong together and what remains open;
accepted commitments stay with current owners. Folding retains access to
reasoning. Consolidating or removing it requires preserving meaningful evidence
and uncertainty, not merely hiding detail.

The project's maintained guidance determines goals, methods, evidence, and
stopping conditions. Structuralist helps an agent follow and, when requested,
revise that practice. A repair, exploratory inquiry, or operational problem can
use different methods and need no new Event, continuing steer, or scaffold.

The [recipe](../skills/structuralist/references/recipe.md), **A Working Guide to
Project Documentation**, gives the maintainer's preferred defaults for
ownership, authority, change routing, writing, evidence, and completion. Its
Mermaid Structure map shows the suggested folders, files, and relationships.
Project-local design and maintained guidance take priority; adopted rules
belong in the project's own documentation. Responsibilities can share files.

The [compact Fieldbook example](../skills/structuralist/assets/recipe/compact/project.md)
illustrates the guide through one bounded design cycle: a question, a paper walkthrough,
changed understanding, accepted behavior and revised local practice, a summary,
and remaining uncertainty. Its separate evidence account preserves observations
and limits; Events interpret them and link consequences to their current owners.
This fictional design exercise does not claim a working implementation or
measured user outcomes. Its sequence is an example to adapt to the project's
situation.

The optional steering extension shows how a continuing concern can move into
current Opening without changing Event history. Use the guide's ownership and
change-routing rules to decide when a responsibility needs a separate owner.

Use existing owners before adding files. These are fictional examples to adapt,
not history to copy into a project. A small project may need only a few selected
documents and no Opening or Event history yet.

[First use](quick-start.md) separates CLI setup, skill installation, and project
adoption. The current format uses one manifest and filesystem-derived hierarchy.
For an older project, read `mindflow update-handoff` before authorizing manual
adoption. The frozen `integrate-mindflow` package from `0.1.0` is historical and
is not an alias for Structuralist or part of this current package.

Uninstalling the skill leaves adopted project files intact. Accepted results
must remain understandable without the skill, its invocation, or private agent
context.
