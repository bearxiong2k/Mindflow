import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getIdentifier } from "@tauri-apps/api/app";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { isMindDevAppIdentifier } from "./appIdentity";
import { resolveApplicationSurface } from "./readerSurface";
import { InterfaceHelpProvider } from "./components/InterfaceHelp";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Mindflow GUI root element is missing");
const applicationRoot = root;

let windowLabel: string | undefined;
try {
  windowLabel = getCurrentWebviewWindow().label;
} catch {
  // Browser-only frontend inspection has no native window identity.
}
const surface = resolveApplicationSurface(window.location.search, windowLabel);

function DevelopmentWatermark() {
  return (
    <div
      className="development-watermark"
      role="note"
      aria-label="Mind Dev development build"
    >
      <span aria-hidden="true">Mind Dev</span>
    </div>
  );
}

function DevelopmentWatermarkGate({
  identifierRequest,
}: {
  identifierRequest: Promise<string | undefined>;
}) {
  const [development, setDevelopment] = useState(false);
  useEffect(() => {
    let active = true;
    void identifierRequest.then((identifier) => {
      if (active) setDevelopment(isMindDevAppIdentifier(identifier));
    });
    return () => {
      active = false;
    };
  }, [identifierRequest]);
  return development ? <DevelopmentWatermark /> : null;
}

async function renderApplication() {
  const identifierRequest = getIdentifier().catch(() => undefined);
  const applicationPromise =
    surface === "reader"
      ? import("./ReaderApp").then(({ ReaderApp }) => ReaderApp)
      : import("./App").then(({ default: App }) => App);
  const Application = await applicationPromise;
  createRoot(applicationRoot).render(
    <StrictMode>
      <InterfaceHelpProvider><Application /></InterfaceHelpProvider>
      <DevelopmentWatermarkGate identifierRequest={identifierRequest} />
    </StrictMode>,
  );
}

void renderApplication();
