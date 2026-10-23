import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";

import {
  normalizeReaderMarkdownMath,
  prepareReaderMarkdown,
  readerImageDestination,
  readerLinkDestination,
  readerRehypePlugins,
  readerRemarkPlugins,
  renderReaderMath,
} from "./readerMarkdown.ts";
import { readerContentId } from "./readerNavigation.ts";

function renderReaderMarkdown(markdown) {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        rehypePlugins: readerRehypePlugins,
        remarkPlugins: readerRemarkPlugins,
      },
      prepareReaderMarkdown(markdown).content,
    ),
  );
}

test("Reader resolves local image and GIF paths relative to the document", () => {
  assert.deepEqual(
    readerImageDestination(
      "guide/overview.md",
      "../assets/interaction%20demo.gif?raw=1#preview",
    ),
    {
      kind: "project",
      path: "assets/interaction demo.gif",
    },
  );
  assert.deepEqual(
    readerImageDestination(
      "guide/overview.md",
      "https://example.com/diagram.png",
    ),
    {
      kind: "external",
      source: "https://example.com/diagram.png",
    },
  );
  assert.deepEqual(
    readerImageDestination("guide/overview.md", "/assets/preview.png"),
    { kind: "project", path: "assets/preview.png" },
  );
  assert.deepEqual(
    readerImageDestination(
      "guide/overview.md",
      "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==",
    ),
    {
      kind: "direct",
      source: "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==",
    },
  );
  assert.equal(
    readerImageDestination("overview.md", "../outside.gif"),
    undefined,
  );
  assert.equal(
    readerImageDestination("guide/overview.md", "file:///tmp/private.gif"),
    undefined,
  );
  assert.equal(
    readerImageDestination("guide/overview.md", "../.git/objects/secret.gif"),
    undefined,
  );
});

