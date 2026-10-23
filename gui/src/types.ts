export type Direction = "source-to-target" | "bidirectional";

/** A registered non-document endpoint, represented by its current path for Reader UI. */
export type ExternalTarget = { path: string };

export type RelationshipTarget = string | ExternalTarget;

export interface Relationship {
  type: string;
  direction: Direction;
  target: RelationshipTarget;
}

export interface GraphRelationship extends Relationship {
  source: string;
}

export interface OpeningFile {
  path: string;
  component: string;
}

export type InspectionTarget =
  | { kind: "document"; path: string }
  | { kind: "relationship"; index: number };

export interface ManagedDocument {
  component: string;
  path: string;
  index: boolean;
  content: { sha256: string; bytes: number };
}

export interface StructureNode {
  path: string;
  name: string;
  kind: "directory" | "document" | "target";
  parent_path?: string;
  component?: { id: string; description?: string; index: boolean };
  document?: ManagedDocument;
}

export interface StructureProjection {
  nodes: StructureNode[];
  relationships: ProjectMapRelationship[];
}

export interface RelationshipTypeDefinition {
  description: string;
  direction: "directional" | "bidirectional" | "either";
}

export interface AnchorConnectionTypeDefinition {
  description: string;
}

export interface AnchorConnection {
  type: string;
  target: string;
}

export interface AnchorDefinition {
  file: string;
  component: string;
  commit: string;
  connections: AnchorConnection[];
  description?: string | null;
}

export interface AnchorTimelineSlice {
  name: string;
  commit: string;
  event_boundary: number | null;
}

export interface TimelineCommit {
  commit: string;
  event_boundary: number | null;
}

export interface EvolveEvent {
  name: string;
  description?: string | null;
  predecessors: string[];
  successors: string[];
}

export interface Diagnostic {
  severity: "error" | "warning";
  code: string;
  path?: string;
  message: string;
}

export interface SnapshotIdentity {
  version: number;
  id: `sha256:${string}`;
  revision: "working-tree";
  head?: string;
}

export interface RegionStatus {
  root: string;
  revision: "working-tree";
  snapshot: SnapshotIdentity;
  valid: boolean;
  documents: number;
  components: number;
  relationships: number;
  opening_files: number;
  evolve_events: number;
  anchors: number;
  diagnostics: Diagnostic[];
}

export const CURRENT_PROJECT_FORMAT = "2026-10-20";

export interface GraphData {
  format: string;
  structure: StructureProjection;
  documents: ManagedDocument[];
  relationship_types: Record<string, RelationshipTypeDefinition>;
  anchor_connection_types: Record<string, AnchorConnectionTypeDefinition>;
  historical_components: Record<string, {path: string; description?: string}>;
  events: EvolveEvent[];
  anchors: Record<string, AnchorDefinition>;
}

export type ProjectMapDirection = "lr" | "rl" | "tb" | "td" | "bt";

// Disposable canvas nodes, derived exclusively from StructureProjection.
export type ProjectComponentKind = "directory" | "document" | "target";
export type ProjectBinding = { kind: "directory" | "path"; value: string };

export interface ProjectComponent {
  id: string;
  label: string;
  kind: ProjectComponentKind;
  parent?: string;
  description?: string;
  binding?: ProjectBinding;
  index?: boolean;
  managed: boolean;
  componentId?: string;
  order: number;
}

export interface ProjectMapRelationship {
  source: string;
  type: string;
  direction: Direction;
  target: string;
  line?: "dotted";
}

export interface ProjectMap {
  direction: ProjectMapDirection;
  root: string;
  components: ProjectComponent[];
  relationships: ProjectMapRelationship[];
}

export interface RegionResponse {
  version: import("./versionInfo").ProjectVersion;
  root: string;
  project: string;
  slice: "working-tree";
  status: RegionStatus;
  graph: GraphData;
  opening: Opening;
  anchor_timeline: AnchorTimelineSlice[];
  timeline_commits: TimelineCommit[];
}

export interface FolderResponse {
  root: string;
  project: string;
}

export type OpenRegionResponse =
  | { status: "region"; region: RegionResponse }
  | ({ status: "folder" } & FolderResponse)
  | {
      status: "error";
      requested_path: string;
      root?: string;
      project: string;
      message: string;
    };

export type RefreshProjectResponse =
  | { action: "region"; region: RegionResponse }
  | ({ action: "folder" } & FolderResponse)
  | { action: "relaunch" };

export interface Opening {
  files: OpeningFile[];
}

export interface DocumentResponse {
  path: string;
  content: string;
  contentKind: "markdown" | "text" | "image";
  mimeType?: string;
}

export interface ProjectEntry {
  path: string;
  name: string;
  kind: "directory" | "file";
}

export interface ProjectDirectoryResponse {
  path: string;
  entries: ProjectEntry[];
}

export interface FolderPickerEntry {
  path: string;
  name: string;
}

export interface FolderPickerResponse {
  path: string;
  parent?: string;
  entries: FolderPickerEntry[];
}

export interface ReaderWindowSnapshot {
  root: string;
  project: string;
  path: string;
  snapshot?: SnapshotIdentity;
  fragment?: string;
  graph: GraphData;
  document: DocumentResponse;
  kind: "managed" | "project";
  interfaceScale: number;
}

export function managedFileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function externalTargetLabel(target: ExternalTarget): string {
  return target.path;
}

export function isExternalTarget(
  target: RelationshipTarget,
): target is ExternalTarget {
  return typeof target !== "string";
}

export function documentDirectory(document: { path: string }): string {
  const slash = document.path.lastIndexOf("/");
  return slash < 0 ? "." : document.path.slice(0, slash);
}

/** Reader links are paths; relationship ownership remains the stable IDs in Structure. */
export function documentRelationships(graph: GraphData): GraphRelationship[] {
  const paths = new Map(graph.structure.nodes.flatMap(node =>
    node.component ? [[node.component.id, node.path] as const] : [],
  ));
  const documents = new Set(graph.documents.map(document => document.component));
  return graph.structure.relationships.map(relation => ({
    ...relation,
    source: paths.get(relation.source)!,
    target: documents.has(relation.target)
      ? paths.get(relation.target)!
      : { path: paths.get(relation.target)! },
  }));
}

/** Exact path correspondence for a disposable historical overlay, never admission. */
export function timelineIdentitiesForPaths(graph: GraphData, paths: readonly string[]): string[] {
  const candidates = [
    ...graph.documents.map(document => [document.component, document.path] as const),
    ...Object.entries(graph.historical_components).map(([id, record]) => [id, record.path] as const),
  ];
  const identities = new Set<string>();
  for (const path of paths) {
    for (const [identity, binding] of candidates) {
      if (binding === path) identities.add(identity);
    }
  }
  return [...identities];
}
