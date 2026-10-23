import rehypeRaw from "rehype-raw";
import rehypeSanitize, {
  defaultSchema,
  type Options as RehypeSanitizeOptions,
} from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Options as ReactMarkdownOptions } from "react-markdown";

import { READER_CONTENT_ID_PREFIX } from "./readerNavigation.ts";

interface ReaderMarkdownAstNode {
  type: string;
  value?: string;
  depth?: number;
  children?: ReaderMarkdownAstNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
    hChildren?: ReaderMarkdownHastNode[];
  };
  position?: {
    start?: { line?: number; column?: number; offset?: number };
    end?: { line?: number; column?: number; offset?: number };
  };
}

interface ReaderMarkdownFile {
  value?: unknown;
}

interface ReaderMarkdownHastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: ReaderMarkdownHastNode[];
}

export interface ReaderMarkdownDiagnostic {
  code:
    | "unmatched-math-delimiter"
    | "suspicious-math-block"
    | "math-recovery-limit";
  line: number;
  message: string;
}

export interface PreparedReaderMarkdown {
  content: string;
  diagnostics: ReaderMarkdownDiagnostic[];
}

const readerSanitizeSchema: RehypeSanitizeOptions = {
  ...defaultSchema,
  clobberPrefix: READER_CONTENT_ID_PREFIX,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark"],
  attributes: {
    ...defaultSchema.attributes,
    blockquote: [
      ...(defaultSchema.attributes?.blockquote ?? []),
      [
        "className",
        "markdown-alert",
        /^markdown-alert--(?:note|tip|important|warning|caution)$/,
      ],
    ],
    code: [
      ["className", /^language-./, "math-inline", "math-display"],
    ],
    p: [
      ...(defaultSchema.attributes?.p ?? []),
      ["className", "markdown-alert__title"],
    ],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ["http", "https", "data", "blob"],
  },
};

const readerAlertLabels = new Map([
  ["CAUTION", "Caution"],
  ["IMPORTANT", "Important"],
  ["NOTE", "Note"],
  ["TIP", "Tip"],
  ["WARNING", "Warning"],
]);

function transformReaderMarkdownAlert(node: ReaderMarkdownAstNode): void {
  if (node.type !== "blockquote") return;
  const firstParagraph = node.children?.[0];
  const firstText = firstParagraph?.children?.[0];
  if (firstParagraph?.type !== "paragraph" || firstText?.type !== "text") {
    return;
  }
  const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n|$)/i.exec(
    firstText.value ?? "",
  );
  const alertType = match?.[1]?.toUpperCase();
  const label = alertType ? readerAlertLabels.get(alertType) : undefined;
  if (!match || !alertType || !label) return;

  firstText.value = (firstText.value ?? "").slice(match[0].length);
  if (!firstText.value) firstParagraph.children?.shift();
  if (firstParagraph.children?.length === 0) node.children?.shift();
  node.data = {
    ...node.data,
    hProperties: {
      ...node.data?.hProperties,
      className: ["markdown-alert", `markdown-alert--${alertType.toLowerCase()}`],
    },
  };
  node.children?.unshift({
    type: "paragraph",
    children: [{ type: "strong", children: [{ type: "text", value: label }] }],
    data: {
      hProperties: { className: ["markdown-alert__title"] },
    },
  });
}

function transformReaderMarkdownNode(
  node: ReaderMarkdownAstNode,
  source: string,
): void {
  if (!node.children) return;

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    if (!child) continue;
    const onlyInlineMath =
      child.type === "paragraph" &&
      child.children?.length === 1 &&
      child.children[0]?.type === "inlineMath"
        ? child.children[0]
        : undefined;
    const start = child.position?.start?.offset;
    const end = child.position?.end?.offset;
    const exactSource =
      onlyInlineMath && start !== undefined && end !== undefined
        ? source.slice(start, end).trim()
        : "";
    if (
      onlyInlineMath &&
      exactSource.startsWith("$$") &&
      exactSource.endsWith("$$") &&
      exactSource.length >= 4
    ) {
      node.children[index] = {
        type: "math",
        value: onlyInlineMath.value,
        data: {
          hName: "pre",
          hChildren: [
            {
              type: "element",
              tagName: "code",
              properties: {
                className: ["language-math", "math-display"],
              },
              children: [{ type: "text", value: onlyInlineMath.value }],
            },
          ],
        },
        position: child.position,
      };
      continue;
    }
    transformReaderMarkdownNode(child, source);
  }
  transformReaderMarkdownAlert(node);
}

