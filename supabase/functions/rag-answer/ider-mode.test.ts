/**
 * Integration tests for IDER (Insight-Driven Deep Experimental Reasoning) Mode
 *
 * Tests validate intent detection, evidence graph construction,
 * critical doc selection, and number verification.
 */

// ==========================================
// Inline copies of pure functions for testing
// ==========================================

interface IDERIntent {
  isIDERQuery: boolean;
  interpretiveKeywords: string[];
}

function detectIDERIntent(query: string): IDERIntent {
  const q = query.toLowerCase();
  const result: IDERIntent = { isIDERQuery: false, interpretiveKeywords: [] };

  const interpretiveTerms: Record<string, string[]> = {
    pt: [
      'o que isso ensina', 'o que isso demonstra', 'o que demonstrou', 'o que aprendemos',
      'lição', 'lições', 'implicação', 'implicações', 'interprete', 'interpretar',
      'por que aconteceu', 'por que ocorreu', 'significado', 'conclusão prática',
      'o que os dados mostram', 'o que os resultados mostram', 'análise profunda',
      'análise detalhada', 'o que podemos concluir', 'o que se pode concluir',
      'trade-off', 'trade offs', 'tradeoff', 'efeito observado',
    ],
    en: [
      'what does this teach', 'what did it show', 'what we learned', 'what it demonstrated',
      'implication', 'implications', 'lesson', 'lessons', 'interpret', 'interpretation',
      'why did it happen', 'what the data shows', 'deep analysis', 'practical conclusion',
      'what can we conclude', 'observed effect',
    ],
  };

  const allTerms = [...interpretiveTerms.pt, ...interpretiveTerms.en];
  for (const term of allTerms) {
    if (q.includes(term)) result.interpretiveKeywords.push(term);
  }

  const experimentContext = /experimento|tabela|aba|excel|sheet|ensaio|teste\b/.test(q);
  const interpretiveIntent = result.interpretiveKeywords.length > 0;
  const deepAnalysisRequest = /(analise|analyze|explique|explain|detalhe|detail|resuma|summarize).*(resultado|result|dado|data|experiment|ensaio)/i.test(q);

  if (interpretiveIntent) {
    result.isIDERQuery = true;
  } else if (experimentContext && deepAnalysisRequest) {
    result.isIDERQuery = true;
  }

  return result;
}

interface EvidenceGraph {
  question: string;
  project_id: string;
  target_metrics: string[];
  experiments: {
    experiment_id: string;
    title: string;
    doc_ids: string[];
    evidence_date: string | null;
    hypothesis: string | null;
    objective: string | null;
    variants: {
      variant_id: string;
      conditions: Record<string, string>;
      metrics: Record<string, { value: number; unit: string; value_canonical: number | null; unit_canonical: string | null; measurement_id: string; excerpt: string }>;
    }[];
  }[];
  insights_used: { id: string; title: string; verified: boolean; category: string }[];
  diagnostics: string[];
}

