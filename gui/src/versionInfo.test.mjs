import assert from "node:assert/strict";
import test from "node:test";
import { adoptionComparison, appVersionLabel } from "./versionInfo.ts";

test("unknown adoption is never filled from the current app or core", () => {
  const info = {
    app: { variant: "stable", release: "2026.10.20" },
    project_core: { release: "2026.10.19" },
    project: { format: "2026-10-27", adopted_release: null },
  };
  assert.equal(appVersionLabel(info), "Stable · 2026.10.20");
  assert.equal(adoptionComparison(info), "Unknown");
  info.project.adopted_release = "2026.10.19";
  assert.equal(adoptionComparison(info), "Matches the serving core release");
  info.project.adopted_release = "2026.10.20";
  assert.equal(adoptionComparison(info), "Differs from the serving core release");
  info.project_core = null;
  assert.equal(adoptionComparison(info), "Unknown");
  assert.equal(appVersionLabel(), "Version · Unknown");
});