/**
 * Supports the safe presentational HTML and GitHub-style alerts commonly
 * emitted by Markdown authoring tools without enabling arbitrary document
 * HTML in the Reader.
 */
function remarkReaderPresentation() {
  return (tree: ReaderMarkdownAstNode, file: ReaderMarkdownFile) =>
    transformReaderMarkdownNode(
      tree,
      typeof file.value === "string" ? file.value : String(file.value ?? ""),
    );
}

export const readerRemarkPlugins: NonNullable<
  ReactMarkdownOptions["remarkPlugins"]
> = [
  remarkFrontmatter,
  remarkGfm,
  remarkMath,
  remarkReaderPresentation,
];

function appendReaderClass(
  properties: Record<string, unknown>,
  name: string,
): void {
  const current = properties.className;
  const classes = Array.isArray(current)
    ? current.filter((entry): entry is string => typeof entry === "string")
    : typeof current === "string"
      ? current.split(/\s+/).filter(Boolean)
      : [];
  if (!classes.includes(name)) classes.push(name);
  properties.className = classes;
}

function transformReaderMarkdownHast(node: ReaderMarkdownHastNode): void {
  if (node.tagName === "b") node.tagName = "strong";
  if (node.tagName === "i") node.tagName = "em";
  if (node.type === "element" && node.properties) {
    const href = node.properties.href;
    if (
      node.tagName === "a" &&
      typeof href === "string" &&
      href.startsWith("#") &&
      !href.startsWith(`#${READER_CONTENT_ID_PREFIX}`)
    ) {
      node.properties.href = `#${READER_CONTENT_ID_PREFIX}${href.slice(1)}`;
    }
    if (
      node.tagName === "a" &&
      (typeof node.properties.id === "string" ||
        typeof node.properties.name === "string") &&
      (node.children?.length ?? 0) === 0
    ) {
      appendReaderClass(node.properties, "reader-source-anchor");
    }
  }
  for (const child of node.children ?? []) {
    const onlyChild = child.children?.length === 1 ? child.children[0] : undefined;
    if (
      child.tagName === "p" &&
      onlyChild?.tagName === "a" &&
      (onlyChild.children?.length ?? 0) === 0 &&
      onlyChild.properties &&
      (typeof onlyChild.properties.id === "string" ||
        typeof onlyChild.properties.name === "string")
    ) {
      child.tagName = "span";
      child.properties = { ...onlyChild.properties };
      appendReaderClass(child.properties, "reader-source-anchor");
      child.children = [];
    }
    transformReaderMarkdownHast(child);
  }
}

function rehypeReaderPresentation() {
  return (tree: ReaderMarkdownHastNode) => transformReaderMarkdownHast(tree);
}

export const readerRehypePlugins: NonNullable<
  ReactMarkdownOptions["rehypePlugins"]
> = [
  rehypeRaw,
  rehypeSlug,
  [rehypeSanitize, readerSanitizeSchema],
  rehypeReaderPresentation,
];

interface MarkdownFence {
  marker: "`" | "~";
  length: number;
}

interface MarkdownDisplayDelimiter {
  kind: "bracket" | "dollar";
  length: number;
  position: number;
}

interface MarkdownDisplayPair {
  open: MarkdownDisplayDelimiter;
  close: MarkdownDisplayDelimiter;
}

interface MarkdownMathScan {
  pairs: MarkdownDisplayPair[];
  unmatched?: MarkdownDisplayDelimiter;
  orphanClosing?: MarkdownDisplayDelimiter;
}

function markdownFenceAtLineStart(
  markdown: string,
  start: number,
): { fence?: MarkdownFence; lineEnd: number } {
  const lineEnd = markdown.indexOf("\n", start);
  const end = lineEnd === -1 ? markdown.length : lineEnd;
  const line = markdown.slice(start, end);
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  const sequence = match?.[1];
  return {
    fence: sequence
      ? {
          marker: sequence[0] as MarkdownFence["marker"],
          length: sequence.length,
        }
      : undefined,
    lineEnd: end,
  };
}

function closesMarkdownFence(line: string, fence: MarkdownFence): boolean {
  const leadingSpaces = /^ {0,3}/.exec(line)?.[0].length ?? 0;
  let cursor = leadingSpaces;
  while (line[cursor] === fence.marker) cursor += 1;
  return (
    cursor - leadingSpaces >= fence.length &&
    /^[ \t]*$/.test(line.slice(cursor))
  );
}

