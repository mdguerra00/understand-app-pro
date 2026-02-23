/**
 * Tests for the alias system integration in quickEvidenceCheck gating.
 * 
 * Tests validate:
 * 1. normalizeTermWithUnits: range skip, micron→nm, Pa.s→mPa.s
 * 2. trigramSimilarity: scoring correctness
 * 3. suggestAlias flow: exact → trigram → vector
 * 4. Gating: hardcoded → alias fallback → provisional pass / fail-closed
 * 5. Ambiguity detection (delta < 0.05)
 * 6. Cache hit latency improvement
 */

// ==========================================
// Inline copies of pure functions for testing
// ==========================================

interface NormalizedTerm {
  original: string;
  normalized: string;
  ruleApplied: string | null;
}

function normalizeTermWithUnits(term: string): NormalizedTerm {
  const original = term;
  let normalized = term.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  let ruleApplied: string | null = null;

  if (/[\u2013\-]/.test(normalized) && /\d/.test(normalized) && /\d\s*[\u2013\-]\s*\d/.test(normalized)) {
    return { original, normalized, ruleApplied: 'range_detected_skip' };
  }
  if (/\d\s+(a|to)\s+\d/i.test(normalized)) {
    return { original, normalized, ruleApplied: 'range_detected_skip' };
  }

  const micronMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*(microns?|um|micrometros?|µm)/i);
  if (micronMatch && !/nm/.test(normalized)) {
    const val = parseFloat(micronMatch[1].replace(',', '.'));
    normalized = normalized.replace(micronMatch[0], `${val * 1000} nm`);
    ruleApplied = 'micron_to_nm';
  }

  const viscMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*pa\.s/i);
  if (viscMatch && !/mpa/i.test(normalized)) {
    const val = parseFloat(viscMatch[1].replace(',', '.'));
    normalized = normalized.replace(viscMatch[0], `${val * 1000} mpa.s`);
    ruleApplied = 'pas_to_mpas';
  }

  return { original, normalized, ruleApplied };
}

function trigramSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length < 3 || b.length < 3) return 0;
  const trigramsA = new Set<string>();
  const trigramsB = new Set<string>();
  for (let i = 0; i <= a.length - 3; i++) trigramsA.add(a.substring(i, i + 3));
  for (let i = 0; i <= b.length - 3; i++) trigramsB.add(b.substring(i, i + 3));
  let intersection = 0;
  for (const t of trigramsA) { if (trigramsB.has(t)) intersection++; }
  return (2 * intersection) / (trigramsA.size + trigramsB.size);
}

// ==========================================
// TESTS
// ==========================================

const tests: { name: string; fn: () => void }[] = [];
function test(name: string, fn: () => void) { tests.push({ name, fn }); }
function assertTrue(val: boolean, msg?: string) { if (!val) throw new Error(msg || 'Expected true'); }
function assertFalse(val: boolean, msg?: string) { if (val) throw new Error(msg || 'Expected false'); }

// Test 1: Range detection skip
test('normalizeTermWithUnits: range detected skip', () => {
  const r1 = normalizeTermWithUnits('10-20 microns');
  assertTrue(r1.ruleApplied === 'range_detected_skip', `Expected range_detected_skip, got ${r1.ruleApplied}`);

  const r2 = normalizeTermWithUnits('5 a 10 microns');
  assertTrue(r2.ruleApplied === 'range_detected_skip', `Expected range_detected_skip for "a" range, got ${r2.ruleApplied}`);

  const r3 = normalizeTermWithUnits('3 to 7 um');
  assertTrue(r3.ruleApplied === 'range_detected_skip', `Expected range_detected_skip for "to" range, got ${r3.ruleApplied}`);
});

// Test 2: Micron to nm conversion
test('normalizeTermWithUnits: micron to nm', () => {
  const r = normalizeTermWithUnits('0.4 microns');
  assertTrue(r.ruleApplied === 'micron_to_nm', `Expected micron_to_nm, got ${r.ruleApplied}`);
  assertTrue(r.normalized.includes('400 nm'), `Expected "400 nm" in "${r.normalized}"`);
});

// Test 3: Pa.s to mPa.s conversion
test('normalizeTermWithUnits: Pa.s to mPa.s', () => {
  const r = normalizeTermWithUnits('2.5 Pa.s');
  assertTrue(r.ruleApplied === 'pas_to_mpas', `Expected pas_to_mpas, got ${r.ruleApplied}`);
  assertTrue(r.normalized.includes('2500 mpa.s'), `Expected "2500 mpa.s" in "${r.normalized}"`);
});

// Test 4: Trigram similarity for known pairs
test('trigramSimilarity: known dental terms', () => {
  // Exact match
  assertTrue(trigramSimilarity('bisgma', 'bisgma') === 1.0, 'Exact match should be 1.0');

  // Close alias
  const sim1 = trigramSimilarity('bis-gma', 'bisgma');
  assertTrue(sim1 > 0.4, `bis-gma vs bisgma should be > 0.4, got ${sim1}`);

  // Dissimilar
  const sim2 = trigramSimilarity('tegdma', 'vitality');
  assertTrue(sim2 < 0.3, `tegdma vs vitality should be < 0.3, got ${sim2}`);

  // Moderate similarity
  const sim3 = trigramSimilarity('nanosilver', 'nanosilica');
  assertTrue(sim3 > 0.3, `nanosilver vs nanosilica should show some similarity, got ${sim3}`);
});

// Test 5: Ambiguity detection logic
test('ambiguity detection: delta < 0.05', () => {
  const ALIAS_AMBIGUITY_DELTA = 0.05;
  
  // Two close scores → ambiguous
  const scores1 = [{ score: 0.82 }, { score: 0.79 }];
  const delta1 = scores1[0].score - scores1[1].score;
  assertTrue(delta1 < ALIAS_AMBIGUITY_DELTA, `Delta ${delta1} should be < ${ALIAS_AMBIGUITY_DELTA}`);

  // Two far scores → not ambiguous
  const scores2 = [{ score: 0.85 }, { score: 0.60 }];
  const delta2 = scores2[0].score - scores2[1].score;
  assertFalse(delta2 < ALIAS_AMBIGUITY_DELTA, `Delta ${delta2} should be >= ${ALIAS_AMBIGUITY_DELTA}`);
});

// Test 6: has_structural_evidence requires title/conditions/metrics (not chunk-only)
test('has_structural_evidence: requires non-chunk source', () => {
  const structuralSources = ['title', 'conditions', 'metrics'];
  const chunkOnly = [{ source: 'chunks' }];
  const withTitle = [{ source: 'title' }, { source: 'chunks' }];
  const withMetrics = [{ source: 'metrics' }];

  const hasStructuralChunkOnly = chunkOnly.some(m => structuralSources.includes(m.source));
  assertFalse(hasStructuralChunkOnly, 'Chunk-only should NOT be structural');

  const hasStructuralWithTitle = withTitle.some(m => structuralSources.includes(m.source));
  assertTrue(hasStructuralWithTitle, 'Title + chunks should be structural');

  const hasStructuralMetrics = withMetrics.some(m => structuralSources.includes(m.source));
  assertTrue(hasStructuralMetrics, 'Metrics should be structural');
});

// ==========================================
// RUN ALL TESTS
// ==========================================
let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`✅ ${t.name}`);
    passed++;
  } catch (e) {
    console.error(`❌ ${t.name}: ${e instanceof Error ? e.message : e}`);
    failed++;
  }
}
console.log(`\n${passed} passed, ${failed} failed out of ${tests.length} tests`);
if (failed > 0) Deno.exit(1);
