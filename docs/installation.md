# Installation

The [2026.10.25 beta prerelease](https://github.com/bearxiong2k/Mindflow/releases/tag/v2026.10.25) ships source and the complete
Structuralist package. It does not provide prebuilt native applications.

## Get the source

Clone the public repository at the release tag:

```sh
git clone --branch v2026.10.25 https://github.com/bearxiong2k/Mindflow.git
cd Mindflow
```

Alternatively, download and extract the [tagged source archive](https://github.com/bearxiong2k/Mindflow/archive/refs/tags/v2026.10.25.tar.gz)
or the source asset from the [prerelease page](https://github.com/bearxiong2k/Mindflow/releases/tag/v2026.10.25), then open a terminal
in its extracted root. Use the tagged Git checkout for the optional GUI build
and for Git-history inspection.

## CLI

Install Git, a C/C++ build toolchain for your platform, and Rust through rustup.
The checkout pins Rust `1.85.1` in `rust-toolchain.toml`; the first build needs
network access to obtain the toolchain and locked dependencies. Node.js and a
desktop application are unnecessary for CLI use.

From the checkout root:

```sh
cargo install --locked --path . --bin mindflow
mindflow --version
```

Cargo installs into its configured binary directory, normally `~/.cargo/bin`.
Ensure that directory is on `PATH`. `mindflow --version` must report release
`2026.10.25` and format `2026-10-20`. Installation does not change another
project. Cargo installation works from a source archive without `.git`.

Mindflow project inspection requires a Git worktree. For an extracted archive,
initialize one only if the root has no `.git` entry, then validate the bundled
public Region:

```sh
if [ ! -e .git ]; then git init; fi
mindflow check --json
```

An existing checkout is left intact. This does not create a commit; without
history, historical comparisons are unavailable. The
[tour](tutorial/README.md) uses this checkout's public documentation.

## Optional Structuralist skill

With Python 3 available, run from the same checkout:

```sh
./distribution/install-structuralist.sh
./distribution/install-structuralist.sh --check
```

The default destination is `~/.agents/skills/structuralist`. The installer
refuses to overwrite an existing directory; `--check` compares its complete
contents with this source package. For another agent's skill location, pass
its exact destination directory:

```sh
./distribution/install-structuralist.sh /path/to/agent/skills/structuralist
./distribution/install-structuralist.sh --check /path/to/agent/skills/structuralist
```

You can also copy the complete `skills/structuralist/` directory yourself.
Preserve its instructions, references, assets, and agent metadata together.
Confirm that Structuralist appears in the agent's skill selector; refresh or
restart the agent if needed. Invoke `$structuralist` explicitly. Installation
neither initializes nor authorizes changes to a consuming project. See
[Structuralist](structuralist.md).

## Optional local GUI

The current source-linked GUI workflow requires a Git checkout with at least
one commit, macOS 12 or newer, Xcode Command Line Tools, the Rust prerequisites above, and Node.js `22.12` or newer
with npm. The GUI uses Tauri; serving the frontend alone does not provide a
working project application.

From the checkout root:

```sh
cd gui
npm ci
npm run sync:local
npm run sync:local:check
../bin/mindflow-app ..
```

Synchronization tests and builds the CLI, frontend, and local native app.
The default development identity is **Mind Dev**. The source-relative
`bin/mindflow` and `bin/mindflow-app` launchers require synchronized artifacts;
they are separate from the standalone CLI installed by Cargo.

After source or dependency changes, repeat synchronization. Content edits in a
project use the app's Refresh action. A running app keeps its loaded build
until explicit Refresh or relaunch; building alone does not replace its memory.
No native app download, signing service, or automatic updater is needed for
this source beta.

## Updating and removal

Use source, manuals, and skill from the same release. Re-run the CLI install
command after selecting the intended source revision. Inspect an existing
skill installation before moving it aside and installing its replacement.
Updating the executable or skill never automatically adopts a project.

For an older Mindflow project, run:

```sh
mindflow update-handoff
```

Follow its manual instructions and review the resulting Git diff. Do not run
`mindflow init` over an existing manifest. Remove an installed CLI with
`cargo uninstall mindflow`; removing the skill or local app leaves your
project's ordinary files and manifest intact.
