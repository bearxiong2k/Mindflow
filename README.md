# Mindflow

Mindflow helps people and agents understand and maintain a project's open
meaning alongside ordinary files and Git. It selects useful files and folders,
keeps their names and hierarchy grounded in the filesystem, and adds stable
identities, sparse relationships, and an explicit account of what remains open.

**[2026.10.25 source beta](https://github.com/bearxiong2k/Mindflow/releases/tag/v2026.10.25)** is a GitHub prerelease.
It includes source and the optional Structuralist skill; no packaged macOS
download is required.

## What it provides

- **Structure:** selected files and folders, their actual hierarchy, and
  project-authored relationships.
- **Opening:** the ordered selection of documents carrying current open
  concerns.
- **Evolve:** authored Events, maintained Anchors, and explicitly selected Git
  evidence that make meaningful change revisitable.

The Rust Core validates this account. The CLI exposes it for precise inspection
and agent work. An optional Tauri GUI provides spatial navigation and exact
reading. **Structuralist**, included as a complete optional skill, helps an
explicitly instructed agent understand and evolve the project's natural-language
system. It creates no background process or additional project state.

## Try the CLI

With Git and the Rust build prerequisites in [Installation](docs/installation.md):

```sh
git clone --branch v2026.10.25 https://github.com/bearxiong2k/Mindflow.git
cd Mindflow
cargo install --locked --path . --bin mindflow
mindflow --version
if [ ! -e .git ]; then git init; fi
mindflow check --json
mindflow topology probe docs --depth 1 --max-nodes 128 --mermaid
mindflow topology read docs/semantics.md
```

You can also download the [source archive](https://github.com/bearxiong2k/Mindflow/archive/refs/tags/v2026.10.25.tar.gz) or choose
source and skill assets from the [prerelease](https://github.com/bearxiong2k/Mindflow/releases/tag/v2026.10.25). From an extracted source
root, start at `cargo install` above. The conditional command creates the Git
worktree needed to inspect its bundled Region; it leaves an existing `.git`
entry untouched. Cargo installation itself does not require Git history.

The repository's own public guides form a small example Region. Start with the
[repository tour](docs/tutorial/README.md), then [first use](docs/quick-start.md)
to adopt Mindflow in a project you choose. [Installation](docs/installation.md)
covers prerequisites, the optional local GUI build, and updates.

## Add Structuralist to your agent

From this source checkout, with Python 3 available:

```sh
./distribution/install-structuralist.sh
./distribution/install-structuralist.sh --check
```

The installer copies the complete package to `~/.agents/skills/structuralist`
and refuses to overwrite an existing directory. Once your agent discovers it,
invoke it explicitly, for example:

> Use $structuralist to inspect this project's natural-language system. Explain
> its current owners and the smallest useful improvements. Do not edit files.

Skill installation, CLI installation, and authorization to change a project
are separate actions. See [Structuralist](docs/structuralist.md) for adoption
and other agent environments.

## Release boundary

This release uses project format **`2026-10-20`**. Older formats, including
those used by the `0.1.0` preview, require reviewed manual adoption through
`mindflow update-handoff`; there is no automatic migration. The historical
`integrate-mindflow` package is not the current methodology package.

The GUI can be built locally on macOS. It is not a standalone browser app.
This release does not promise an installer, automatic updates, cross-platform
GUI support, or supported SSH deployment. The CLI, GUI source, and Structuralist
package belong to one source release.

## Read more

- [Documentation map](docs/README.md)
- [Rationale](docs/rationale.md) and [semantics](docs/semantics.md)
- [Project format](docs/project-format.md), [CLI](docs/cli.md), and [GUI](docs/gui.md)
- [Contributing](.github/CONTRIBUTING.md) and [support](.github/SUPPORT.md)
- [Release history](CHANGELOG.md) and [source provenance](release-source.json)

The laboratory remains the implementation authority; this repository receives
reviewed source releases and owns these public guides. Software uses MPL-2.0,
documentation uses CC BY 4.0, and the reusable recipe assets use CC0-1.0. See
[the license map](LICENSES/README.md) for exact scopes and attribution.
