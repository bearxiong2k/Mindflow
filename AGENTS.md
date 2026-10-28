# Working with Mindflow

This is the public source release. Read [README](README.md), then
[Installation](docs/installation.md) and [Quick start](docs/quick-start.md).
The [format](docs/project-format.md) and [CLI](docs/cli.md) references describe
this release. Product source is promoted from a separate development repository;
see [Contributing](.github/CONTRIBUTING.md) before changing shipped source.

## Set up a user's project

1. Identify the intended project root, source release, installed `mindflow`
   executable, and existing agent skill location. Preserve local customizations.
2. Install the CLI from this checkout with
   `cargo install --locked --path . --bin mindflow`; verify `mindflow --version`.
3. If requested, install the complete Structuralist package with
   `./distribution/install-structuralist.sh`. It defaults to
   `~/.agents/skills/structuralist` for Codex and refuses existing destinations.
   Use an explicit directory for other agents; verify discovery in that agent.
4. Explain that skill installation has not changed the project. Invoke
   `$structuralist` explicitly only when the user asks for that method.
5. Inspect the project before adoption. If `MINDFLOW.yaml` exists, use
   `mindflow version --json` and read it; never replace it with `init`. Older
   formats require the manual `mindflow update-handoff` procedure. For a new
   Region, use `mindflow --root /path/to/project init` in its Git worktree only
   within the user's requested scope, then register useful existing files.
6. Edit ordinary files directly, preserve one owner per commitment, and run
   `mindflow --root /path/to/project check --json` after semantic edits.
   Start bounded orientation with `topology probe` and read the selected owners.

Author Event discussions as ordinary registered Markdown files, with grouping
and optional Opening transitions in the manifest. Follow
[Project format](docs/project-format.md); current Opening remains independent of that recorded flow. The GUI reads these
files. Do not invent Event records from every edit or commit.

Do not copy the optional Structuralist recipe's document tree by default.
Installation, skill invocation, and project adoption are separate actions.
Report the exact executable, release, format, skill directory, project root,
and validation result when handing setup back to the user.

## Verify this checkout

Run `cargo test --locked`, `cargo run --locked -- check --json`, and
`cd gui && npm ci && npm run typecheck && npm run test:frontend && npm run build:frontend`.
Use `MINDFLOW_BIN=/absolute/path/to/mindflow ./distribution/verify-structuralist-package.sh`
for the package and recipe. Public checks must not require private lab files.
Optional native builds follow [GUI](docs/gui.md); native window tests use the
provided harness and may close only the process that harness created.
