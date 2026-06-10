# Diagnóstico: por que os campos do drawer da tarefa não "salvam"

Investiguei o fluxo de salvamento (`TaskDetailDrawer.handleSaveRnD` → `supabase.from('tasks').update(...)`) e a base de dados:

- O update no Supabase **funciona**: a tarefa "Teste de Bloqueadores" foi atualizada hoje (campo `conclusion` gravado, `updated_at` recente).
- Não há triggers bloqueando, e a política RLS de UPDATE em `tasks` permite o pesquisador editar.
- Logo, o salvamento em si não é o problema. **O problema é que o texto digitado some da tela antes/depois de clicar em "Salvar"**, fazendo parecer que nada foi gravado.

## Causa raiz

Em `src/pages/ProjectDetail.tsx` (linha 625):

```tsx
<TaskDetailDrawer
  task={selectedTask ? getFullTaskData(selectedTask) : null}
  ...
  onUpdate={() => { refreshTasks(); }}
/>
```

`getFullTaskData(selectedTask)` retorna **um novo objeto a cada render** do `ProjectDetail` (`return { ...task, project_id: ... }`).

Dentro de `TaskDetailDrawer` o estado dos campos (`partialResults`, `conclusion`, `hypothesis`, etc.) é sincronizado por:

```ts
useEffect(() => {
  if (task && open) {
    setPartialResults(task.partial_results || '');
    setConclusion(task.conclusion || '');
    ...
  }
}, [task, open]);
```

Como `task` é uma nova referência a cada render do pai, qualquer atualização do `ProjectDetail` (notificações em realtime, refetch automático, atividade de outro hook, etc.) faz esse `useEffect` rodar **enquanto o usuário ainda está digitando**, sobrescrevendo o texto digitado com o valor antigo vindo do banco. O usuário então clica em "Salvar Resultados", mas o estado já voltou ao valor antigo — o banco é atualizado com o valor antigo e parece que "não salvou".

Isso afeta todas as abas com campos longos: **Plano, Execução, Resultado, Conclusão**.

## Correção (mínima, sem mudar comportamento de salvamento)

1. **`src/components/tasks/TaskDetailDrawer.tsx`** — trocar a dependência do `useEffect` para depender apenas da *identidade* e do *timestamp do servidor* da tarefa, não da referência do objeto:

   ```ts
   useEffect(() => {
     if (task && open) { ...setStates... }
   }, [task?.id, task?.updated_at, open]);
   ```

   Assim os campos só são re-hidratados quando:
   - o drawer é aberto, OU
   - o usuário troca para outra tarefa, OU
   - o servidor confirmou um update (novo `updated_at`).

   Enquanto o usuário digita, re-renders do pai não vão mais "engolir" o texto.

2. **`src/pages/ProjectDetail.tsx`** — memoizar o objeto passado para o drawer para evitar churn desnecessário de props:

   ```ts
   const drawerTask = useMemo(
     () => (selectedTask ? { ...selectedTask, project_id: selectedTask.project_id || id! } : null),
     [selectedTask, id]
   );
   ...
   <TaskDetailDrawer task={drawerTask} ... />
   ```

   Remover `getFullTaskData` ou deixá-lo apenas como helper interno do `useMemo`.

## Verificação após a correção

- Abrir a tarefa "Teste de Bloqueadores", digitar texto em **Resultados parciais**, esperar 5–10s (tempo suficiente para um refetch/realtime acontecer) e confirmar que o texto continua na tela.
- Clicar em **Salvar Resultados** e conferir o toast "Salvo".
- Fechar e reabrir o drawer: o texto deve permanecer.
- Repetir para os campos de **Plano** (hipótese, procedimento), **Execução** (checklist) e **Conclusão**.
- Consultar no banco `select partial_results, conclusion, updated_at from tasks where id = '...'` para confirmar persistência.

## Escopo

Mudanças restritas a dois arquivos de frontend:
- `src/components/tasks/TaskDetailDrawer.tsx` (1 linha de dependência do `useEffect`)
- `src/pages/ProjectDetail.tsx` (memoizar o objeto `task` do drawer)

Nenhuma alteração em schema, RLS, edge functions ou no handler de salvamento.
