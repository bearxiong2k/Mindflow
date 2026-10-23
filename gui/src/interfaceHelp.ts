export const interfaceHelpStorageKey = "mindflow:interface-help:v1";

interface HelpStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function localHelpStorage(): HelpStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Undefined means storage is unavailable; keep the current in-memory choice. */
export function loadInterfaceHelp(storage = localHelpStorage()): boolean | undefined {
  if (!storage) return undefined;
  try {
    return storage.getItem(interfaceHelpStorageKey) === "true";
  } catch {
    return undefined;
  }
}

export function saveInterfaceHelp(enabled: boolean, storage = localHelpStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(interfaceHelpStorageKey, String(enabled));
    return true;
  } catch {
    // Help is optional presentation; unavailable storage must not block it.
    return false;
  }
}
