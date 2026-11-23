export const readerFontSizeStorageKey = "mindflow:reader-font-size:v1";
export const defaultReaderFontSize = 15;
export const minReaderFontSize = 12;
export const maxReaderFontSize = 24;

interface ReaderStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function localReaderStorage(): ReaderStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function clampReaderFontSize(size: number): number {
  return Number.isFinite(size)
    ? Math.max(minReaderFontSize, Math.min(maxReaderFontSize, Math.round(size)))
    : defaultReaderFontSize;
}

/** Undefined means storage is unavailable; retain the current in-memory size. */
export function loadReaderFontSize(storage = localReaderStorage()): number | undefined {
  if (!storage) return undefined;
  try {
    const size = Number(storage.getItem(readerFontSizeStorageKey));
    return Number.isInteger(size) && size >= minReaderFontSize && size <= maxReaderFontSize
      ? size : defaultReaderFontSize;
  } catch {
    return undefined;
  }
}

export function saveReaderFontSize(size: number, storage = localReaderStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(readerFontSizeStorageKey, String(clampReaderFontSize(size)));
    return true;
  } catch {
    // Presentation preferences must keep working when local storage is blocked.
    return false;
  }
}
