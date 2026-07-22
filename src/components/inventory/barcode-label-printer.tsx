"use client";

import { useState } from "react";
import JsBarcode from "jsbarcode";
import { Button } from "@/components/ui/button";

export function BarcodeLabelPrinter({
  itemName,
  sku,
}: {
  itemName: string;
  sku: string | null;
}) {
  const [copies, setCopies] = useState(1);
  const [message, setMessage] = useState<string | null>(null);

  function printLabels() {
    if (!sku) return;
    const printWindow = window.open(
      "",
      "pantry-assistant-labels",
      "noopener,noreferrer,width=900,height=700",
    );
    if (!printWindow) {
      setMessage(
        "Your browser blocked the label window. Allow pop-ups for Pantry Assistant and try again.",
      );
      return;
    }
    const document = printWindow.document;
    document.title = `Labels – ${itemName}`;
    const style = document.createElement("style");
    style.textContent =
      "@page{margin:0.25in}body{font-family:Arial,sans-serif;margin:0}.labels{display:grid;grid-template-columns:repeat(3,2.5in);gap:.15in}.label{box-sizing:border-box;width:2.5in;height:1in;border:1px solid #bbb;padding:.08in;display:grid;align-content:center;overflow:hidden}.name{font-size:10pt;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sku{font-family:monospace;font-size:8pt;text-align:center}.label svg{width:100%;height:.42in}@media print{.label{border:0}}";
    document.head.append(style);
    const labels = document.createElement("main");
    labels.className = "labels";

    try {
      for (let index = 0; index < copies; index += 1) {
        const label = document.createElement("section");
        label.className = "label";
        const name = document.createElement("div");
        name.className = "name";
        name.textContent = itemName;
        const barcode = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        JsBarcode(barcode, sku, {
          format: "CODE128",
          displayValue: false,
          margin: 0,
          height: 36,
          width: 1.25,
        });
        const code = document.createElement("div");
        code.className = "sku";
        code.textContent = sku;
        label.append(name, barcode, code);
        labels.append(label);
      }
      document.body.append(labels);
      printWindow.focus();
      printWindow.print();
      setMessage(
        `${copies} label${copies === 1 ? "" : "s"} opened in the print dialog.`,
      );
    } catch {
      printWindow.close();
      setMessage(
        "This SKU contains characters that cannot be printed as a Code 128 barcode.",
      );
    }
  }

  if (!sku)
    return (
      <p className="mt-2 text-sm text-[var(--muted)]">
        Add an SKU / PLU before printing a scanner label.
      </p>
    );

  return (
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm font-medium">
        <span>Labels</span>
        <input
          className="min-h-11 w-24 rounded-xl border border-[var(--rule)] bg-white px-3"
          type="number"
          min={1}
          max={100}
          value={copies}
          onChange={(event) =>
            setCopies(
              Math.max(1, Math.min(100, Number(event.target.value) || 1)),
            )
          }
        />
      </label>
      <Button type="button" onClick={printLabels}>
        Print barcode labels
      </Button>
      {message ? (
        <p aria-live="polite" className="pb-2 text-sm text-[var(--muted)]">
          {message}
        </p>
      ) : null}
    </div>
  );
}
