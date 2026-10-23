import { relationshipStyle } from "../graph";
import type { RegionResponse } from "../types";
import { CloseIcon, MindflowMark } from "./Icons";

interface RegionOverviewProps {
  region: RegionResponse;
  onClose: () => void;
}

function directionLabel(direction: "directional" | "bidirectional" | "either") {
  if (direction === "directional") return "directional →";
  if (direction === "bidirectional") return "bidirectional ↔";
  return "either → / ↔";
}

export function RegionOverview({ region, onClose }: RegionOverviewProps) {
  const { graph, status } = region;
  const relationshipTypes = Object.entries(graph.relationship_types);
  const anchorConnectionTypes = Object.entries(graph.anchor_connection_types);
  const anchors = Object.entries(graph.anchors);

  return (
    <aside
      className="region-overview"
      role="dialog"
      aria-modal="false"
      aria-label={`Region: ${region.project}`}
    >
      <header className="region-overview__bar">
        <span className="region-overview__title">
          <MindflowMark size={15} />
          <span>Region</span>
        </span>
        <span className="region-overview__project" title={region.root}>
          {region.project}
        </span>
        <button type="button" onClick={onClose} aria-label="Close region overview">
          <CloseIcon />
        </button>
      </header>

      <div className="region-overview__content">
        <section className="region-overview__summary" aria-label="Validated region summary">
          <div className="region-overview__slice">
            <span className="region-overview__valid-mark" aria-hidden="true" />
            <span>Validated working tree</span>
          </div>
          <code title={region.root}>{region.root}</code>
          <dl className="region-stat-grid">
            <div>
              <dt>Documents</dt>
              <dd>{status.documents}</dd>
            </div>
            <div>
              <dt>Relationships</dt>
              <dd>{status.relationships}</dd>
            </div>
            <div className="is-opening">
              <dt>Opening</dt>
              <dd>{status.opening_files}</dd>
            </div>
            <div className="is-opening">
              <dt>Events</dt>
              <dd>{status.evolve_events}</dd>
            </div>
            <div>
              <dt>Managed entries</dt>
              <dd>{status.components}</dd>
            </div>
            <div>
              <dt>Anchors</dt>
              <dd>{status.anchors}</dd>
            </div>
          </dl>
        </section>

        <section className="region-overview__section">
          <h2>Project vocabulary</h2>
          <h3>Relationship types</h3>
          <div className="vocabulary-list">
            {relationshipTypes.map(([name, definition]) => {
              const style = relationshipStyle(name);
              return (
                <article className="vocabulary-entry" key={name}>
                  <header>
                    <span
                      className="vocabulary-color"
                      style={{ background: style.color }}
                      aria-hidden="true"
                    />
                    <code>{name}</code>
                    <span className="vocabulary-badge">
                      {directionLabel(definition.direction)}
                    </span>
                  </header>
                  <p>{definition.description}</p>
                </article>
              );
            })}
          </div>

          {anchorConnectionTypes.length > 0 ? (
            <>
              <h3>Anchor connection types</h3>
              <div className="vocabulary-list">
                {anchorConnectionTypes.map(([name, definition]) => {
                  const style = relationshipStyle(name);
                  return (
                    <article className="vocabulary-entry" key={name}>
                      <header>
                        <span
                          className="vocabulary-color"
                          style={{ background: style.color }}
                          aria-hidden="true"
                        />
                        <code>{name}</code>
                        <span className="vocabulary-badge">
                          current → history
                        </span>
                      </header>
                      <p>{definition.description}</p>
                    </article>
                  );
                })}
              </div>
            </>
          ) : null}
        </section>

        <section className="region-overview__section">
          <h2>Anchors</h2>
          {anchors.length === 0 ? (
            <p className="region-overview__empty">No stable anchors are declared.</p>
          ) : (
            <div className="region-object-list">
              {anchors.map(([name, anchor]) => (
                <details key={name}>
                  <summary>
                    <code>{name}</code>
                    <span>
                      {anchor.connections.length} historical {anchor.connections.length === 1 ? "connection" : "connections"}
                    </span>
                  </summary>
                  {anchor.description ? <p>{anchor.description}</p> : null}
                  <dl>
                    <div><dt>File</dt><dd><code>{anchor.file}</code></dd></div>
                    <div><dt>Commit</dt><dd><code title={anchor.commit}>{anchor.commit}</code></dd></div>
                  </dl>
                  {anchor.connections.length > 0 ? (
                    <ul>
                      {anchor.connections.map((connection) => (
                        <li key={`${connection.type}\u0000${connection.target}`}>
                          <strong>{connection.type}</strong>{" "}
                          <code>{connection.target}</code>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </details>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
