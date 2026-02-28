
function shouldSkipNumericVerification(query) {
  const q = query.toLowerCase();
  
  // 1) Navigational/General intent patterns
  const navPatterns = [
    /quais são/i, /quais sao/i, /liste/i, /resuma/i, /me d[eê] um resumo/i, 
    /qual o status/i, /sobre o que [eé]/i, /quem trabalhou/i, /quais projetos/i,
    /quais experimentos/i, /quais documentos/i, /quais arquivos/i,
    /ola/i, /olá/i, /bom dia/i, /boa tarde/i, /boa noite/i, /ajuda/i
  ];
  if (navPatterns.some(re => re.test(q))) return true;

  // 2) Absence of quantitative terms (metrics/units)
  const quantTerms = [
    'valor', 'quanto', 'medida', 'resistência', 'resistencia', 'módulo', 'modulo', 
    'dureza', 'percentual', '%', 'mpa', 'gpa', 'kpa', 'vickers', 'knoop', 'conversão', 
    'conversao', 'cor', 'amarelamento', 'estabilidade', 'encolhimento'
  ];
  const hasQuantTerm = quantTerms.some(term => q.includes(term));
  if (!hasQuantTerm) return true;

  return false;
}

const testCases = [
  { query: "Quais são os projetos ativos no momento?", expected: true },
  { query: "Liste os experimentos do projeto", expected: true },
  { query: "Resuma o projeto Vitality", expected: true },
  { query: "Olá, tudo bem?", expected: true },
  { query: "Qual a resistência flexural média do material X?", expected: false },
  { query: "Quanto foi o encolhimento medido em 80°C?", expected: false },
  { query: "Qual o valor da dureza Vickers?", expected: false },
  { query: "Mostre o percentual de conversão", expected: false },
  { query: "O que o experimento demonstrou?", expected: true }, // General interpretation
];

console.log("Iniciando testes da lógica de verificação numérica (JS)...\n");

let passed = 0;
testCases.forEach((tc, i) => {
  const result = shouldSkipNumericVerification(tc.query);
  const status = result === tc.expected ? "✅ PASSOU" : "❌ FALHOU";
  console.log(`[${i+1}] Query: "${tc.query}"`);
  console.log(`    Resultado: ${result}, Esperado: ${tc.expected} -> ${status}`);
  if (result === tc.expected) passed++;
});

console.log(`\nResultado final: ${passed}/${testCases.length} testes passaram.`);
if (passed === testCases.length) {
  process.exit(0);
} else {
  process.exit(1);
}
