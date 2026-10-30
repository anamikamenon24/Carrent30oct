"use client";

export function PrintButton() {
  return (
    <button type="button" className="btn-primary" onClick={() => window.print()} data-testid="print-voucher">
      Print or save as PDF
    </button>
  );
}
