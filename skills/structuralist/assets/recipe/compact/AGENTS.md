# Fieldbook repository guidance

Read [the project account](project.md) for current purpose and behavior, then
the affected discussion. [Browsing summary](evolve/browsing-summary.md) links
the reasoning behind the current browsing choice.

Keep accepted commitments in their current owner. Use Event discussions for
questions, alternatives, evidence, and changed understanding; a summary should
explain their relationship and link to the owner of accepted consequences.
Routine edits need no Event.

Edit ordinary files and `MINDFLOW.yaml` coherently. Select current Opening
explicitly and record file transitions only when the discussion describes one.
Use format `2026-10-27`, inspect affected files with bounded topology probes,
and run `mindflow check --json` after semantic changes. Review links and the
Git diff; preserve unrelated work.
