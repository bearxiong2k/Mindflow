import { normalizeCanvasTextScale } from "./canvasTextScale";
import { createMermaidRenderQueue, mermaidRenderAborted, type MermaidRenderOptions } from "./mermaidRenderQueue.ts";

type Mermaid = typeof import("mermaid")["default"];

let mermaidRequest: Promise<Mermaid> | undefined;
const enqueueMermaidRender = createMermaidRenderQueue();

function mermaidConfiguration(textScale = 1) {
  const fontSize = 16 * normalizeCanvasTextScale(textScale);
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    suppressErrorRendering: true,
    theme: "neutral" as const,
    logLevel: "fatal" as const,
    htmlLabels: false,
    fontSize,
    themeVariables: {
      fontSize: `${fontSize}px`,
    },
  };
}

function loadMermaid(): Promise<Mermaid> {
  if (!mermaidRequest) {
    mermaidRequest = import("mermaid")
      .then(({ default: mermaid }) => {
        mermaid.initialize(mermaidConfiguration());
        return mermaid;
      })
      .catch((error: unknown) => {
        mermaidRequest = undefined;
        throw error;
      });
  }
  return mermaidRequest;
}

export function renderMermaid(
  diagramId: string,
  source: string,
  textScale = 1,
  options: MermaidRenderOptions = {},
) {
  const operation = async () => {
    const mermaid = await loadMermaid();
    if (options.signal?.aborted) throw mermaidRenderAborted();
    mermaid.initialize(mermaidConfiguration(textScale));
    return mermaid.render(diagramId, source);
  };
  return enqueueMermaidRender(operation, options);
}
