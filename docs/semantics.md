# Mindflow semantics

A **Region** is the bounded account a project deliberately maintains over
selected filesystem entries and their exact language. It is smaller than the
whole repository. Visibility in a file browser, Git history, or an agent's
context does not create membership.

Mindflow uses **SOE: Structure, Opening, and Evolve**. These share stable
identities while answering different questions.

## Structure: what is maintained now?

The `components` mapping registers individual files and directories. Each has
a stable ID and one exact path, with a useful description or index marker when
needed. Names, kinds, and containment come from the filesystem. Folder names
supply context; there is no parallel role taxonomy or copied hierarchy.

Registering a directory does not register its descendants. Unregistered
ancestors may appear as navigation context. A non-Markdown file is a coarse
target, not an invitation to infer a new semantic model from its contents.

Ordinary relationships join registered peers under the same actual parent.
Their project-authored phrases and directions remain exact. Cross-folder
explanation stays in ordinary prose and links. A relationship involving a
folder does not imply relationships between all its descendants.

## Opening: what remains open?

Opening is an explicit ordered selection of current non-index documents.
It identifies the concerns the project chooses to keep open in its present
account. It is not inferred from recent edits, folder placement, prose, or
what an agent happens to be doing.

A document can remain in Structure without being in Opening. Leaving Opening
does not itself mean completion, deletion, or formalization. Opening may be
empty. The GUI distinguishes it within Structure instead of maintaining a
separate project model.

## Evolve: how is meaningful change revisited?

An **Event** is an authored development in the project's understanding, kept in
an ordinary registered Markdown file. It can carry discussion, evidence, an
unresolved possibility, or a decision. Its title follows the filename. It needs
no date, commit, final outcome, or change to Opening.

An Event may summarize an ordered list of finer Events. These form a forest:
each child has one parent at most, and groups cannot be cyclic. The grouping
expresses a reading structure; it does not change filesystem hierarchy or give
historical reasoning the authority of a current design owner. Authors may
revise or regroup the account while Git preserves earlier bytes.

Optional `opening` transitions record how selected files continue, branch,
merge, or leave the historical flow. The first predecessor reference may carry
a concern in from before the selected account. Later transitions must be
consistent with that flow. Historical component records retain participant
identities that no longer have current registrations without registering
missing files again. The recorded end and current `opening.files` are independent.

Folding a summary composes its complete subtree's file transitions. Expanding
it reveals both finer discussions and detailed lifelines. Folding, focus, and
zoom are disposable GUI presentation; files and manifest records carry the
shared account. Author them with ordinary editors or an explicitly instructed
agent. The GUI reads and navigates them.

An **Anchor** combines a present interpretive document with an exact Git commit
and explicit historical connections. Its current prose can develop while its
selected evidence stays fixed. Anchors do not participate in the recorded
Opening flow and are separate from Opening.

A **historical selection** is one explicit request with a concern, exact Git
sources, selected Anchors, and optional instructions. It reads only those
sources, beside the current Region. It creates no second Region, hidden memory,
or persistent retrieval result. Git owns historical bytes; the project owns
what they mean now.

## Authority and validity

Ordinary files own language, the manifest owns registrations and SOE records,
and Git owns byte history. CLI and GUI consume the same validated core.
Generated diagrams, selections, measurements, layout, and caches are disposable
views. They cannot become a second source of accepted meaning.

Invalid state is refused rather than silently reduced to a smaller valid
Region. Validation checks bindings, relationships, Event grouping and
transitions, and other structural constraints; it cannot prove that a document is true or that a proposed change
is wise. Code and other formal artifacts keep their ordinary tools and
validators.

Unregistering and deleting a file are different actions. Removing a registration
requires disposition of its references but leaves its ordinary file and Git
history intact. Reading history creates no new current membership.

[Structuralist](structuralist.md) is the optional future-facing methodology for
helping an agent judge how this account should evolve. Its invocation, proposals,
and private context are not SOE state. Accepted results become durable through
ordinary reviewed edits.

See [Project format](project-format.md) for encoding and [CLI](cli.md) for
observable commands.
