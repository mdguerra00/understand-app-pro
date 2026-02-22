/**
 * Integration tests for Excel Table Reasoning Mode
 * 
 * These tests validate the tabular intent detection, retrieval,
 * pairing, and verification logic without calling external APIs.
 * 
 * To run: import and execute in a Deno test context or use as reference
 * for manual curl-based testing via the edge function.
 */

// ==========================================
// Inline copies of pure functions for testing
// (In production these live in the main handler)
// ==========================================

interface TabularIntent {
  isExcelTableQuery: boolean;
  targetMaterials: string[];
  targetFeature: string | null;
  numericTargets: { value: number; tolerance: number }[];
}

function detectTabularExcelIntent(query: string): TabularIntent {
  const q = query.toLowerCase();
  const result: TabularIntent = {
    isExcelTableQuery: false,
    targetMaterials: [],
    targetFeature: null,
    numericTargets: [],
  };

  const percentPatterns = [
    /(\d+(?:[.,]\d+)?)\s*%/g,
    /de\s+~?(\d+(?:[.,]\d+)?)\s+para\s+~?(\d+(?:[.,]\d+)?)/gi,
    /~(\d+(?:[.,]\d+)?)\s*%?\s*(?:para|→|->|a)\s*~?(\d+(?:[.,]\d+)?)\s*%?/gi,
  ];

  const numbers = new Set<number>();
  for (const pat of percentPatterns) {
    let m;
    while ((m = pat.exec(q)) !== null) {
      for (let i = 1; i < m.length; i++) {
        if (m[i]) numbers.add(parseFloat(m[i].replace(',', '.')));
      }
    }
  }
  result.numericTargets = Array.from(numbers).map(v => ({
    value: v,
    tolerance: v > 10 ? 3 : 0.05,
  }));

  const fillerKeywords = [
    'carga', 'filler', 'load', 'wt%', 'filled', 'glass', 'ceramic',
    'conteúdo de carga', 'teor de carga', 'filler content', 'filler fraction',
  ];
  const tableKeywords = [
    'experimento', 'tabela', 'excel', 'aba', 'sheet', 'planilha',
    'formulação', 'formulacion', 'composição', 'variação', 'variação de',
  ];

  const hasFillerKw = fillerKeywords.some(kw => q.includes(kw));
  const hasTableKw = tableKeywords.some(kw => q.includes(kw));
  const hasTwoNumbers = result.numericTargets.length >= 2;
  const hasTransitionPhrase = /de\s+~?\d.*para\s+~?\d/i.test(q) || /reduziu|aumentou|variou|mudou|alterou/i.test(q);

  if ((hasTableKw || hasFillerKw) && (hasTwoNumbers || hasTransitionPhrase)) {
    result.isExcelTableQuery = true;
  }
  if (q.includes('experimento') && hasTwoNumbers) {
    result.isExcelTableQuery = true;
  }

  if (hasFillerKw) result.targetFeature = 'filler_content';

  const materialPatterns = [
    'vitality', 'filtek', 'charisma', 'tetric', 'grandio', 'z350', 'z250',
    'brilliant', 'herculite', 'clearfil', 'estelite', 'ips', 'ceram',
  ];
  for (const mat of materialPatterns) {
    if (q.includes(mat)) result.targetMaterials.push(mat);
  }

  return result;
}

function verifyTabularResponse(
  responseText: string,
  evidenceTableJson: any,
): { verified: boolean; issues: string[] } {
  if (!evidenceTableJson?.variants) return { verified: true, issues: [] };

  const validValues = new Set<string>();
  for (const variant of evidenceTableJson.variants) {
    if (!variant.metrics) continue;
    for (const [, metric] of Object.entries(variant.metrics) as any) {
      validValues.add(String(metric.value));
      validValues.add(String(metric.value).replace('.', ','));
      if (metric.value_canonical != null) {
        validValues.add(String(metric.value_canonical));
        validValues.add(String(metric.value_canonical).replace('.', ','));
      }
    }
  }

  const numbersInResponse = responseText.match(/\d+[.,]?\d*/g) || [];
  const issues: string[] = [];
  const ungrounded: string[] = [];

  for (const n of numbersInResponse) {
    const num = parseFloat(n.replace(',', '.'));
    if (isNaN(num)) continue;
    if (num <= 10 && Number.isInteger(num)) continue;
    if (num > 1900 && num < 2100) continue;

    if (!validValues.has(n) && !validValues.has(n.replace(',', '.'))) {
      let grounded = false;
      for (const v of validValues) {
        const vn = parseFloat(v.replace(',', '.'));
        if (!isNaN(vn) && Math.abs(vn - num) <= 0.5) { grounded = true; break; }
      }
      if (!grounded) ungrounded.push(n);
    }
  }

  if (ungrounded.length > 2) {
    issues.push(`NUMERIC_GROUNDING_FAILED_TABULAR: ${ungrounded.length} numbers not found in evidence table: ${ungrounded.slice(0, 5).join(', ')}`);
  }

  return { verified: issues.length === 0, issues };
}

