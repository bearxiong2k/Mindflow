const PROJECT_MAP_MINIMAP_STYLE_MARKER =
  'data-project-map-minimap-style="true"';

// The minimap is deliberately an isolated SVG image so its duplicate Mermaid
// IDs and interaction attributes cannot participate in the live canvas. An
// isolated image cannot inherit the application's CSS variables, so embed the
// stable base semantic palette with literal colors before encoding it.
const PROJECT_MAP_MINIMAP_STYLE = `<style ${PROJECT_MAP_MINIMAP_STYLE_MARKER}>
  svg { background: transparent !important; }
  .node.project-map-node--root > rect,
  .node.project-map-node--role > rect,
  .node.project-map-node--component > rect,
  .node.project-map-node--root > path,
  .node.project-map-node--role > path,
  .node.project-map-node--component > path {
    fill: #f3f6fc !important;
    stroke: #7186a3 !important;
    stroke-width: 1.25px !important;
  }
  .node.project-map-node--document > rect,
  .node.project-map-node--document > path,
  .node.project-map-node--document > .outer-path > path {
    fill: #e6f5f3 !important;
    stroke: #0a7c82 !important;
    stroke-width: 1.4px !important;
  }
  .node.project-map-node--external > rect,
  .node.project-map-node--external > polygon,
  .node.project-map-node--external > path {
    fill: #f7edf6 !important;
    stroke: #8e4f86 !important;
    stroke-width: 1.35px !important;
  }
  .node.opening > rect,
  .node.opening > polygon,
  .node.opening > path,
  .node.opening > .outer-path > path {
    stroke: #b65e14 !important;
    stroke-width: 2.5px !important;
    stroke-dasharray: 6 2 !important;
  }
  .node text,
  .node tspan,
  .cluster-label text,
  .cluster-label tspan {
    fill: #14213d !important;
    color: #14213d !important;
  }
  .project-map-layer-cluster > rect {
    fill: #fbfcfd !important;
    fill-opacity: 0.82 !important;
    stroke: #8796a8 !important;
    stroke-width: 1.5px !important;
    stroke-dasharray: 7 5 !important;
  }
  .project-map-layer-cluster.opening > rect {
    stroke: #b65e14 !important;
    stroke-width: 2.5px !important;
    stroke-dasharray: 6 2 !important;
  }
  path[data-project-map-connection="true"]:not(.project-map-connection-hit) {
    fill: none !important;
    stroke: #647187 !important;
  }
  .project-map-connection-hit {
    display: none !important;
  }
  .edgeLabel rect {
    fill: #ffffff !important;
    fill-opacity: 1 !important;
  }
  .edgeLabel text,
  .edgeLabel tspan {
    fill: #14213d !important;
    color: #14213d !important;
  }
</style>`;

export function projectMapMinimapSvg(svg: string) {
  if (!svg || svg.includes(PROJECT_MAP_MINIMAP_STYLE_MARKER)) return svg;
  const rootStart = svg.indexOf("<svg");
  if (rootStart < 0) return svg;
  const rootEnd = svg.indexOf(">", rootStart);
  if (rootEnd < 0) return svg;
  return `${svg.slice(0, rootEnd + 1)}${PROJECT_MAP_MINIMAP_STYLE}${svg.slice(
    rootEnd + 1,
  )}`;
}

export function projectMapMinimapImageSource(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    projectMapMinimapSvg(svg),
  )}`;
}
