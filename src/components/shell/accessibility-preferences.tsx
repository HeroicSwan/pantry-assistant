"use client";

import { useEffect, useState } from "react";

type TextSize = "normal" | "large";
type Density = "compact" | "comfortable";

const eventName = "pantry-assistant:accessibility-changed";

function apply(textSize: TextSize, density: Density) {
  document.documentElement.dataset.textSize = textSize;
  document.documentElement.dataset.density = density;
}

export function AccessibilityPreferences() {
  const [textSize, setTextSize] = useState<TextSize>("normal");
  const [density, setDensity] = useState<Density>("compact");

  useEffect(() => {
    const read = () => {
      const storedTextSize =
        localStorage.getItem("pantry-assistant:text-size") === "large"
          ? "large"
          : "normal";
      const storedDensity =
        localStorage.getItem("pantry-assistant:density") === "comfortable"
          ? "comfortable"
          : "compact";
      setTextSize(storedTextSize);
      setDensity(storedDensity);
      apply(storedTextSize, storedDensity);
    };
    read();
    window.addEventListener(eventName, read);
    return () => window.removeEventListener(eventName, read);
  }, []);

  function update(nextTextSize: TextSize, nextDensity: Density) {
    localStorage.setItem("pantry-assistant:text-size", nextTextSize);
    localStorage.setItem("pantry-assistant:density", nextDensity);
    apply(nextTextSize, nextDensity);
    setTextSize(nextTextSize);
    setDensity(nextDensity);
    window.dispatchEvent(new Event(eventName));
  }

  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold underline decoration-[var(--signal)] decoration-2 underline-offset-4">
        Readability
      </summary>
      <div className="mt-3 grid gap-3 rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-3">
        <fieldset className="grid gap-2">
          <legend className="font-medium">Text size</legend>
          <div className="flex gap-2">
            <button
              type="button"
              aria-pressed={textSize === "normal"}
              onClick={() => update("normal", density)}
              className="min-h-9 border border-[var(--rule)] bg-white px-3 text-xs font-semibold aria-[pressed=true]:border-[var(--ink)] aria-[pressed=true]:bg-[var(--ink)] aria-[pressed=true]:text-white"
            >
              Normal
            </button>
            <button
              type="button"
              aria-pressed={textSize === "large"}
              onClick={() => update("large", density)}
              className="min-h-9 border border-[var(--rule)] bg-white px-3 text-xs font-semibold aria-[pressed=true]:border-[var(--ink)] aria-[pressed=true]:bg-[var(--ink)] aria-[pressed=true]:text-white"
            >
              Large
            </button>
          </div>
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="font-medium">Screen spacing</legend>
          <div className="flex gap-2">
            <button
              type="button"
              aria-pressed={density === "compact"}
              onClick={() => update(textSize, "compact")}
              className="min-h-9 border border-[var(--rule)] bg-white px-3 text-xs font-semibold aria-[pressed=true]:border-[var(--ink)] aria-[pressed=true]:bg-[var(--ink)] aria-[pressed=true]:text-white"
            >
              Compact
            </button>
            <button
              type="button"
              aria-pressed={density === "comfortable"}
              onClick={() => update(textSize, "comfortable")}
              className="min-h-9 border border-[var(--rule)] bg-white px-3 text-xs font-semibold aria-[pressed=true]:border-[var(--ink)] aria-[pressed=true]:bg-[var(--ink)] aria-[pressed=true]:text-white"
            >
              Comfortable
            </button>
          </div>
        </fieldset>
      </div>
    </details>
  );
}
