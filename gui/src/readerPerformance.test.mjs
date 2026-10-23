import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Reader paints a light shell while its heavy document renderer loads", async () => {
  const reader = await readFile(new URL("./ReaderApp.tsx", import.meta.url), "utf8");
  const main = await readFile(new URL("./main.tsx", import.meta.url), "utf8");
  const inspector = await readFile(
    new URL("./components/DocumentInspector.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    reader,
    /const documentInspectorRequest = import\("\.\/components\/DocumentInspector"\)/,
  );
  assert.match(reader, /useState<DocumentInspectors>/);
  assert.match(reader, /documentInspectorRequest\.then\([\s\S]*setDocumentInspectors\(module\)/);
  assert.match(reader, /Preparing document presentation…/);
  assert.doesNotMatch(reader, /<Suspense|\blazy\(/);
  assert.doesNotMatch(
    reader,
    /from "\.\/components\/DocumentInspector"/,
  );
  assert.doesNotMatch(main, /katex\/dist\/katex\.min\.css/);
  assert.match(inspector, /import "katex\/dist\/katex\.min\.css"/);
});

test("Reader fragment navigation does not pull the Markdown parser into its shell", async () => {
  const reader = await readFile(new URL("./ReaderApp.tsx", import.meta.url), "utf8");
  const navigation = await readFile(new URL("./readerNavigation.ts", import.meta.url), "utf8");

  assert.match(reader, /readerContentId[\s\S]*from "\.\/readerNavigation"/);
  assert.doesNotMatch(reader, /from "\.\/readerMarkdown"/);
  assert.doesNotMatch(navigation, /\bimport\s/);
  assert.match(reader, /if \(active\) setPresentationError\(message\(error\)\)/);
  assert.match(reader, /<pre>\{snapshot\.document\.content\}<\/pre>/);
});

test("Reader navigation carries its exact snapshot and lets one state event reload it", async () => {
  const reader = await readFile(new URL("./ReaderApp.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("./api.ts", import.meta.url), "utf8");

  const navigation = reader.slice(
    reader.indexOf("const navigate = useCallback"),
    reader.indexOf("const selectDocument = useCallback"),
  );
  assert.match(navigation, /snapshot\.snapshot\?\.id/);
  assert.doesNotMatch(navigation, /await refresh\(\)/);
  assert.match(api, /snapshot: snapshot \?\? null/);
  assert.match(reader, /listenForReaderStateChange\(\(target\) => \{\s*void refresh\(target\)/);
});
