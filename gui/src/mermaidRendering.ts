export function mermaidCodeBlockSource(
  className: string | undefined,
  content: unknown,
): string | undefined {
  const languageClasses = (className ?? "").split(/\s+/);
  if (!languageClasses.includes("language-mermaid")) return undefined;
  return codeBlockText(content);
}

function codeBlockText(content: unknown): string {
  if (Array.isArray(content)) return content.map(codeBlockText).join("");
  if (typeof content === "string" || typeof content === "number") {
    return String(content);
  }
  return "";
}

export interface MermaidSvgSize {
  width: number;
  height: number;
}

const DEFAULT_MERMAID_SVG_SIZE: MermaidSvgSize = {
  width: 960,
  height: 540,
};

export function mermaidSvgSize(svg: string): MermaidSvgSize {
  const viewBox = svg.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1];
  const values = viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = values?.[2];
  const height = values?.[3];
  if (
    width !== undefined &&
    height !== undefined &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    return { width, height };
  }
  return DEFAULT_MERMAID_SVG_SIZE;
}
