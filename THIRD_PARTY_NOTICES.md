# Third-Party Notices

Mindflow depends on open-source software maintained by other projects. Those
works remain governed by their own licenses. This source preview does not copy
their source into the repository; package managers resolve the exact versions
recorded in `Cargo.lock`, `gui/src-tauri/Cargo.lock`, and
`gui/package-lock.json`.

The following table records direct dependencies of version `2026.10.20`. Transitive
dependencies are completely enumerated by the lockfiles and must be included in
a generated binary notice bundle before Mindflow distributes compiled binaries.

## Rust Core and CLI

| Package | Version | Declared license |
| --- | --- | --- |
| anyhow | 1.0.100 | MIT OR Apache-2.0 |
| clap | 4.5.23 | MIT OR Apache-2.0 |
| base64 | 0.22.1 | MIT OR Apache-2.0 |
| fs2 | 0.4.3 | MIT OR Apache-2.0 |
| libc | 0.2.189 | MIT OR Apache-2.0 |
| indexmap | 2.7.1 | Apache-2.0 OR MIT |
| serde | 1.0.229 | MIT OR Apache-2.0 |
| serde_json | 1.0.145 | MIT OR Apache-2.0 |
| serde_norway | 0.9.42 | MIT OR Apache-2.0 |
| sha2 | 0.10.9 | MIT OR Apache-2.0 |

## Desktop Adapter

| Package | Version | Declared license |
| --- | --- | --- |
| rfd | 0.17.2 | MIT |
| serde | 1.0.229 | MIT OR Apache-2.0 |
| serde_json | 1.0.145 | MIT OR Apache-2.0 |
| tauri | 2.11.5 | Apache-2.0 OR MIT |
| tauri-build | 2.6.3 | Apache-2.0 OR MIT |
| tauri-plugin-single-instance | 2.4.3 | Apache-2.0 OR MIT |

## Frontend and Build Tooling

| Package | Version | Declared license |
| --- | --- | --- |
| @tauri-apps/api | 2.11.1 | Apache-2.0 OR MIT |
| @tauri-apps/cli | 2.11.4 | Apache-2.0 OR MIT |
| @types/node | 26.3.0 | MIT |
| @types/react | 19.2.18 | MIT |
| @types/react-dom | 19.2.4 | MIT |
| @vitejs/plugin-react | 6.0.5 | MIT |
| dagre-d3-es | 7.0.14 | MIT |
| katex | 0.16.47 | MIT |
| mermaid | 11.16.1 | MIT |
| react | 19.2.8 | MIT |
| react-dom | 19.2.8 | MIT |
| react-markdown | 10.1.0 | MIT |
| rehype-raw | 7.0.0 | MIT |
| rehype-sanitize | 6.0.0 | MIT |
| rehype-slug | 6.0.0 | MIT |
| remark-frontmatter | 5.0.0 | MIT |
| remark-gfm | 4.0.1 | MIT |
| remark-math | 6.0.0 | MIT |
| typescript | 7.0.2 | Apache-2.0 |
| vite | 8.2.0 | MIT |

KaTeX's bundled fonts are distributed under the KaTeX MIT license. Mermaid's
transitive `khroma` package declares the MIT license in its installed license
file even though the npm registry metadata used by this audit omits the
`license` field.

This notice is informational and does not replace the applicable license text
shipped by each dependency. Report an omission through the security or support
channels before redistributing a compiled Mindflow artifact.
