import { normalizeCanvasTextScale } from "./canvasTextScale";

type Mermaid = typeof import("mermaid")["default"];

let mermaidRequest: Promise<Mermaid> | undefined;
let mermaidRenderOperation: Promise<void> = Promise.resolve();

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
) {
  const operation = async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize(mermaidConfiguration(textScale));
    return mermaid.render(diagramId, source);
  };
  const result = mermaidRenderOperation.then(operation, operation);
  mermaidRenderOperation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
