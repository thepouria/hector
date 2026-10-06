'use client';

import * as React from 'react';
import JsBarcode from 'jsbarcode';
import type { Barcode } from '@/types/catalog';

type BarcodeGlyphProps = {
  barcode: Pick<Barcode, 'value' | 'type'>;
  height?: number;
  displayValue?: boolean;
  className?: string;
};

/**
 * Renders a scannable barcode glyph.
 * INTERNAL / CODE128 / OTHER → CODE128 symbology.
 * EAN13 / EAN8 / UPC_A → matching symbology when possible.
 */
export function BarcodeGlyph({
  barcode,
  height = 64,
  displayValue = true,
  className,
}: BarcodeGlyphProps) {
  const svgRef = React.useRef<SVGSVGElement>(null);

  React.useEffect(() => {
    if (!svgRef.current) return;
    const format =
      barcode.type === 'EAN13'
        ? 'EAN13'
        : barcode.type === 'EAN8'
          ? 'EAN8'
          : barcode.type === 'UPC_A'
            ? 'UPC'
            : 'CODE128';
    try {
      JsBarcode(svgRef.current, barcode.value, {
        format,
        height,
        displayValue,
        margin: 8,
        fontSize: 14,
        textMargin: 4,
        background: '#ffffff',
        lineColor: '#0f172a',
      });
    } catch {
      // Fallback: clear SVG if format rejects the value.
      while (svgRef.current.firstChild) {
        svgRef.current.removeChild(svgRef.current.firstChild);
      }
    }
  }, [barcode.value, barcode.type, height, displayValue]);

  return <svg ref={svgRef} className={className} role="img" aria-label={barcode.value} />;
}
