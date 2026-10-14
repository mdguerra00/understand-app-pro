# Corrigir telas em branco

## Causa provável
O "ouvinte" de notificações em tempo real é aberto com o mesmo nome em dois lugares ao mesmo tempo (sino do topo e página do projeto). A biblioteca de tempo real recusa o segundo registro e lança um erro; como o app não tem uma "rede de proteção" para erros, a tela inteira some sem mensagem. Isso explica por que a página do projeto (e outras que abrem junto com o sino) carrega e depois fica em branco.

Observação: não consegui entrar com sua conta para reproduzir; a causa foi identificada lendo o código. O primeiro passo da implementação é confirmar no navegador.

## O que será feito
1. Dar um nome único a cada ouvinte de notificações, para que vários possam existir ao mesmo tempo sem conflito, e reabri-lo só quando o usuário realmente muda (não a cada renovação de sessão).
2. Adicionar uma proteção global de erros: se algo quebrar, em vez de tela branca aparece uma mensagem amigável com botão "Recarregar" e o erro é registrado no console.
3. Verificar a página do projeto, Dashboard e Tarefas após a correção.

## Detalhes técnicos
- `src/hooks/useNotifications.ts`: canal `notifications-realtime-${user.id}-${useId()}`; dependência do efeito `user?.id` em vez de `user`.
- Novo `src/components/ErrorBoundary.tsx` (class component) envolvendo `<Routes>` em `App.tsx`.