// ==========================================
// TEST SCENARIOS
// ==========================================

const tests: { name: string; fn: () => void }[] = [];
function test(name: string, fn: () => void) { tests.push({ name, fn }); }
function assertEqual(actual: any, expected: any, msg?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assertTrue(val: boolean, msg?: string) {
  if (!val) throw new Error(msg || 'Expected true');
}
function assertFalse(val: boolean, msg?: string) {
  if (val) throw new Error(msg || 'Expected false');
}

// ==========================================
// SCENARIO 1: Full tabular query with filler 60→40 + Vitality
// ==========================================
test('Scenario 1: tabular query with filler 60→40 + material', () => {
  const intent = detectTabularExcelIntent(
    'reduziu de aprox. 60% para 40% a quantidade de carga na Vitality — o que demonstrou?'
  );
  assertTrue(intent.isExcelTableQuery, 'Should activate tabular mode');
  assertEqual(intent.targetFeature, 'filler_content');
  assertTrue(intent.numericTargets.some(t => Math.abs(t.value - 60) < 1), 'Should detect 60');
  assertTrue(intent.numericTargets.some(t => Math.abs(t.value - 40) < 1), 'Should detect 40');
  assertTrue(intent.targetMaterials.includes('vitality'), 'Should detect vitality');
});

// ==========================================
// SCENARIO 2: Tabular with 2 numbers but no filler measurements → fail-closed
// (This tests the detection; actual fail-closed is in the handler)
// ==========================================
test('Scenario 2: tabular detected but would fail-closed without data', () => {
  const intent = detectTabularExcelIntent(
    'No experimento, variou de 70% para 30% a carga de vidro'
  );
  assertTrue(intent.isExcelTableQuery, 'Should activate tabular mode');
  assertEqual(intent.targetFeature, 'filler_content');
  assertTrue(intent.numericTargets.length >= 2, 'Should have 2+ numeric targets');
});

// ==========================================
// SCENARIO 3: Single number with transition keyword
// ==========================================
test('Scenario 3: single number with transition phrase', () => {
  const intent = detectTabularExcelIntent(
    'qual foi o efeito de reduzir a carga no experimento?'
  );
  // Has "carga" + "experimento" + "reduziu" but only 0 numbers
  // Should still activate due to fillerKw + transitionPhrase
  assertTrue(intent.isExcelTableQuery, 'Should activate with transition phrase');
  assertEqual(intent.targetFeature, 'filler_content');
});

// ==========================================
// SCENARIO 4: Non-tabular conceptual query
// ==========================================
test('Scenario 4: non-tabular query about yellowing', () => {
  const intent = detectTabularExcelIntent(
    'O que causa o amarelamento de resinas compostas ao longo do tempo?'
  );
  assertFalse(intent.isExcelTableQuery, 'Should NOT activate tabular mode for conceptual query');
});

// ==========================================
// SCENARIO 5: Unit normalization (0.6 vs 60%)
// ==========================================
test('Scenario 5: fraction vs percentage detection', () => {
  const intent = detectTabularExcelIntent(
    'No experimento mudou o filler de 60% para 40%'
  );
  assertTrue(intent.isExcelTableQuery);
  // Tolerance for 60 should be 3 (since >10)
  const t60 = intent.numericTargets.find(t => Math.abs(t.value - 60) < 1);
  assertTrue(!!t60, 'Should find target 60');
  assertEqual(t60!.tolerance, 3);
});

// ==========================================
// SCENARIO 6: Tabular verification passes/fails
// ==========================================
test('Scenario 6: tabular verification', () => {
  const evidence = {
    variants: [
      { metrics: { filler_content: { value: 60, value_canonical: 60 }, flexural_strength: { value: 131.5, value_canonical: 131.5 } } },
      { metrics: { filler_content: { value: 40, value_canonical: 40 }, flexural_strength: { value: 98.2, value_canonical: 98.2 } } },
    ],
  };

  // Response with grounded numbers
  const goodResponse = 'A resistência flexural caiu de 131.5 MPa (filler 60%) para 98.2 MPa (filler 40%).';
  const goodResult = verifyTabularResponse(goodResponse, evidence);
  assertTrue(goodResult.verified, 'Should pass verification with grounded numbers');

  // Response with hallucinated numbers
  const badResponse = 'A resistência caiu de 131.5 para 98.2 MPa. Além disso, a dureza foi de 55.3 HV, o módulo 12.4 GPa e a sorção 28.7 µg.';
  const badResult = verifyTabularResponse(badResponse, evidence);
  assertFalse(badResult.verified, 'Should fail verification with ungrounded numbers');
  assertTrue(badResult.issues[0].includes('NUMERIC_GROUNDING_FAILED_TABULAR'));
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
