

# Plano: Diagnosticos Detalhados + Regras Hard de Fail-Closed

## Status: IMPLEMENTADO (v2 com 4 ajustes adicionais)

### Ajustes v2 implementados:
1. ✅ pipeline_selected padronizado — enum fechado (ider, ider-fail-closed, tabular-excel, tabular-excel-fail-closed, comparative, comparative-constrained, comparative-constrained-fail-closed, fail-closed-no-evidence, 3-step). Motivo detalhado vai em fail_closed_reason + fail_closed_stage.
2. ✅ Hard fail para external_leak e cross_variant_mix — auditoria agora bloqueia resposta (não só warning).
3. ✅ Extração de números refinada — usa regex unit-aware (MPa, %, °C, etc.) + decimais, ignora numeração de seções e contagens internas.
4. ✅ Mensagens fail-closed com orientação — incluem constraints_keywords_hit, critical_docs, e 1-3 sugestões de perguntas executáveis.

