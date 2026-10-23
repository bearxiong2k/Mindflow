import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MIND_DEV_APP_IDENTIFIER,
  isMindDevAppIdentifier,
} from "./appIdentity.ts";
import { CURRENT_PROJECT_FORMAT } from "./types.ts";

test("app and CLI declare one calendar release and share the project format", async () => {
  const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
  const packageVersion = (source) =>
    source.match(/^version = "([^"]+)"$/m)?.[1];
  const release = packageVersion(await read("../../Cargo.toml"));
  assert.match(release, /^\d{4}\.[1-9]\d?\.[1-9]\d?$/);
  assert.equal(packageVersion(await read("../src-tauri/Cargo.toml")), release);
  const frontend = JSON.parse(await read("../package.json"));
  const frontendLock = JSON.parse(await read("../package-lock.json"));
  const desktop = JSON.parse(await read("../src-tauri/tauri.conf.json"));
  const stable = JSON.parse(await read("../src-tauri/tauri.stable.conf.json"));
  for (const version of [
    frontend.version,
    frontendLock.version,
    frontendLock.packages[""].version,
    desktop.version,
    stable.version ?? desktop.version,
  ]) {
    assert.equal(version, release);
  }
  for (const path of ["../../Cargo.lock", "../src-tauri/Cargo.lock"]) {
    const lock = await read(path);
    for (const match of lock.matchAll(
      /\[\[package\]\]\nname = "(mindflow|mindflow-desktop)"\nversion = "([^"]+)"/g,
    )) {
      assert.equal(match[2], release, `${path}: ${match[1]}`);
    }
  }
  const coreFormat = (await read("../../src/project.rs"))
    .match(/pub const CURRENT_FORMAT: &str = "([^"]+)";/)?.[1];
  assert.equal(CURRENT_PROJECT_FORMAT, coreFormat);
});

test("only the Mind Dev bundle identity receives the development watermark", async () => {
  const developmentConfig = JSON.parse(
    await readFile(
      new URL("../src-tauri/tauri.conf.json", import.meta.url),
      "utf8",
    ),
  );
  const stableConfig = JSON.parse(
    await readFile(
      new URL("../src-tauri/tauri.stable.conf.json", import.meta.url),
      "utf8",
    ),
  );
  const identityCapability = JSON.parse(
    await readFile(
      new URL(
        "../src-tauri/capabilities/app-identity.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  assert.equal(developmentConfig.identifier, MIND_DEV_APP_IDENTIFIER);
  assert.deepEqual(identityCapability.windows, [
    "main",
    "workspace-*",
    "reader-*",
  ]);
  assert.deepEqual(identityCapability.permissions, [
    "core:app:allow-identifier",
  ]);
  assert.equal(isMindDevAppIdentifier(developmentConfig.identifier), true);
  assert.equal(
    isMindDevAppIdentifier(
      `${developmentConfig.identifier}.isolated-test.window-42`,
    ),
    true,
  );
  assert.equal(isMindDevAppIdentifier(stableConfig.identifier), false);
  assert.equal(
    isMindDevAppIdentifier(
      `${stableConfig.identifier}.isolated-test.window-42`,
    ),
    false,
  );
  assert.equal(isMindDevAppIdentifier(undefined), false);
  assert.equal(isMindDevAppIdentifier("dev.mindflow.desktop"), false);
  assert.equal(
    isMindDevAppIdentifier("dev.mindflow.desktop.development.preview"),
    false,
  );
  assert.equal(
    isMindDevAppIdentifier(
      `${developmentConfig.identifier}.isolated-test.window/42`,
    ),
    false,
  );
});