function isEscapedMarkdownCharacter(markdown: string, position: number): boolean {
  let backslashes = 0;
  for (let cursor = position - 1; cursor >= 0 && markdown[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function markdownLinePrefix(
  markdown: string,
  position: number,
): string | undefined {
  const lineStart = markdown.lastIndexOf("\n", position - 1) + 1;
  const prefix = markdown.slice(lineStart, position);
  return /^(?:[ \t]{0,3}>[ \t]?)*[ \t]{0,3}$/.test(prefix)
    ? prefix
    : undefined;
}

function markdownLineSuffix(markdown: string, position: number): string {
  const lineEnd = markdown.indexOf("\n", position);
  return markdown.slice(position, lineEnd === -1 ? markdown.length : lineEnd);
}

function normalizedOpeningDelimiter(
  markdown: string,
  delimiter: MarkdownDisplayDelimiter,
): string {
  const prefix = markdownLinePrefix(markdown, delimiter.position);
  const next = delimiter.position + delimiter.length;
  const startsBlock = prefix !== undefined;
  const contentStartsOnNextLine = markdown[next] === "\n" || next >= markdown.length;
  return `${startsBlock ? "" : "\n\n"}$$${
    contentStartsOnNextLine ? "" : `\n${prefix ?? ""}`
  }`;
}

function normalizedClosingDelimiter(
  markdown: string,
  pair: MarkdownDisplayPair,
): string {
  const close = pair.close;
  const closePrefix = markdownLinePrefix(markdown, close.position);
  const openPrefix = markdownLinePrefix(markdown, pair.open.position) ?? "";
  const suffix = markdownLineSuffix(
    markdown,
    close.position + close.length,
  );
  return `${closePrefix === undefined ? `\n${openPrefix}` : ""}$$${
    /^[ \t]*$/.test(suffix) ? "" : "\n\n"
  }`;
}

function scanReaderMarkdownMath(markdown: string): MarkdownMathScan {
  const pairs: MarkdownDisplayPair[] = [];
  let fence: MarkdownFence | undefined;
  let inlineCodeTicks = 0;
  let lineStart = true;
  let cursor = 0;
  let openDelimiter: MarkdownDisplayDelimiter | undefined;
  let orphanClosing: MarkdownDisplayDelimiter | undefined;

  while (cursor < markdown.length) {
    if (lineStart && inlineCodeTicks === 0 && !openDelimiter) {
      const line = markdownFenceAtLineStart(markdown, cursor);
      const lineText = markdown.slice(cursor, line.lineEnd);
      if (fence) {
        if (closesMarkdownFence(lineText, fence)) fence = undefined;
        cursor = line.lineEnd;
        lineStart = false;
        continue;
      }
      if (line.fence) {
        fence = line.fence;
        cursor = line.lineEnd;
        lineStart = false;
        continue;
      }
      if (/^(?: {4}|\t)/.test(lineText)) {
        cursor = line.lineEnd;
        lineStart = false;
        continue;
      }
    }

    const character = markdown[cursor];
    if (character === "\n") {
      lineStart = true;
      cursor += 1;
      continue;
    }
    lineStart = false;

    if (character === "`") {
      let end = cursor + 1;
      while (markdown[end] === "`") end += 1;
      const tickCount = end - cursor;
      if (inlineCodeTicks === 0) inlineCodeTicks = tickCount;
      else if (tickCount === inlineCodeTicks) inlineCodeTicks = 0;
      cursor = end;
      continue;
    }

    if (inlineCodeTicks === 0) {
      if (
        character === "\\" &&
        !isEscapedMarkdownCharacter(markdown, cursor)
      ) {
        if (markdown[cursor + 1] === "[" && openDelimiter === undefined) {
          openDelimiter = { kind: "bracket", length: 2, position: cursor };
          cursor += 2;
          continue;
        }
        if (
          markdown[cursor + 1] === "]" &&
          openDelimiter?.kind === "bracket"
        ) {
          pairs.push({
            open: openDelimiter,
            close: { kind: "bracket", length: 2, position: cursor },
          });
          openDelimiter = undefined;
          cursor += 2;
          continue;
        }
        if (
          markdown[cursor + 1] === "]" &&
          openDelimiter === undefined &&
          orphanClosing === undefined
        ) {
          orphanClosing = { kind: "bracket", length: 2, position: cursor };
          cursor += 2;
          continue;
        }
      }
      if (
        character === "$" &&
        markdown[cursor + 1] === "$" &&
        !isEscapedMarkdownCharacter(markdown, cursor)
      ) {
        if (openDelimiter?.kind === "dollar") {
          pairs.push({
            open: openDelimiter,
            close: { kind: "dollar", length: 2, position: cursor },
          });
          openDelimiter = undefined;
          cursor += 2;
          continue;
        }
        if (!openDelimiter && markdownLinePrefix(markdown, cursor) !== undefined) {
          openDelimiter = { kind: "dollar", length: 2, position: cursor };
          cursor += 2;
          continue;
        }
      }
    }
    cursor += 1;
  }

  return { pairs, unmatched: openDelimiter, orphanClosing };
}

function applyReaderMarkdownMathPairs(
  markdown: string,
  pairs: MarkdownDisplayPair[],
): string {
  if (pairs.length === 0) return markdown;
  let normalized = "";
  let sourceCursor = 0;
  for (const pair of pairs) {
    normalized += markdown.slice(sourceCursor, pair.open.position);
    normalized += normalizedOpeningDelimiter(markdown, pair.open);
    normalized += markdown.slice(
      pair.open.position + pair.open.length,
      pair.close.position,
    );
    normalized += normalizedClosingDelimiter(markdown, pair);
    sourceCursor = pair.close.position + pair.close.length;
  }
  return normalized + markdown.slice(sourceCursor);
}

function readerMarkdownLineAt(markdown: string, position: number): number {
  let line = 1;
  for (let cursor = 0; cursor < position; cursor += 1) {
    if (markdown[cursor] === "\n") line += 1;
  }
  return line;
}

function suspiciousReaderMathPair(
  markdown: string,
  pair: MarkdownDisplayPair,
): boolean {
  const source = markdown.slice(
    pair.open.position + pair.open.length,
    pair.close.position,
  );
  const lineCount = (source.match(/\n/g) ?? []).length + 1;
  const containsMarkdownBlock =
    /(?:^|\n)[ \t]{0,3}(?:#{1,6}[ \t]+|`{3,}|~{3,}|(?:[-*_][ \t]*){3,}$|(?:[-+*]|\d+[.)])[ \t]+|>[ \t]?|\|?[ \t]*:?-{3,}:?[ \t]*(?:\||$))/m.test(
      source,
    );
  return (
    source.length > 64 * 1024 ||
    lineCount > 240 ||
    containsMarkdownBlock
  );
}

function escapedReaderMathDelimiter(
  markdown: string,
  delimiter: MarkdownDisplayDelimiter,
): string {
  if (delimiter.kind === "dollar") return "&#36;&#36;";
  return markdown[delimiter.position + 1] === "]" ? "&#92;]" : "&#92;[";
}

function replaceReaderMathDelimiter(
  markdown: string,
  delimiter: MarkdownDisplayDelimiter,
): string {
  return (
    markdown.slice(0, delimiter.position) +
    escapedReaderMathDelimiter(markdown, delimiter) +
    markdown.slice(delimiter.position + delimiter.length)
  );
}

function literalReaderMarkdown(markdown: string): string {
  const escaped = markdown
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<pre><code>${escaped}</code></pre>`;
}

/**
 * Converts bracket-delimited and compact `$$...$$` LaTeX into the line-fenced
 * display syntax understood by remark-math. Malformed delimiters are escaped
 * with a diagnostic so they cannot consume unrelated prose.
 */
export function prepareReaderMarkdown(markdown: string): PreparedReaderMarkdown {
  let prepared = markdown;
  const diagnostics: ReaderMarkdownDiagnostic[] = [];

  for (let recovery = 0; recovery < 64; recovery += 1) {
    const scan = scanReaderMarkdownMath(prepared);
    const suspiciousPair = scan.pairs.find((pair) =>
      suspiciousReaderMathPair(prepared, pair),
    );
    if (suspiciousPair) {
      const line = readerMarkdownLineAt(prepared, suspiciousPair.open.position);
      diagnostics.push({
        code: "suspicious-math-block",
        line,
        message: `A display-math delimiter near line ${line} would consume ordinary Markdown, so the delimiter is shown as source instead.`,
      });
      prepared = replaceReaderMathDelimiter(prepared, suspiciousPair.open);
      continue;
    }

    const unmatched = scan.unmatched ?? scan.orphanClosing;
    if (unmatched) {
      const line = readerMarkdownLineAt(prepared, unmatched.position);
      diagnostics.push({
        code: "unmatched-math-delimiter",
        line,
        message: `An unmatched display-math delimiter near line ${line} is shown literally.`,
      });
      prepared = replaceReaderMathDelimiter(prepared, unmatched);
      continue;
    }

    return {
      content: applyReaderMarkdownMathPairs(prepared, scan.pairs),
      diagnostics,
    };
  }

  diagnostics.push({
    code: "math-recovery-limit",
    line: 1,
    message:
      "The document contains too many ambiguous math delimiters to format safely, so its exact Markdown source is shown instead.",
  });
  return { content: literalReaderMarkdown(markdown), diagnostics };
}

export function normalizeReaderMarkdownMath(markdown: string): string {
  return prepareReaderMarkdown(markdown).content;
}

export interface RenderedReaderMath {
  html?: string;
  invalid: boolean;
  error?: string;
}

let readerKatexModule: Promise<typeof import("katex")> | undefined;

function loadReaderKatex(): Promise<typeof import("katex")> {
  readerKatexModule ??= import("katex");
  return readerKatexModule;
}

export async function renderReaderMath(
  source: string,
  displayMode: boolean,
): Promise<RenderedReaderMath> {
  try {
    const { default: katex } = await loadReaderKatex();
    const html = katex.renderToString(source, {
      displayMode,
      output: "htmlAndMathml",
      strict: "ignore",
      throwOnError: false,
      trust: false,
    });
    return {
      html,
      invalid:
        html.includes("katex-error") || html.includes('mathcolor="#cc0000"'),
    };
  } catch (error) {
    return {
      invalid: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface ReaderLinkDestination {
  projectPath?: string;
  fragment?: string;
  preview?: string;
}

export type ReaderImageDestination =
  | { kind: "direct"; source: string }
  | { kind: "external"; source: string }
  | { kind: "project"; path: string };

export function readerImageDestination(
  currentPath: string,
  source: string | undefined,
): ReaderImageDestination | undefined {
  if (!source || source.startsWith("#") || source.startsWith("//")) {
    return undefined;
  }
  if (/^https?:/i.test(source)) {
    return { kind: "external", source };
  }
  if (/^(?:data:image\/|blob:)/i.test(source)) {
    return { kind: "direct", source };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) return undefined;

  const encodedPath = source.split(/[?#]/, 1)[0];
  let imagePath: string;
  try {
    imagePath = decodeURIComponent(encodedPath);
  } catch {
    imagePath = encodedPath;
  }

  const parts = imagePath.startsWith("/")
    ? []
    : currentPath.split("/").slice(0, -1);
  for (const part of imagePath.replace(/^\/+/, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else if (part === ".git") {
      return undefined;
    } else {
      parts.push(part);
    }
  }
  const path = parts.join("/");
  return path ? { kind: "project", path } : undefined;
}

export function resolveProjectHref(
  currentPath: string,
  href: string | undefined,
): string | undefined {
  if (
    !href ||
    href.startsWith("#") ||
    href.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(href)
  ) {
    return undefined;
  }

  const encodedPath = href.split(/[?#]/, 1)[0];
  if (!encodedPath) return undefined;
  let linkedPath: string;
  try {
    linkedPath = decodeURIComponent(encodedPath);
  } catch {
    linkedPath = encodedPath;
  }

  const parts = linkedPath.startsWith("/")
    ? []
    : currentPath.split("/").slice(0, -1);
  for (const part of linkedPath.replace(/^\/+/, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else if (part === ".git") {
      return undefined;
    } else {
      parts.push(part);
    }
  }
  const candidate = parts.join("/");
  return candidate || undefined;
}

export function readerLinkDestination(
  currentPath: string,
  href: string | undefined,
): ReaderLinkDestination {
  const projectPath = resolveProjectHref(currentPath, href);
  const hashIndex = href?.indexOf("#") ?? -1;
  const fragment =
    hashIndex >= 0 && href && hashIndex + 1 < href.length
      ? href.slice(hashIndex + 1)
      : undefined;
  return {
    projectPath,
    fragment,
    preview:
      projectPath && fragment
        ? `${projectPath}#${fragment}`
        : projectPath ?? href,
  };
}
