import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { interfaceHelpStorageKey, loadInterfaceHelp, saveInterfaceHelp } from "../interfaceHelp";
import { HelpIcon } from "./Icons";

const InterfaceHelpContext = createContext({ enabled: false, toggle: () => {} });

export function InterfaceHelpProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(() => loadInterfaceHelp() ?? false);
  const unsaved = useRef(false);
  useEffect(() => {
    const reload = () => {
      if (unsaved.current) return;
      const stored = loadInterfaceHelp();
      if (stored !== undefined) setEnabled(stored);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === interfaceHelpStorageKey || event.key === null) reload();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", reload);
    reload();
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", reload);
    };
  }, []);
  const toggle = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    unsaved.current = !saveInterfaceHelp(next);
  }, [enabled]);
  const value = useMemo(() => ({ enabled, toggle }), [enabled, toggle]);
  return <InterfaceHelpContext.Provider value={value}>{children}</InterfaceHelpContext.Provider>;
}

/** App-authored guidance only; never wrap project content, data, or errors. */
export function HelpOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return useContext(InterfaceHelpContext).enabled ? children : fallback;
}

export function HelpToggle() {
  const { enabled, toggle } = useContext(InterfaceHelpContext);
  return <button type="button" className="interface-help-toggle" aria-label="Show interface help"
    aria-pressed={enabled} title={enabled ? "Hide explanations" : "Show explanations"} onClick={toggle}>
    <HelpIcon size={14} aria-hidden="true" /><span>Help</span>
  </button>;
}
