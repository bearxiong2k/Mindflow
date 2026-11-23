import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { defaultReaderFontSize, maxReaderFontSize, minReaderFontSize } from "../readerPreferences";
import { PinIcon } from "./Icons";

export function ReaderControls({ fontSize, onFontSizeChange }: {
  fontSize: number;
  onFontSizeChange: (size: number) => void;
}) {
  const nativeWindow = useMemo(() => isTauri() ? getCurrentWindow() : undefined, []);
  const pinRequest = useRef(0);
  const changingPin = useRef(false);
  const [pin, setPin] = useState<{ pinned: boolean; busy: boolean; error?: string }>({
    pinned: false, busy: Boolean(nativeWindow),
  });

  useEffect(() => {
    if (!nativeWindow) return;
    let active = true;
    const readPin = async () => {
      if (changingPin.current) return;
      const request = ++pinRequest.current;
      try {
        const pinned = await nativeWindow.isAlwaysOnTop();
        if (active && request === pinRequest.current) setPin({ pinned, busy: false });
      } catch (error) {
        if (active && request === pinRequest.current) {
          setPin((current) => ({ ...current, busy: false, error: `Could not read window pin: ${String(error)}` }));
        }
      }
    };
    void readPin();
    window.addEventListener("focus", readPin);
    return () => {
      active = false;
      pinRequest.current += 1;
      window.removeEventListener("focus", readPin);
    };
  }, [nativeWindow]);

  const togglePin = async () => {
    if (!nativeWindow || changingPin.current) return;
    changingPin.current = true;
    const request = ++pinRequest.current;
    const pinned = !pin.pinned;
    setPin((current) => ({ ...current, busy: true, error: undefined }));
    try {
      await nativeWindow.setAlwaysOnTop(pinned);
      if (request === pinRequest.current) setPin({ pinned, busy: false });
    } catch (error) {
      if (request === pinRequest.current) {
        setPin((current) => ({ ...current, busy: false, error: `Could not change window pin: ${String(error)}` }));
      }
    } finally {
      changingPin.current = false;
    }
  };

  return (
    <div className="reader-controls" aria-label="Reader controls">
      <div className="reader-font-controls" role="group" aria-label="Reader font size">
        <button type="button" aria-label="Decrease font size" title="Decrease font size"
          disabled={fontSize <= minReaderFontSize} onClick={() => onFontSizeChange(fontSize - 1)}>
          A−
        </button>
        <button type="button" className="reader-font-size"
          aria-label={`Font size ${fontSize}px. Reset to ${defaultReaderFontSize}px`}
          title={`Reset font size to ${defaultReaderFontSize}px`}
          onClick={() => onFontSizeChange(defaultReaderFontSize)}>
          {fontSize}<span aria-hidden="true">px</span>
        </button>
        <button type="button" aria-label="Increase font size" title="Increase font size"
          disabled={fontSize >= maxReaderFontSize} onClick={() => onFontSizeChange(fontSize + 1)}>
          A+
        </button>
      </div>
      <button type="button" className="reader-pin" aria-label="Keep Reader window on top"
        aria-pressed={pin.pinned} disabled={!nativeWindow || pin.busy}
        title={!nativeWindow ? "Window pinning is available in the desktop app"
          : pin.pinned ? "Unpin this Reader window" : "Keep this Reader above other windows"}
        onClick={() => { void togglePin(); }}>
        <PinIcon size={14} aria-hidden="true" /><span>{pin.pinned ? "Pinned" : "Pin"}</span>
      </button>
      {pin.error ? <p className="reader-controls-error" role="alert">{pin.error}</p> : null}
    </div>
  );
}
