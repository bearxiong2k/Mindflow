import { documentDirectory, documentRelationships } from "../types.ts";
import {
  Component,
  createContext,
  isValidElement,
  memo,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ErrorInfo,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import ReactMarkdown, { type ExtraProps } from "react-markdown";
import "katex/dist/katex.min.css";

import { loadReaderImage } from "../api";
import { relationshipStyle } from "../graph";
import { mermaidCodeBlockSource } from "../mermaidRendering";
import {
  prepareReaderMarkdown,
  readerImageDestination,
  readerLinkDestination,
  readerRehypePlugins,
  readerRemarkPlugins,
  renderReaderMath,
  type ReaderMarkdownDiagnostic,
  type RenderedReaderMath,
} from "../readerMarkdown";
import {
  readerNavigationMode,
  type ReaderNavigationMode,
} from "../readerNavigation";
import type {
  DocumentResponse,
  GraphData,
  GraphRelationship,
  InspectionTarget,
  ManagedDocument,
} from "../types";
import { externalTargetLabel, isExternalTarget } from "../types";
import { ArrowIcon, FileIcon } from "./Icons";
import { MermaidDiagram } from "./MermaidDiagram";
import { HelpToggle } from "./InterfaceHelp";

interface DocumentInspectorProps {
  graph: GraphData;
  document: ManagedDocument;
  content: string;
  loading: boolean;
  error?: string;
  inspection: InspectionTarget;
  onInspect: (target?: InspectionTarget) => void;
  onSelect: (
    path: string,
    mode?: ReaderNavigationMode,
    fragment?: string,
  ) => void;
  onPreviewLink: (
    source: "pointer" | "focus",
    address?: string,
  ) => void;
}

interface ReaderMarkdownProps {
  currentPath: string;
  content: string;
  loading: boolean;
  loadingLabel?: string;
  error?: string;
  onSelect: (
    path: string,
    mode?: ReaderNavigationMode,
    fragment?: string,
  ) => void;
  onPreviewLink: DocumentInspectorProps["onPreviewLink"];
}

interface DisplayRelationship {
  relationship: GraphRelationship;
  relationshipIndex: number;
  path?: string;
  label: string;
  incoming: boolean;
}

interface MarkdownNavigation {
  currentPath: string;
  onSelect: (
    path: string,
    mode?: ReaderNavigationMode,
    fragment?: string,
  ) => void;
  onPreviewLink: DocumentInspectorProps["onPreviewLink"];
}

const MarkdownNavigationContext = createContext<MarkdownNavigation | null>(null);
// Image bytes may change independently of the exact Markdown snapshot. Keep
// this separate from navigation so unchanged prose does not need reparsing.
export const ReaderImageRefreshContext = createContext(0);

type MarkdownLinkProps = ComponentPropsWithoutRef<"a"> & ExtraProps;
type MarkdownImageProps = ComponentPropsWithoutRef<"img"> & ExtraProps;
type MarkdownPreProps = ComponentPropsWithoutRef<"pre"> & ExtraProps;
type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & ExtraProps;

function MarkdownLink({
  href,
  children,
  node: _node,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  ...props
}: MarkdownLinkProps) {
  const navigation = useContext(MarkdownNavigationContext);
  const destination = navigation
    ? readerLinkDestination(navigation.currentPath, href)
    : { projectPath: undefined, preview: href };
  const projectPath = destination.projectPath;
  const fragment = destination.fragment;
  const previewHandlers = {
    onPointerEnter: (event: PointerEvent<HTMLAnchorElement>) => {
      onPointerEnter?.(event);
      navigation?.onPreviewLink("pointer", destination.preview);
    },
    onPointerLeave: (event: PointerEvent<HTMLAnchorElement>) => {
      onPointerLeave?.(event);
      navigation?.onPreviewLink("pointer", undefined);
    },
    onFocus: (event: FocusEvent<HTMLAnchorElement>) => {
      onFocus?.(event);
      navigation?.onPreviewLink("focus", destination.preview);
    },
    onBlur: (event: FocusEvent<HTMLAnchorElement>) => {
      onBlur?.(event);
      navigation?.onPreviewLink("focus", undefined);
    },
  };

  if (projectPath && navigation) {
    return (
      <a
        {...props}
        {...previewHandlers}
        href={href}
        onClick={(event) => {
          event.preventDefault();
          navigation.onSelect(
            projectPath,
            readerNavigationMode(event),
            fragment,
          );
        }}
        onKeyDown={(event) => {
          if (
            event.key !== "Enter" ||
            (!event.metaKey && !event.ctrlKey)
          ) return;
          event.preventDefault();
          navigation.onSelect(projectPath, "new-reader", fragment);
        }}
      >
        {children}
      </a>
    );
  }

  const opensExternally = Boolean(href && /^https?:/i.test(href));
  return (
    <a
      {...props}
      {...previewHandlers}
      href={href}
      rel={opensExternally ? "noreferrer" : undefined}
      target={opensExternally ? "_blank" : undefined}
    >
      {children}
    </a>
  );
}

function markdownCodeSource(children: unknown): string | undefined {
  if (typeof children === "string") return children.replace(/\n$/, "");
  if (
    Array.isArray(children) &&
    children.every((child) => typeof child === "string")
  ) {
    return children.join("").replace(/\n$/, "");
  }
  return undefined;
}

function markdownClassIncludes(
  className: string | undefined,
  expected: string,
): boolean {
  return className?.split(/\s+/).includes(expected) ?? false;
}

const readerMathVisibilityCallbacks = new WeakMap<Element, () => void>();
let readerMathObserver: IntersectionObserver | undefined;

function observeReaderMath(
  element: Element,
  reveal: () => void,
): () => void {
  readerMathVisibilityCallbacks.set(element, reveal);
  readerMathObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        readerMathVisibilityCallbacks.get(entry.target)?.();
        readerMathVisibilityCallbacks.delete(entry.target);
        readerMathObserver?.unobserve(entry.target);
      }
    },
    { rootMargin: "720px 0px" },
  );
  readerMathObserver.observe(element);
  return () => {
    readerMathVisibilityCallbacks.delete(element);
    readerMathObserver?.unobserve(element);
  };
}

