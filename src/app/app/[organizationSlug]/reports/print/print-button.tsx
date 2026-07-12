"use client";

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="report-no-print min-h-11 border border-black bg-black px-4 text-sm font-semibold text-white">Print or save as PDF</button>;
}

