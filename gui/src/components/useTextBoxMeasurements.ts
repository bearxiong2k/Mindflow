import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { TextBoxMeasurement } from "../interactionGeometry";

function measurementsMatch(
  left: ReadonlyMap<string, TextBoxMeasurement>,
  right: ReadonlyMap<string, TextBoxMeasurement>,
) {
  return (
    left.size === right.size &&
    [...right].every(([key, size]) => {
      const current = left.get(key);
      return current?.width === size.width && current.height === size.height;
    })
  );
}

export function useTextBoxMeasurements(visibleKeys: readonly string[]) {
  const elements = useRef(new Map<string, HTMLDivElement>());
  const [measurements, setMeasurements] = useState(
    () => new Map<string, TextBoxMeasurement>(),
  );
  const registerElement = useCallback(
    (key: string, element: HTMLDivElement | null) => {
      if (element) elements.current.set(key, element);
      else elements.current.delete(key);
    },
    [],
  );

  useLayoutEffect(() => {
    const visible = new Set(visibleKeys);
    const measure = () => {
      const next = new Map<string, TextBoxMeasurement>();
      for (const [key, element] of elements.current) {
        if (!visible.has(key)) continue;
        next.set(key, {
          width: element.offsetWidth,
          height: element.offsetHeight,
        });
      }
      setMeasurements((current) =>
        measurementsMatch(current, next) ? current : next,
      );
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    for (const [key, element] of elements.current) {
      if (visible.has(key)) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [visibleKeys]);

  return { measurements, registerElement };
}
