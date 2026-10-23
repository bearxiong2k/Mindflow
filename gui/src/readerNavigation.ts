export type ReaderNavigationMode = "same-reader" | "new-reader";

export const READER_CONTENT_ID_PREFIX = "reader-content-";

export function readerContentId(fragment: string): string {
  const withoutHash = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  let decoded = withoutHash;
  try {
    decoded = decodeURIComponent(withoutHash);
  } catch {
    // Keep a malformed but harmless fragment inspectable as written.
  }
  return decoded.startsWith(READER_CONTENT_ID_PREFIX)
    ? decoded
    : `${READER_CONTENT_ID_PREFIX}${decoded}`;
}

export type ReaderDocumentActivation = (
  path: string,
  mode?: ReaderNavigationMode,
) => void;

export function readerNavigationMode(modifiers: {
  metaKey: boolean;
  ctrlKey?: boolean;
}): ReaderNavigationMode {
  return modifiers.metaKey || modifiers.ctrlKey
    ? "new-reader"
    : "same-reader";
}
