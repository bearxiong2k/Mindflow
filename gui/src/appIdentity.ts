export const MIND_DEV_APP_IDENTIFIER =
  "dev.mindflow.desktop.development";

export function isMindDevAppIdentifier(
  identifier: string | undefined,
): boolean {
  if (identifier === MIND_DEV_APP_IDENTIFIER) return true;
  if (!identifier) return false;

  const isolatedTestPrefix = `${MIND_DEV_APP_IDENTIFIER}.isolated-test.`;
  const namespace = identifier.startsWith(isolatedTestPrefix)
    ? identifier.slice(isolatedTestPrefix.length)
    : "";
  return /^[A-Za-z0-9-]+$/.test(namespace);
}
