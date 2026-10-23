# Contributing

Issues, proposed patches, and documentation improvements are welcome. This
repository is the public source release; living product design and development
are maintained in a separate laboratory. Contributors do not need lab access.

For a behavior change, include a focused reproduction, expected result, and
relevant tests. You may propose a patch here. Maintainers absorb accepted
product changes into the laboratory, then promote an exact tested revision.
Files listed in [the source inventory](../.mindflow-promoted-files) must match
[release provenance](../release-source.json) at a release commit; maintainers
do not merge an independently diverging implementation into that commit.
Release-specific guides and community files may be corrected here directly.

Run `cargo test --locked` and `cargo run --locked -- check --json`. Frontend
changes also require `cd gui && npm ci && npm run typecheck && npm run test:frontend && npm run build:frontend`.
See [AGENTS.md](../AGENTS.md) for skill and optional native checks. Public CI
runs without private development files. A passing check does not replace review.

Contributions use the license assigned to their target path. You must have
authority to contribute them; see [Licensing](../LICENSES/README.md).
