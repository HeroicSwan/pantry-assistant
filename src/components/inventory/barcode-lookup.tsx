"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function BarcodeLookup({ organizationSlug }: { organizationSlug: string }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const resultHandledRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");

  const stopScanner = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setIsOpen(false);
    setIsStarting(false);
  }, []);

  const openResult = useCallback((code: string) => {
    const normalized = code.trim();
    if (!normalized) return;
    stopScanner();
    router.push(`/app/${organizationSlug}/inventory?q=${encodeURIComponent(normalized)}`);
  }, [organizationSlug, router, stopScanner]);

  useEffect(() => {
    if (!isOpen || !videoRef.current) return;
    let active = true;
    resultHandledRef.current = false;
    setIsStarting(true);
    setError(null);
    void import("@zxing/browser").then(async ({ BrowserMultiFormatReader }) => {
      if (!active || !videoRef.current) return;
      const reader = new BrowserMultiFormatReader();
      try {
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } }, audio: false },
          videoRef.current,
          (result) => {
            if (result && !resultHandledRef.current) {
              resultHandledRef.current = true;
              openResult(result.getText());
            }
          },
        );
        if (!active) controls.stop();
        else controlsRef.current = controls;
      } catch {
        if (active) {
          setError("The camera could not be opened. Check browser permission or use a USB scanner/manual code.");
          setIsStarting(false);
        }
      }
    });
    return () => {
      active = false;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [isOpen, openResult]);

  return <section className="rounded-2xl border border-[var(--rule)] bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold">Barcode lookup</h2><p className="mt-1 text-xs text-[var(--muted)]">Use a USB scanner, type a SKU/PLU, or scan with this device&apos;s camera.</p></div>
      {!isOpen ? <button type="button" onClick={() => setIsOpen(true)} className="min-h-10 rounded-xl border border-[var(--ink)] bg-white px-3 text-sm font-semibold shadow-sm">Use camera</button> : <button type="button" onClick={stopScanner} className="min-h-10 rounded-xl border border-[var(--rule)] bg-white px-3 text-sm font-semibold">Close camera</button>}
    </div>
    <form className="mt-4 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); openResult(manualCode); }}>
      <label className="sr-only" htmlFor="inventory-barcode">Barcode, SKU, or PLU</label>
      <input id="inventory-barcode" value={manualCode} onChange={(event) => setManualCode(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--rule)] bg-white px-3 text-sm shadow-sm" placeholder="Scan or enter barcode, SKU, or PLU" autoComplete="off" />
      <button type="submit" className="min-h-11 rounded-xl border border-[var(--signal)] bg-[var(--signal)] px-4 text-sm font-semibold text-white">Find item</button>
    </form>
    {isOpen ? <div className="mt-4"><video ref={videoRef} className="aspect-video w-full rounded-xl bg-[var(--ink)] object-cover" muted playsInline /><p className="mt-2 text-xs text-[var(--muted)]">{isStarting ? "Starting camera…" : "Point the camera at a supported barcode."}</p>{error ? <p className="mt-2 text-sm text-[var(--signal)]">{error}</p> : null}</div> : null}
  </section>;
}