function ReaderMath({
  source,
  display,
}: {
  source: string;
  display: boolean;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [shouldRender, setShouldRender] = useState(
    () =>
      typeof window === "undefined" ||
      typeof window.IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (shouldRender || !containerRef.current) return;
    return observeReaderMath(containerRef.current, () => setShouldRender(true));
  }, [shouldRender]);

  const [rendered, setRendered] = useState<RenderedReaderMath>();

  useEffect(() => {
    let cancelled = false;
    setRendered(undefined);
    if (!shouldRender) return () => {
      cancelled = true;
    };
    void renderReaderMath(source, display).then((result) => {
      if (!cancelled) setRendered(result);
    });
    return () => {
      cancelled = true;
    };
  }, [display, shouldRender, source]);
  const className = `reader-math${display ? " reader-math--display" : " reader-math--inline"}${
    rendered?.invalid ? " is-error" : ""
  }`;

  if (rendered?.html) {
    return (
      <span
        ref={containerRef}
        className={className}
        title={rendered.invalid ? "Malformed TeX shown by KaTeX" : undefined}
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
    );
  }
  return (
    <span
      ref={containerRef}
      className={className}
      role={rendered?.error ? "math" : undefined}
      title={rendered?.error}
    >
      <code>{source}</code>
    </span>
  );
}

