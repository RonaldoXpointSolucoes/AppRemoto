'use client';

import { Check, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { MarkdownRenderer } from '../../components/markdown-renderer';
import { clearSetupProgress, readSetupProgress, saveSetupProgress } from '../../lib/setup-progress';
import { setupGuideIntroduction, setupGuideSteps, setupGuideTitle } from './setup-guide';

export function SetupChecklist({ apiBaseUrl }: { apiBaseUrl: string }) {
  const steps = useMemo(() => setupGuideSteps(apiBaseUrl), [apiBaseUrl]);
  const taskIds = useMemo(() => steps.flatMap((step) => step.tasks.map((_, index) => step.id + '-' + index)), [steps]);
  const [completed, setCompleted] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setCompleted(readSetupProgress(taskIds));
    setReady(true);
  }, [taskIds]);

  function toggle(id: string) {
    const next = completed.includes(id) ? completed.filter((item) => item !== id) : [...completed, id];
    setCompleted(next);
    saveSetupProgress(next);
  }

  function reset() {
    setCompleted([]);
    clearSetupProgress();
  }

  const finishedSteps = steps.filter((step) => step.tasks.every((_, index) => completed.includes(step.id + '-' + index))).length;

  return <>
    <div className="setup-introduction">
      <h1>{setupGuideTitle}</h1>
      <p>{setupGuideIntroduction}</p>
    </div>
    <section className="setup-progress" aria-label="Resumo do checklist">
      <div className="setup-progress-heading">
        <div aria-live="polite">
          <strong>{completed.length} de {taskIds.length} itens concluídos</strong>
          <p>{finishedSteps} de {steps.length} etapas concluídas</p>
        </div>
        <button type="button" className="command-button guide-link" onClick={reset} disabled={!ready || completed.length === 0}>
          <RotateCcw aria-hidden="true" size={18} />Começar outro dispositivo
        </button>
      </div>
      <progress aria-label="Progresso da configuração" aria-valuenow={completed.length} aria-valuemax={taskIds.length} value={completed.length} max={taskIds.length} />
      <p className="setup-progress-note">As marcações ficam nesta aba e são limpas ao sair da conta. Marcar os itens não executa comandos nem verifica o computador automaticamente.</p>
    </section>
    <article className="setup-checklist" aria-label="Etapas de configuração">
      {steps.map((step, stepIndex) => {
        const count = step.tasks.filter((_, index) => completed.includes(step.id + '-' + index)).length;
        const finished = count === step.tasks.length;
        return <section className={'setup-step' + (finished ? ' setup-step-complete' : '')} key={step.id} aria-labelledby={'step-' + step.id}>
          <header className="setup-step-heading">
            <span className="setup-step-number" aria-hidden="true">{finished ? <Check size={20} /> : stepIndex + 1}</span>
            <h2 id={'step-' + step.id}>{step.title}</h2>
            <span className="setup-step-count">{count}/{step.tasks.length}</span>
          </header>
          <ul className="setup-tasks">
            {step.tasks.map((task, index) => {
              const id = step.id + '-' + index;
              return <li key={id}>
                <input id={id} type="checkbox" checked={completed.includes(id)} disabled={!ready} onChange={() => toggle(id)} />
                <label htmlFor={id}><MarkdownRenderer inline content={task} /></label>
              </li>;
            })}
          </ul>
          {step.details && <div className="setup-step-details"><MarkdownRenderer content={step.details} /></div>}
        </section>;
      })}
    </article>
  </>;
}
