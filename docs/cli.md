# CLI

The CLI reconstructs one project-owned Region from ordinary files, its manifest,
and Git. Commands below describe source release `2026.10.25`. Use
`mindflow --help` and each subcommand's `--help` for exact options.

## Select a project and inspect it

Project-loading commands discover the nearest ancestor containing
`MINDFLOW.yaml`, or accept an explicit root:

```sh
mindflow --root /path/to/project check --json
mindflow --version
mindflow version --json
```

`check` validates the Region. Version reporting distinguishes the executable's
release and supported format from a project's explicitly adopted release.
Unknown build provenance or project adoption is reported as unknown, not guessed.

For a bounded question, inspect one directory first:

```sh
mindflow topology probe docs --depth 1 --max-nodes 128 --mermaid
mindflow topology list docs --offset 0 --limit 64 --json
mindflow topology read docs/semantics.md
```

A probe shows that directory's selected hierarchy and relationships incident to
its own registered identity. Addresses can be exact component IDs or paths;
keep identity distinct from its binding. Cross-folder companions remain
ordinary links in the document you read.

Other useful inspections:

```sh
mindflow topology resolve docs/semantics.md --json
mindflow topology neighbors docs/semantics.md --direction both --json
mindflow topology view --depth 3 --max-nodes 128 --mermaid
mindflow map
mindflow status --json
```

`map` emits the derived Structure as JSON. `status` supplies the complete Region
index, direct content handles, Opening, and an Event-page descriptor. Exact
prose is read separately with `topology read`; text output preserves its bytes.
Generated Mermaid is disposable output and is never loaded as project state.

Child and neighbor pages default to 64 entries and allow up to 512. Views
and probes default to depth 1 and a 256-node budget. Exceeding the selected
budget fails instead of silently presenting a truncated complete result.

## Opening, Events, and history

```sh
mindflow opening show --json
mindflow evolve events --offset 0 --limit 64 --json
mindflow anchor list
```

Events are authored transformations, not inferred commits. To select exact
historical evidence for one request:

```sh
mindflow evolve select \
  --concern "How has this explanation changed?" \
  --source HEAD README.md
```

You may add `--anchor NAME` for an existing Anchor and `--instruction TEXT`
for explicit interpretation guidance. Selection writes no project state and
fails if any selected evidence cannot be resolved.

An Anchor uses an already registered, non-index Markdown document outside
Opening. After preparing its document and any connection vocabulary:

```text
mindflow anchor create review-baseline --file notes/baseline.md --at HEAD
mindflow anchor show review-baseline
mindflow anchor remove review-baseline
```

Creation stores a resolved commit. Removing its definition does not delete the
ordinary document. Optional `--connection TYPE PATH` arguments name declared
Anchor vocabulary and exact paths at the stored revision.

## Initialization and deliberate changes

`mindflow init` creates only an empty manifest in the chosen Git worktree. It
refuses an existing manifest. Ordinary manifest and file edits are supported;
validate their complete result with `check --json`.

For the narrow typed `open-opening-branch` operation, `change plan --input-json
FILE` produces a proposal and `change apply --input-json FILE` applies a matching
proposal. This is not a general document editor. Consult command help before
using it; an invalid or stale proposal writes nothing.

`mindflow update-handoff` prints release-specific manual adoption guidance. It
works without loading an old project and rejects `--root`. There is no automatic
migration command or legacy-format loader.

## Documentation measurements

```sh
mindflow qc --commits 30 --json
mindflow qc --list-commits --json
```

QC measures the current registered Markdown cohort across Git history. Its
counts describe volume and change, not quality, completion, or a historical
Region. Use `qc --help` for an exact commit range; missing comparison remains
unknown.

Repeated observations reuse numeric measurements in local Git state. The cache
retains only the requested window for the current document cohort, is capped at
8 MiB per project, and contains no document prose. Changed working content and
Git inputs are revalidated; cache removal or failure causes recomputation.

## Output and failures

Structured results go to stdout. Refusals and runtime errors use stderr;
`check` and `status` expose their validation diagnostics in their own reports.
`status` uses a null Region when invalid, rather than exposing a partial valid
model. Exit codes are `0` for success, `1` for validation refusal, and `2` for
invocation or runtime failure. JSON results identify their schemas; do not infer
compatibility from a package date alone.

The source contains development bridge commands, but this beta does not claim
supported SSH deployment or independently interchangeable app/server builds.