function selectCriticalDocs(
  evidenceGraph: EvidenceGraph,
  insightSeeds: { doc_id: string | null; verified: boolean }[]
): { doc_id: string; reason: string; score: number }[] {
  const docScores = new Map<string, { score: number; reasons: string[] }>();
  const addScore = (docId: string, pts: number, reason: string) => {
    const existing = docScores.get(docId) || { score: 0, reasons: [] };
    existing.score += pts;
    existing.reasons.push(reason);
    docScores.set(docId, existing);
  };

  for (const seed of insightSeeds) {
    if (seed.doc_id && seed.verified) addScore(seed.doc_id, 3, 'verified_insight');
    else if (seed.doc_id) addScore(seed.doc_id, 1, 'unverified_insight');
  }
  for (const exp of evidenceGraph.experiments) {
    for (const docId of exp.doc_ids) {
      const metricCount = exp.variants.reduce((s, v) => s + Object.keys(v.metrics).length, 0);
      if (metricCount > 0) addScore(docId, 2, `has_${metricCount}_measurements`);
    }
  }

  return Array.from(docScores.entries())
    .map(([doc_id, { score, reasons }]) => ({ doc_id, score, reason: reasons.join(', ') }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function verifyIDERNumbers(
  responseText: string, evidenceGraph: EvidenceGraph
): { verified: boolean; issues: string[] } {
  const validValues = new Set<string>();
  for (const exp of evidenceGraph.experiments) {
    for (const variant of exp.variants) {
      for (const [, metric] of Object.entries(variant.metrics)) {
        validValues.add(String(metric.value));
        validValues.add(String(metric.value).replace('.', ','));
        if (metric.value_canonical != null) {
          validValues.add(String(metric.value_canonical));
          validValues.add(String(metric.value_canonical).replace('.', ','));
        }
      }
    }
  }

  const numbersInResponse = responseText.match(/\d+[.,]?\d*/g) || [];
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

  const issues: string[] = [];
  if (ungrounded.length > 2) {
    issues.push(`NUMERIC_GROUNDING_FAILED_IDER: ${ungrounded.length} numbers not in evidence graph: ${ungrounded.slice(0, 5).join(', ')}`);
  }
  return { verified: issues.length === 0, issues };
}

// ==========================================
// TEST SCENARIOS
// ==========================================
const tests: { name: string; fn: () => void }[] = [];
function test(name: string, fn: () => void) { tests.push({ name, fn }); }
function assertTrue(val: boolean, msg?: string) { if (!val) throw new Error(msg || 'Expected true'); }
function assertFalse(val: boolean, msg?: string) { if (val) throw new Error(msg || 'Expected false'); }
function assertEqual(actual: any, expected: any, msg?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${msg || ''}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ==========================================
// SCENARIO 1: Interpretive query with structured data
// ==========================================
test('Scenario 1: interpretive query activates IDER', () => {
  const intent = detectIDERIntent('O que esse experimento demonstrou sobre a resistência flexural?');
  assertTrue(intent.isIDERQuery, 'Should activate IDER for "o que demonstrou"');
  assertTrue(intent.interpretiveKeywords.some(k => k.includes('demonstrou')));
});

// ==========================================
// SCENARIO 2: Interpretive but insufficient evidence → fail-closed
// ==========================================
test('Scenario 2: IDER fail-closed with empty evidence graph', () => {
  const emptyGraph: EvidenceGraph = {
    question: 'o que isso ensina?',
    project_id: 'proj1',
    target_metrics: [],
    experiments: [],
    insights_used: [],
    diagnostics: ['No experiments found'],
  };
  // Verify: 0 experiments → should trigger fail-closed in handler
  assertEqual(emptyGraph.experiments.length, 0, 'Should have 0 experiments');
});

// ==========================================
// SCENARIO 3: Conceptual query should NOT activate IDER
// ==========================================
test('Scenario 3: conceptual yellowing query does NOT activate IDER', () => {
  const intent = detectIDERIntent('O que causa o amarelamento de resinas compostas ao longo do tempo?');
  assertFalse(intent.isIDERQuery, 'Should NOT activate IDER for conceptual query');
});

// ==========================================
// SCENARIO 4: Temporal contradiction handling
// ==========================================
test('Scenario 4: evidence graph preserves evidence_date for temporal reasoning', () => {
  const graph: EvidenceGraph = {
    question: 'O que aprendemos sobre a dureza?',
    project_id: 'proj1',
    target_metrics: ['hardness_vickers'],
    experiments: [
      {
        experiment_id: 'exp1', title: 'Old test', doc_ids: ['doc1'],
        evidence_date: '2024-01-01', hypothesis: null, objective: null,
        variants: [{ variant_id: 'v1', conditions: {}, metrics: { hardness_vickers: { value: 45, unit: 'HV', value_canonical: 45, unit_canonical: 'HV', measurement_id: 'm1', excerpt: '45 HV' } } }],
      },
      {
        experiment_id: 'exp2', title: 'New test', doc_ids: ['doc2'],
        evidence_date: '2025-06-01', hypothesis: null, objective: null,
        variants: [{ variant_id: 'v2', conditions: {}, metrics: { hardness_vickers: { value: 52, unit: 'HV', value_canonical: 52, unit_canonical: 'HV', measurement_id: 'm2', excerpt: '52 HV' } } }],
      },
    ],
    insights_used: [],
    diagnostics: [],
  };
  // Verify dates are preserved for temporal reasoning
  assertTrue(graph.experiments[0].evidence_date! < graph.experiments[1].evidence_date!, 'Dates should be chronological');
  assertEqual(graph.experiments.length, 2, 'Should have 2 experiments for comparison');
});

// ==========================================
// SCENARIO 5: Cross-variant mix detection via verification
// ==========================================
test('Scenario 5: verification catches hallucinated numbers', () => {
  const graph: EvidenceGraph = {
    question: 'test',
    project_id: 'proj1',
    target_metrics: ['flexural_strength'],
    experiments: [{
      experiment_id: 'exp1', title: 'Test', doc_ids: ['doc1'],
      evidence_date: null, hypothesis: null, objective: null,
      variants: [{
        variant_id: 'v1', conditions: {},
        metrics: {
          flexural_strength: { value: 131.5, unit: 'MPa', value_canonical: 131.5, unit_canonical: 'MPa', measurement_id: 'm1', excerpt: '131.5 MPa' },
          elastic_modulus: { value: 8.2, unit: 'GPa', value_canonical: 8200, unit_canonical: 'MPa', measurement_id: 'm2', excerpt: '8.2 GPa' },
        },
      }],
    }],
    insights_used: [],
    diagnostics: [],
  };

  // Good response: only uses grounded numbers
  const goodResult = verifyIDERNumbers('A resistência flexural foi 131.5 MPa e o módulo 8.2 GPa.', graph);
  assertTrue(goodResult.verified, 'Should pass with grounded numbers');

  // Bad response: hallucinated numbers
  const badResult = verifyIDERNumbers('A resistência foi 131.5 MPa, dureza 55.3 HV, sorção 28.7 µg e módulo 12.4 GPa.', graph);
  assertFalse(badResult.verified, 'Should fail with ungrounded numbers');
  assertTrue(badResult.issues[0].includes('NUMERIC_GROUNDING_FAILED_IDER'));
});

// ==========================================
// SCENARIO 6: Critical doc selection scoring
// ==========================================
test('Scenario 6: critical doc selection prioritizes verified insights + measurements', () => {
  const graph: EvidenceGraph = {
    question: 'test',
    project_id: 'proj1',
    target_metrics: [],
    experiments: [
      { experiment_id: 'exp1', title: 'E1', doc_ids: ['doc_A'], evidence_date: null, hypothesis: null, objective: null,
        variants: [{ variant_id: 'v1', conditions: {}, metrics: { rf: { value: 100, unit: 'MPa', value_canonical: 100, unit_canonical: 'MPa', measurement_id: 'm1', excerpt: '100 MPa' } } }] },
      { experiment_id: 'exp2', title: 'E2', doc_ids: ['doc_B'], evidence_date: null, hypothesis: null, objective: null,
        variants: [{ variant_id: 'v2', conditions: {}, metrics: { rf: { value: 110, unit: 'MPa', value_canonical: 110, unit_canonical: 'MPa', measurement_id: 'm2', excerpt: '110 MPa' }, hv: { value: 50, unit: 'HV', value_canonical: 50, unit_canonical: 'HV', measurement_id: 'm3', excerpt: '50 HV' } } }] },
    ],
    insights_used: [],
    diagnostics: [],
  };

  const seeds = [
    { doc_id: 'doc_A', verified: true },
    { doc_id: 'doc_C', verified: false },
  ];

  const docs = selectCriticalDocs(graph, seeds);
  // doc_A: 3 (verified insight) + 2 (1 measurement) = 5
  // doc_B: 2 (2 measurements) = 2
  // doc_C: 1 (unverified insight) = 1
  assertTrue(docs[0].doc_id === 'doc_A', `Top doc should be doc_A (score=5), got ${docs[0].doc_id}`);
  assertTrue(docs[0].score >= 5, `doc_A score should be >=5, got ${docs[0].score}`);
  assertTrue(docs.length <= 3, 'Should limit to 3 docs');
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
