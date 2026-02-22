/**
 * Unit tests for filler_content deterministic extraction.
 * Run with: deno test --allow-net supabase/functions/extract-knowledge/filler-extraction.test.ts
 */

// Import test utilities
import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// ==========================================
// INLINE COPIES OF FUNCTIONS UNDER TEST
// (to avoid import issues with Deno serve)
// ==========================================

const FILLER_HEADER_SUBSTRINGS = [
  'carga', 'filler', 'load', 'wt%', 'weight %', 'weight%',
  'glass content', 'ceramic content', '% filler', '% carga',
  'filled', 'glass', 'ceramic', 'filler content',
  'carga inorgânica', 'carga inorganica', 'conteúdo de carga', 'conteudo de carga',
];

function isFillerHeader(header: string): boolean {
  const h = header.toLowerCase().trim();
  return FILLER_HEADER_SUBSTRINGS.some(sub => h.includes(sub));
}

function headerIndicatesPercent(header: string): boolean {
  const h = header.toLowerCase().trim();
  return h.includes('%') || h.includes('pct') || h.includes('percent') || h.includes('wt');
}

function normalizeFillerValue(rawValue: any, header: string): { value: number; valueCanonical: number; unit: string; unitCanonical: string } | null {
  let numVal: number;
  let rawStr = String(rawValue).trim();
  let unitCanonical = 'pct';
  
  const pctMatch = rawStr.match(/^(\d+[.,]?\d*)\s*%$/);
  if (pctMatch) {
    numVal = parseFloat(pctMatch[1].replace(',', '.'));
    if (isNaN(numVal)) return null;
    return { value: numVal, valueCanonical: numVal, unit: '%', unitCanonical };
  }
  
  numVal = parseFloat(rawStr.replace(',', '.'));
  if (isNaN(numVal)) return null;
  
  if (numVal <= 1.5 && numVal > 0 && (headerIndicatesPercent(header) || isFillerHeader(header))) {
    return { value: numVal, valueCanonical: numVal * 100, unit: 'fraction', unitCanonical };
  }
  
  return { value: numVal, valueCanonical: numVal, unit: headerIndicatesPercent(header) ? '%' : 'pct', unitCanonical };
}

// ==========================================
// TEST 1: Header "% filler" + valor 0.4 → 40 pct
// ==========================================
Deno.test("Test 1: '% filler' header + value 0.4 → 40 pct", () => {
  const header = "% filler";
  assert(isFillerHeader(header), "Should detect as filler header");
  
  const result = normalizeFillerValue(0.4, header);
  assert(result !== null, "Should produce a result");
  assertEquals(result!.valueCanonical, 40, "0.4 should normalize to 40 pct");
  assertEquals(result!.unitCanonical, "pct");
  assertEquals(result!.unit, "fraction", "Original unit should be fraction");
});

// ==========================================
// TEST 2: Header "Carga (%)" + valor "40%" → 40 pct
// ==========================================
Deno.test("Test 2: 'Carga (%)' header + value '40%' → 40 pct", () => {
  const header = "Carga (%)";
  assert(isFillerHeader(header), "Should detect as filler header");
  
  const result = normalizeFillerValue("40%", header);
  assert(result !== null, "Should produce a result");
  assertEquals(result!.valueCanonical, 40, "40% string should normalize to 40 pct");
  assertEquals(result!.unitCanonical, "pct");
});

// ==========================================
// TEST 3: Header "Glass content" + valor 60 → 60 pct
// ==========================================
Deno.test("Test 3: 'Glass content' header + value 60 → 60 pct", () => {
  const header = "Glass content";
  assert(isFillerHeader(header), "Should detect as filler header");
  
  const result = normalizeFillerValue(60, header);
  assert(result !== null, "Should produce a result");
  assertEquals(result!.valueCanonical, 60, "60 should stay as 60 pct");
  assertEquals(result!.unitCanonical, "pct");
});

// ==========================================
// TEST 4: Malformed header with merged cell behavior
// ==========================================
Deno.test("Test 4: Malformed/merged header still detected", () => {
  // Simulates a header that came from merged cells
  const headers = [
    "  Carga Inorgânica  ",
    "FILLER",
    "% CARGA (wt%)",
    "glass",
    "ceramic content (%)",
  ];
  
  for (const h of headers) {
    assert(isFillerHeader(h), `Should detect "${h}" as filler header`);
  }
  
  // Non-filler headers should NOT match
  const nonFiller = ["RF (MPa)", "Flexural Strength", "Dureza", "Módulo", "Sample"];
  for (const h of nonFiller) {
    assert(!isFillerHeader(h), `Should NOT detect "${h}" as filler header`);
  }
});

// ==========================================
// TEST 5: Value 0.6 sem símbolo, header contém carga → 60 pct
// ==========================================
Deno.test("Test 5: Value 0.6, no % symbol, header 'carga' → 60 pct", () => {
  const header = "carga";
  assert(isFillerHeader(header), "Should detect as filler header");
  
  const result = normalizeFillerValue(0.6, header);
  assert(result !== null, "Should produce a result");
  assertEquals(result!.valueCanonical, 60, "0.6 should normalize to 60 pct");
  assertEquals(result!.unitCanonical, "pct");
});

// ==========================================
// TEST 6: Ensure non-filler metrics are NOT overridden
// ==========================================
Deno.test("Test 6: Non-filler headers are not affected", () => {
  const nonFillerHeaders = [
    "RF (MPa)",
    "Flexural Strength",
    "Dureza Vickers",
    "Módulo de Elasticidade",
    "Delta E",
    "Sorção de Água",
  ];
  
  for (const h of nonFillerHeaders) {
    assert(!isFillerHeader(h), `"${h}" should NOT be detected as filler`);
  }
});

// ==========================================
// TEST 7: Edge cases for percentage normalization
// ==========================================
Deno.test("Test 7: Edge cases for normalizeFillerValue", () => {
  // String "60%" 
  const r1 = normalizeFillerValue("60%", "filler");
  assertEquals(r1!.valueCanonical, 60);
  
  // European format "0,4"
  const r2 = normalizeFillerValue("0,4", "% carga");
  assertEquals(r2!.valueCanonical, 40);
  
  // Value exactly 1.0 (100%)
  const r3 = normalizeFillerValue(1.0, "filler (%)");
  assertEquals(r3!.valueCanonical, 100, "1.0 should become 100 pct");
  
  // Value 0 should still work
  const r4 = normalizeFillerValue(0, "filler");
  // 0 is not > 0, so it won't trigger fraction conversion
  assertEquals(r4!.valueCanonical, 0);
  
  // Non-numeric should return null
  const r5 = normalizeFillerValue("abc", "filler");
  assertEquals(r5, null);
});