function MarkdownCode({
  className,
  children,
  node: _node,
  ...props
}: MarkdownCodeProps) {
  const source = markdownCodeSource(children);
  if (
    source !== undefined &&
    markdownClassIncludes(className, "math-inline")
  ) {
    return <ReaderMath source={source} display={false} />;
  }
  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

function MarkdownPre({
  children,
  node: _node,
  ...props
}: MarkdownPreProps) {
  if (
    isValidElement<{ className?: string; children?: unknown }>(children)
  ) {
    const mathSource = markdownCodeSource(children.props.children);
    if (
      mathSource !== undefined &&
      markdownClassIncludes(children.props.className, "math-display")
    ) {
      return <ReaderMath source={mathSource} display />;
    }
    const source = mermaidCodeBlockSource(
      children.props.className,
      children.props.children,
    );
    if (source !== undefined) return <MermaidDiagram source={source} />;
  }
  return <pre {...props}>{children}</pre>;
}

function MarkdownImage({
  src,
  alt = "",
  node: _node,
  ...props
}: MarkdownImageProps) {
  const navigation = useContext(MarkdownNavigationContext);
  const imageGeneration = useContext(ReaderImageRefreshContext);
  const previousProjectPathRef = useRef<string | undefined>(undefined);
  const canLoadProjectImage = navigation !== null;
  const destination = readerImageDestination(
    navigation?.currentPath ?? "",
    src,
  );
  const destinationKind = destination?.kind;
  const destinationValue =
    destination?.kind === "project" ? destination.path : destination?.source;
  const [resolvedSource, setResolvedSource] = useState<string | undefined>(
    destination?.kind === "direct" ? destination.source : undefined,
  );
  const [loadError, setLoadError] = useState<string>();
  const [approvedExternalSource, setApprovedExternalSource] =
    useState<string>();
  const externalApproved =
    destinationKind === "external" &&
    destinationValue === approvedExternalSource;

  useEffect(() => {
    let cancelled = false;
    setLoadError(undefined);
    if (destinationKind !== "project") previousProjectPathRef.current = undefined;
    if (destinationKind === "direct") {
      setResolvedSource(destinationValue);
      return () => {
        cancelled = true;
      };
    }
    if (destinationKind === "external") {
      setResolvedSource(externalApproved ? destinationValue : undefined);
      return () => {
        cancelled = true;
      };
    }
    if (
      destinationKind !== "project" ||
      !destinationValue ||
      !canLoadProjectImage
    ) {
      setResolvedSource(undefined);
      setLoadError("Unsupported or invalid image address");
      return () => {
        cancelled = true;
      };
    }

    if (previousProjectPathRef.current !== destinationValue) setResolvedSource(undefined);
    previousProjectPathRef.current = destinationValue;
    void loadReaderImage(destinationValue)
      .then((dataUrl) => {
        if (!cancelled) setResolvedSource(dataUrl);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResolvedSource(undefined);
        setLoadError(
          error instanceof Error ? error.message : String(error),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [
    canLoadProjectImage,
    destinationKind,
    destinationValue,
    externalApproved,
    imageGeneration,
  ]);

  if (resolvedSource) {
    return (
      <img
        {...props}
        src={resolvedSource}
        alt={alt}
        loading={props.loading ?? "lazy"}
      />
    );
  }
  if (destinationKind === "external" && destinationValue) {
    return (
      <span className="reader-image-placeholder reader-image-placeholder--external">
        <span>{`External image blocked${alt ? `: ${alt}` : ""}`}</span>
        <button
          type="button"
          onClick={() => setApprovedExternalSource(destinationValue)}
        >
          Load image
        </button>
      </span>
    );
  }
  return (
    <span
      className={`reader-image-placeholder${
        loadError ? " is-error" : ""
      }`}
      role={loadError ? "img" : "status"}
      aria-label={loadError ? alt || "Image unavailable" : undefined}
      title={loadError}
    >
      {loadError
        ? `Image unavailable${alt ? `: ${alt}` : ""}`
        : `Loading image${alt ? `: ${alt}` : ""}…`}
    </span>
  );
}

const markdownComponents = {
  a: MarkdownLink,
  code: MarkdownCode,
  img: MarkdownImage,
  pre: MarkdownPre,
};

function readerMarkdownRevision(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${content.length}:${hash >>> 0}`;
}

function ReaderSourceFallback({
  content,
  summary = "Show exact Markdown source",
}: {
  content: string;
  summary?: string;
}) {
  return (
    <details className="reader-source-fallback">
      <summary>{summary}</summary>
      <pre>
        <code>{content}</code>
      </pre>
    </details>
  );
}

function ReaderCompatibilityNotices({
  content,
  diagnostics,
}: {
  content: string;
  diagnostics: ReaderMarkdownDiagnostic[];
}) {
  if (diagnostics.length === 0) return null;
  return (
    <aside className="reader-compatibility-notice" role="note">
      <strong>
        {diagnostics.length === 1
          ? "1 rendering compatibility notice"
          : `${diagnostics.length} rendering compatibility notices`}
      </strong>
      <ul>
        {diagnostics.map((diagnostic, index) => (
          <li key={`${diagnostic.code}:${diagnostic.line}:${index}`}>
            {diagnostic.message}
          </li>
        ))}
      </ul>
      <ReaderSourceFallback content={content} />
    </aside>
  );
}

interface ReaderMarkdownBoundaryProps {
  children: ReactNode;
  content: string;
  revision: string;
}

interface ReaderMarkdownBoundaryState {
  error?: string;
}

class ReaderMarkdownBoundary extends Component<
  ReaderMarkdownBoundaryProps,
  ReaderMarkdownBoundaryState
> {
  state: ReaderMarkdownBoundaryState = {};

  static getDerivedStateFromError(error: unknown): ReaderMarkdownBoundaryState {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(_error: unknown, _info: ErrorInfo): void {
    // The visible fallback is the diagnostic surface; no document state changes.
  }

  componentDidUpdate(previous: ReaderMarkdownBoundaryProps): void {
    if (
      this.state.error &&
      previous.revision !== this.props.revision
    ) {
      this.setState({ error: undefined });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="reader-render-error" role="alert">
        <strong>The formatted Reader could not render this document.</strong>
        <span>{this.state.error}</span>
        <ReaderSourceFallback
          content={this.props.content}
          summary="Read exact Markdown source"
        />
      </div>
    );
  }
}

export const ReaderMarkdown = memo(function ReaderMarkdown({
  currentPath,
  content,
  loading,
  loadingLabel = "Reading managed document…",
  error,
  onSelect,
  onPreviewLink,
}: ReaderMarkdownProps) {
  const markdownNavigation = useMemo(
    () => ({
      currentPath,
      onSelect,
      onPreviewLink,
    }),
    [currentPath, onPreviewLink, onSelect],
  );
  const deferredContent = useDeferredValue(content, "");
  const prepared = useMemo(
    () => prepareReaderMarkdown(deferredContent),
    [deferredContent],
  );
  const revision = useMemo(
    () => readerMarkdownRevision(deferredContent),
    [deferredContent],
  );
  const preparing = !loading && !error && deferredContent !== content;

  useEffect(() => {
    if (loading || error || preparing) return;
    performance.mark("mindflow:reader:formatted-content-commit");
  }, [error, loading, preparing, revision]);

  return (
    <section className="markdown-reader">
      {loading ? (
        <div className="reader-message" role="status" aria-live="polite">
          {loadingLabel}
        </div>
      ) : null}
      {error ? (
        <div className="reader-message reader-message--error" role="alert">
          {error}
        </div>
      ) : null}
      {preparing ? (
        <div className="reader-message" role="status" aria-live="polite">
          Preparing formatted document…
        </div>
      ) : null}
      {!loading && !error && !preparing ? (
        <MarkdownNavigationContext.Provider value={markdownNavigation}>
          <ReaderCompatibilityNotices
            content={content}
            diagnostics={prepared.diagnostics}
          />
          <ReaderMarkdownBoundary
            content={content}
            revision={`${currentPath}:${revision}`}
          >
            <div className="markdown-reader__content">
              <ReactMarkdown
                components={markdownComponents}
                rehypePlugins={readerRehypePlugins}
                remarkPlugins={readerRemarkPlugins}
              >
                {prepared.content}
              </ReactMarkdown>
            </div>
          </ReaderMarkdownBoundary>
        </MarkdownNavigationContext.Provider>
      ) : null}
    </section>
  );
});

function ProjectImageReader({
  path,
  loading,
  error,
  generation,
}: {
  path: string;
  loading: boolean;
  error?: string;
  generation?: number;
}) {
  const [source, setSource] = useState<string>();
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    if (loading || error) return () => { cancelled = true; };
    void loadReaderImage(path)
      .then((dataUrl) => {
        if (!cancelled) {
          setSource(dataUrl);
          setLoadError(undefined);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setLoadError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => { cancelled = true; };
  }, [error, generation, loading, path]);

  if (loading) return <div className="reader-message">Reading project image…</div>;
  if (error || loadError) {
    return <div className="reader-message reader-message--error">{error ?? loadError}</div>;
  }
  if (!source) return <div className="reader-message">Loading project image…</div>;
  return (
    <div className="project-image-reader">
      <img src={source} alt={path.split("/").at(-1) ?? path} />
    </div>
  );
}

export const ProjectDocumentInspector = memo(
  function ProjectDocumentInspector({
    path,
    document,
    imageGeneration,
    loading,
    error,
    onSelect,
    onPreviewLink,
  }: {
    path: string;
    document: DocumentResponse;
    imageGeneration?: number;
    loading: boolean;
    error?: string;
    onSelect: (path: string, mode?: ReaderNavigationMode) => void;
    onPreviewLink: DocumentInspectorProps["onPreviewLink"];
  }) {
    return (
      <article
        className="document-inspector document-inspector--window"
        aria-label="Project file reader"
      >
        <header className="document-meta document-meta--project">
          <div className="document-meta__heading">
            <div className="document-path" title={path}>{path}</div>
            <HelpToggle />
          </div>
          <dl>
            <div>
              <dt>Category:</dt>
              <dd>Project file</dd>
            </div>
            <div>
              <dt>View:</dt>
              <dd>{document.contentKind}</dd>
            </div>
          </dl>
        </header>
        {document.contentKind === "markdown" ? (
          <ReaderMarkdown
            currentPath={path}
            content={document.content}
            loading={loading}
            loadingLabel="Reading project Markdown…"
            error={error}
            onSelect={onSelect}
            onPreviewLink={onPreviewLink}
          />
        ) : document.contentKind === "text" ? (
          <section className="project-text-reader" aria-live="polite">
            {loading ? <div className="reader-message">Reading project text…</div> : null}
            {error ? <div className="reader-message reader-message--error">{error}</div> : null}
            {!loading && !error ? <pre>{document.content}</pre> : null}
          </section>
        ) : (
          <ProjectImageReader path={path} loading={loading} error={error} generation={imageGeneration} />
        )}
      </article>
    );
  },
);

function displayTarget(relationship: GraphRelationship): string {
  return typeof relationship.target === "string"
    ? relationship.target
    : externalTargetLabel(relationship.target);
}

export const DocumentInspector = memo(function DocumentInspector({
  graph,
  document,
  content,
  loading,
  error,
  inspection,
  onInspect,
  onSelect,
  onPreviewLink,
}: DocumentInspectorProps) {
  const relationships = useMemo(() => {
    const result: DisplayRelationship[] = [];
    for (const [relationshipIndex, relationship] of documentRelationships(graph).entries()) {
      if (relationship.source === document.path) {
        result.push({
          relationship,
          relationshipIndex,
          path: typeof relationship.target === "string" ? relationship.target : undefined,
          label: displayTarget(relationship),
          incoming: false,
        });
      } else if (relationship.target === document.path) {
        result.push({
          relationship,
          relationshipIndex,
          path: relationship.source,
          label: relationship.source,
          incoming: true,
        });
      }
    }
    return result;
  }, [document.path, graph]);

  const groupedRelationships = useMemo(() => {
    const grouped = new Map<string, DisplayRelationship[]>();
    for (const relationship of relationships) {
      const current = grouped.get(relationship.relationship.type);
      if (current) current.push(relationship);
      else grouped.set(relationship.relationship.type, [relationship]);
    }
    return [...grouped.entries()];
  }, [relationships]);
  return (
    <article className="document-inspector document-inspector--window" aria-label="Document inspector">
      <header className="document-meta">
        <div className="document-meta__heading">
          <div className="document-path" title={document.path}>{document.path}</div>
          <HelpToggle />
        </div>
        <dl>
          <div>
            <dt>Folder:</dt>
            <dd>{documentDirectory(document)}</dd>
          </div>
        </dl>
      </header>

      <ReaderMarkdown
        currentPath={document.path}
        content={content}
        loading={loading}
        error={error}
        onSelect={onSelect}
        onPreviewLink={onPreviewLink}
      />

      <section className="relationship-inspector">
        <h2>Relationships</h2>
        {groupedRelationships.length === 0 ? (
          <p className="empty-relationships">No relationships are declared for this document.</p>
        ) : (
          groupedRelationships.map(([type, entries]) => {
            const style = relationshipStyle(type);
            return (
              <div className="relationship-group" key={type}>
                <h3 style={{ color: style.color }}>{style.label} ({entries.length})</h3>
                {entries.map(({ relationship, relationshipIndex, path, label, incoming }, index) => {
                  const external = isExternalTarget(relationship.target);
                  const target: InspectionTarget = {
                    kind: "relationship",
                    index: relationshipIndex,
                  };
                  const inspected =
                    inspection.kind === "relationship" &&
                    inspection.index === relationshipIndex;
                  return (
                    <button
                      type="button"
                      className={`relationship-row${inspected ? " is-inspected" : ""}`}
                      key={`${relationship.source}:${label}:${index}`}
                      aria-label={`${incoming ? "incoming" : "outgoing"} ${relationship.type} relationship with ${label}`}
                      onClick={
                        path
                          ? (event) =>
                              onSelect(path, readerNavigationMode(event))
                          : undefined
                      }
                      onPointerEnter={() => onInspect(target)}
                      onPointerLeave={() => onInspect(undefined)}
                      onFocus={() => onInspect(target)}
                      onBlur={() => onInspect(undefined)}
                      disabled={!path}
                    >
                      <span
                        className={`relationship-row__arrow${incoming ? " is-incoming" : ""}`}
                        style={{ color: style.color }}
                      >
                        <ArrowIcon />
                      </span>
                      <FileIcon />
                      <span className="relationship-row__label">{label}</span>
                      {external ? <span className="relationship-row__kind">external</span> : null}
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
      </section>
    </article>
  );
});
