// One L1 experiment per Jev model: the same cases, request and bar (lab/l1.js), a pinned model.
import { cases, request, BAR, FORMS, KINDS } from './l1.js';

export function makeExperiment({ id, model }) {
  return {
    cases,
    mutationNames: { none: 'Label: no card', diagram: 'Label: diagram', interactive: 'Label: diagram + simulation', unlabelled: 'Not labelled yet' },
    mutationHow: { none: FORMS.none, diagram: FORMS.diagram, interactive: FORMS.interactive, unlabelled: 'waiting for the labelling agent' },
    meta: {
      id,
      code: 'L1',
      variant: model,
      group: 'L1',
      model,
      title: 'Card layout: Jev picks form and diagram kind',
      evaluator: 'jev',
      mode: 'agreement',
      summary: '44 real doc sections (Node.js, MDN, React, Kubernetes). Jev picks the card form and diagram kind from a fixed set; labels come from a separate agent. Claude’s own pick is the baseline.',
      bar: BAR,
      tested: {
        given: ['the section heading', 'the section text (up to 4,000 characters)', 'a note that it is data'],
        asked: `Which card should this section get (${Object.keys(FORMS).join(' / ')})? Which diagram kind shows its behavior best (${Object.keys(KINDS).join(' / ')})?`,
        leftToCode: ['Whether a pick agrees: an exact match, or the label’s acceptable second kind.', 'Writing the card: Claude, with the kind fixed (cardPrompt adjust.kind).'],
        decision: 'Jev’s chosen option for each question.',
        real: 'one request per doc section, before Claude writes the card',
      },
    },
    async evaluate(c, { ask }) {
      const started = Date.now();
      const { answers, usage } = await ask({ ...request(c), model });
      const form = answers.form || {};
      const kind = answers.kind || {};
      return {
        pick: { form: form.choice, kind: kind.choice }, confidence: { form: form.confidence, kind: kind.confidence },
        probabilities: { form: form.probabilities, kind: kind.probabilities }, decisionMs: Date.now() - started,
        flag: null, answers, usage, asked: JSON.stringify(request(c).questions, null, 1),
      };
    },
  };
}
