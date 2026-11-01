// L1 baseline: today's behavior. Claude reads one section with the real breakdown prompt
// (cardsPrompt, default prefs: behavior-only coverage) and either returns no card or a card whose
// kind and `interactive` flag are its form and kind. Charged like any docviz call.
import { cases, BAR, FORMS } from '../l1.js';
import { complete } from '../../helper/providers.js';
import { cardsPrompt } from '../../helper/prompts.js';

export { cases };
export const mutationNames = { none: 'Label: no card', diagram: 'Label: diagram', interactive: 'Label: diagram + simulation', unlabelled: 'Not labelled yet' };
export const mutationHow = { none: FORMS.none, diagram: FORMS.diagram, interactive: FORMS.interactive, unlabelled: 'waiting for the labelling agent' };

export const meta = {
  id: 'l1-claude',
  code: 'L1',
  variant: 'Claude (today’s behavior)',
  group: 'L1',
  title: 'Card layout: Jev picks form and diagram kind',
  evaluator: 'claude',
  mode: 'agreement',
  summary: 'The baseline: Claude’s own form and kind while it writes the card, as docviz does today, on the same 44 sections.',
  // Time and cost are reported, not judged: Claude writes the whole card in the same call.
  bar: { ...BAR, p50Ms: null, costPerCard: null },
  tested: {
    given: ['the page title and URL', 'the section heading and text', 'docviz’s card rules and default prefs'],
    asked: 'The real breakdown prompt: a card only for sections that describe behavior, with kind and interactive chosen by Claude.',
    leftToCode: ['Form: no card when Claude returns none; interactive when its card sets interactive.'],
    decision: 'Claude’s card (or none), as the product makes it today.',
    real: 'one Claude call per section (it also writes the card)',
  },
};

export async function evaluate(c) {
  const started = Date.now();
  const job = cardsPrompt({ page: { title: c.source.repo, url: c.source.url }, sections: [{ id: c.id, heading: c.heading, text: c.text }] });
  const { output, usage } = await complete('claude', { ...job, timeoutMs: 240_000 });
  const card = output.cards?.[0];
  return {
    pick: card ? { form: card.interactive ? 'interactive' : 'diagram', kind: card.kind } : { form: 'none', kind: null },
    decisionMs: Date.now() - started, card: card || null, flag: null, answers: { card: card || null }, usage, asked: 'cardsPrompt (one section)',
  };
}
