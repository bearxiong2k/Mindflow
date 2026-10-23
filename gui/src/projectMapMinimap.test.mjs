import assert from "node:assert/strict";
import test from "node:test";

import {
  projectMapMinimapImageSource,
  projectMapMinimapSvg,
} from "./projectMapMinimap.ts";

test("the isolated minimap SVG embeds literal semantic presentation", () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg"><g class="node project-map-node--document"><rect /></g></svg>';
  const result = projectMapMinimapSvg(source);

  assert.match(result, /data-project-map-minimap-style="true"/);
  assert.match(result, /fill: #e6f5f3 !important/);
  assert.match(result, /stroke: #0a7c82 !important/);
  assert.match(result, /stroke: #b65e14 !important;\s+stroke-width: 2\.5px !important;\s+stroke-dasharray: 6 2 !important;/);
  assert.match(result, /\.project-map-layer-cluster > rect/);
  assert.match(result, /\.project-map-connection-hit/);
  assert.doesNotMatch(result, /var\(/);
  assert.ok(result.indexOf("<style") < result.indexOf('<g class="node'));
  assert.equal(projectMapMinimapSvg(result), result);
});

test("the minimap image source encodes the self-contained SVG", () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  const imageSource = projectMapMinimapImageSource(source);
  const decoded = decodeURIComponent(
    imageSource.slice(imageSource.indexOf(",") + 1),
  );

  assert.match(imageSource, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.match(decoded, /data-project-map-minimap-style="true"/);
});