test("native Reader target keeps its development identity and approved-image schemes", async () => {
  const config = JSON.parse(
    await readFile(
      new URL("../src-tauri/tauri.conf.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(config.productName, "Mind Dev");
  assert.equal(config.identifier, "dev.mindflow.desktop.development");

  const imagePolicy = config.app.security.csp
    .split(";")
    .map((directive) => directive.trim().split(/\s+/))
    .find(([directive]) => directive === "img-src");
  assert.ok(imagePolicy, "native CSP must define an image policy");
  const imageSources = new Set(imagePolicy.slice(1));
  for (const source of ["data:", "blob:", "http:", "https:"]) {
    assert.ok(imageSources.has(source), `native CSP must permit ${source}`);
  }
});

test("Reader resolves project links for navigation and address preview", () => {
  assert.deepEqual(
    readerLinkDestination(
      "guide/overview.md",
      "../reference/math%20notes.md#formula",
    ),
    {
      projectPath: "reference/math notes.md",
      fragment: "formula",
      preview: "reference/math notes.md#formula",
    },
  );
  assert.deepEqual(
    readerLinkDestination(
      "guide/overview.md",
      "https://example.com/reference?q=math#formula",
    ),
    {
      projectPath: undefined,
      fragment: "formula",
      preview: "https://example.com/reference?q=math#formula",
    },
  );
  assert.deepEqual(
    readerLinkDestination("guide/overview.md", "../../outside.md"),
    { projectPath: undefined, fragment: undefined, preview: "../../outside.md" },
  );
  assert.deepEqual(
    readerLinkDestination("guide/overview.md", "../.git/config"),
    { projectPath: undefined, fragment: undefined, preview: "../.git/config" },
  );
  assert.equal(readerContentId("#section%20one"), "reader-content-section one");
  assert.equal(
    readerContentId("reader-content-existing"),
    "reader-content-existing",
  );
});

test("Reader identifies inline and display TeX and renders each safely with KaTeX", async () => {
  const markdown = [
    "Euler wrote $e^{i\\pi} + 1 = 0$.",
    "",
    "$$",
    "\\int_0^1 x^2\\,dx = \\frac{1}{3}",
    "$$",
  ].join("\n");
  const html = renderReaderMarkdown(markdown);
  const inline = await renderReaderMath("e^{i\\pi} + 1 = 0", false);
  const display = await renderReaderMath(
    "\\int_0^1 x^2\\,dx = \\frac{1}{3}",
    true,
  );

  assert.match(html, /class="language-math math-inline"/);
  assert.match(html, /class="language-math math-display"/);
  assert.doesNotMatch(html, /\$\$/);
  assert.match(inline.html, /class="katex"/);
  assert.match(display.html, /class="katex-display"/);
  assert.match(display.html, /<math[^>]*display="block"/);
  assert.equal(inline.invalid, false);
  assert.equal(display.invalid, false);
});

test("Reader renders bracket-delimited TeX as display math", () => {
  const markdown = [
    "A normalized Gaussian is",
    "",
    "\\[",
    "f(x) = \\frac{1}{\\sqrt{2\\pi}} e^{-x^2 / 2}",
    "\\]",
  ].join("\n");
  const normalized = normalizeReaderMarkdownMath(markdown);
  const html = renderReaderMarkdown(markdown);

  assert.match(html, /class="language-math math-display"/);
  assert.doesNotMatch(html, /\\\[|\\\]/);
  assert.equal(normalizeReaderMarkdownMath(normalized), normalized);
});

test("Reader renders compact and mixed-line display TeX without consuming prose", () => {
  const markdown = [
    "Before the equations.",
    "",
    "$$x^2 + y^2 = z^2 \\tag{1}$$",
    "",
    "$$\\begin{aligned}",
    "f(x) &= x + 1 \\\\",
    "g(x) &= x - 1",
    "\\end{aligned} \\tag{2}$$",
    "",
    "## After the equations",
    "",
    "This prose must remain ordinary Markdown.",
  ].join("\n");
  const html = renderReaderMarkdown(markdown);

  assert.equal((html.match(/math-display/g) ?? []).length, 2);
  assert.match(
    html,
    /<h2 id="reader-content-after-the-equations">After the equations<\/h2>/,
  );
  assert.match(html, /This prose must remain ordinary Markdown\./);
});

test("Reader sanitizes broad presentational HTML and preserves safe anchors and alerts", () => {
  const markdown = [
    "<!-- source-only comment -->",
    "",
    "> [!NOTE]",
    "> **Status:** local source transcription.",
    "",
    '<a id="pdf-page-1"></a>',
    "",
    "Author<sup>1</sup> uses x<sub>n</sub>, <b>bold</b>, <i>italic</i>, <kbd>Cmd</kbd>, and <mark>marked</mark> text.<br>Next line.",
    "",
    "<details><summary>Evidence</summary>Exact detail.</details>",
    "",
    '<img src="https://example.com/tracker.png" style="position:fixed" onerror="alert(1)">',
    "<script>alert('unsafe')</script>",
  ].join("\n");
  const html = renderReaderMarkdown(markdown);

  assert.match(html, /class="markdown-alert markdown-alert--note"/);
  assert.match(html, /class="markdown-alert__title"><strong>Note<\/strong>/);
  assert.doesNotMatch(html, /\[!NOTE\]|source-only comment/);
  assert.match(
    html,
    /id="reader-content-pdf-page-1" class="reader-source-anchor"/,
  );
  assert.match(html, /Author<sup>1<\/sup> uses x<sub>n<\/sub>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<kbd>Cmd<\/kbd>/);
  assert.match(html, /<mark>marked<\/mark>/);
  assert.match(html, /<br\/>Next line/);
  assert.match(html, /<details><summary>Evidence<\/summary>Exact detail\.<\/details>/);
  assert.match(html, /<img src="https:\/\/example\.com\/tracker\.png"/);
  assert.doesNotMatch(html, /onerror|position:fixed|<script|unsafe/);
});

test("Reader hides frontmatter and gives headings safe stable fragment targets", () => {
  const html = renderReaderMarkdown(
    [
      "---",
      "title: Research paper",
      "author: Example",
      "---",
      "",
      "# A Heading",
      "",
      "[Go](#a-heading)",
      "",
      "# A Heading",
    ].join("\n"),
  );

  assert.doesNotMatch(html, /title: Research paper|author: Example/);
  assert.match(html, /<h1 id="reader-content-a-heading">A Heading<\/h1>/);
  assert.match(html, /href="#reader-content-a-heading"/);
  assert.match(html, /<h1 id="reader-content-a-heading-1">A Heading<\/h1>/);
});

test("Reader promotes compact math nested in a list to display math", () => {
  const html = renderReaderMarkdown(
    [
      "- outer",
      "  - inner",
      "",
      "    $$x^2 + y^2 = z^2$$",
      "",
      "    after",
    ].join("\n"),
  );

  assert.match(html, /class="language-math math-display"/);
  assert.match(html, /<p>after<\/p>/);
  assert.doesNotMatch(html, /class="language-math math-inline"/);
});

test("Reader recovers from ambiguous math without consuming later Markdown", () => {
  const markdown = [
    "$$",
    "This delimiter was never closed as an equation.",
    "",
    "# Ordinary heading",
    "",
    "$$x^2$$",
    "",
    "Trailing prose survives.",
  ].join("\n");
  const prepared = prepareReaderMarkdown(markdown);
  const html = renderReaderMarkdown(markdown);

  assert.ok(prepared.diagnostics.length >= 1);
  assert.ok(
    prepared.diagnostics.some(
      (diagnostic) => diagnostic.code === "suspicious-math-block",
    ),
  );
  assert.match(html, /Ordinary heading/);
  assert.match(html, /Trailing prose survives\./);
  assert.equal((html.match(/math-display/g) ?? []).length, 1);
  assert.equal(prepareReaderMarkdown(prepared.content).content, prepared.content);
});

test("Reader math recovery preserves code and safely escapes an unmatched delimiter", () => {
  const markdown = [
    "`\\[inline code\\]`",
    "`$$inline display code$$`",
    "",
    "```tex",
    "\\[fenced code\\]",
    "$$fenced display code$$",
    "```",
    "",
    "    \\[indented code\\]",
    "",
    String.raw`\\[escaped literal\\]`,
    "",
    "Unmatched \\[ delimiter",
  ].join("\n");

  const prepared = prepareReaderMarkdown(markdown);
  assert.equal(prepared.diagnostics.length, 1);
  assert.equal(prepared.diagnostics[0].code, "unmatched-math-delimiter");
  assert.ok(prepared.content.includes("`\\[inline code\\]`"));
  assert.ok(prepared.content.includes("```tex\n\\[fenced code\\]"));
  assert.ok(prepared.content.includes("    \\[indented code\\]"));
  assert.ok(prepared.content.includes("Unmatched &#92;[ delimiter"));
  assert.match(renderReaderMarkdown(markdown), /Unmatched \\\[ delimiter/);
});

test("Reader bracket-math normalization ignores closing delimiters in code", () => {
  const markdown = [
    "\\[",
    "`\\]` is an inline-code example, not the closing delimiter.",
    "x^2",
    "\\]",
  ].join("\n");
  const normalized = normalizeReaderMarkdownMath(markdown);

  assert.ok(normalized.includes("`\\]` is an inline-code example"));
  assert.match(normalized, /\$\$\n[\s\S]*x\^2\n+\$\$/);
});

test("Reader preserves malformed TeX as a visible rendering error", async () => {
  const rendered = await renderReaderMath("\\definitelyUnknown{1}", false);

  assert.equal(rendered.invalid, true);
  assert.match(rendered.html, /mathcolor="#cc0000"/);
  assert.match(rendered.html, /\\definitelyUnknown\{1\}/);
});

test("Reader math recovery survives a deterministic delimiter and code-fence fuzz corpus", () => {
  let state = 0x51f15e;
  const fragments = [
    "ordinary prose",
    "`$$code$$`",
    "```tex\n$$fenced$$\n```",
    "$$x^2$$",
    "\\[y^2\\]",
    "$$\n# accidental heading\n$$",
    "\\[ unmatched bracket",
    "> [!TIP]\n> visible note",
  ];
  for (let caseIndex = 0; caseIndex < 96; caseIndex += 1) {
    const selected = [];
    for (let part = 0; part < 7; part += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      selected.push(fragments[state % fragments.length]);
    }
    const sentinel = `Sentinel heading ${caseIndex}`;
    const markdown = [...selected, `## ${sentinel}`, `Tail ${caseIndex}.`].join(
      "\n\n",
    );
    const prepared = prepareReaderMarkdown(markdown);
    const html = renderReaderMarkdown(markdown);
    assert.match(html, new RegExp(sentinel));
    assert.match(html, new RegExp(`Tail ${caseIndex}\\.`));
    assert.equal(prepareReaderMarkdown(prepared.content).content, prepared.content);
  }
});

test("Reader keeps a paper-scale semantic corpus structurally complete", () => {
  const blocks = [];
  for (let index = 0; index < 900; index += 1) {
    blocks.push(
      [
        `## Section ${index}`,
        "",
        `Paragraph ${index} carries a stable sentinel.`,
        "",
        `$$x_${index}^2 + y_${index}^2 = z_${index}^2$$`,
      ].join("\n"),
    );
  }
  const markdown = blocks.join("\n\n");
  const html = renderReaderMarkdown(markdown);

  assert.equal((html.match(/<h2 id=/g) ?? []).length, 900);
  assert.equal((html.match(/math-display/g) ?? []).length, 900);
  assert.match(html, /Paragraph 899 carries a stable sentinel\./);
});
