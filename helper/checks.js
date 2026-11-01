// Checks docviz runs on what it draws. Each one was tried and adopted in the lab first
// (`docviz lab`); the lab imports these definitions, so it tests exactly what ships.
import { askJev } from './jev.js';

// Step check (lab C3, adopted 2026-10-30): does a step's label match its linked code?
// "Does it match?" as one question passed labels that were consistent with the code but claimed
// more than it shows, so it is asked as two: is every claim shown, and is anything contradicted.
export const ADOPTED = { supportedAt: 0.6, contradictedAt: 0.5 };

// `context` (optional): the definitions of what the step calls (helper/context.js). It lets a
// label that names a helper's job be checked; claims about callers or settings stay unshown.
export const stepRequest = (label, code, context) => ({
  state: { label, code: `\`\`\`\n${code}\n\`\`\``, ...(context && { context: `\`\`\`\n${context}\n\`\`\`` }) },
  questions: {
    supported: {
      type: 'noul',
      instructions: context
        ? 'Is every claim in the step label shown by these lines of code, or by the definitions of what they call?'
        : 'Is every claim in the step label shown by these lines of code?',
      criteria: {
        true: `Everything the label says happens is visible in the code shown${context ? ' (the step\'s lines or the definitions they call)' : ''}. Rewording is fine.`,
        false: 'At least one claim in the label (who calls it, where a value comes from, when or why it runs) is not visible in the code shown, or the code shows otherwise.',
      },
    },
    contradicted: {
      type: 'noul',
      instructions: 'Do these lines of code contradict the step label?',
      criteria: {
        true: 'The code shown does something different from the label, or plainly does less than the label claims.',
        false: 'Nothing in the code shown conflicts with the label, even if the label mentions things the code does not show.',
      },
    },
  },
});

/** Jev's two probabilities → 'pass' | 'flag' | 'review' (null when unanswered). */
export function decideStep({ prob, probContra }, cutoffs = ADOPTED) {
  if (prob == null || probContra == null) return null;
  if (probContra >= cutoffs.contradictedAt) return 'flag';
  if (prob >= cutoffs.supportedAt) return 'pass';
  return 'review';
}

const stepCode = (s) => s.cuts.map((c) => `// ${c.path}:${c.start}-${c.end}\n${c.text}`).join('\n\n');

/**
 * One Jev request per step, in parallel. A step whose check fails is 'unchecked'; the others
 * still count. Every result carries its usage, so the caller can charge it.
 */
export async function checkSteps(steps, { ask = askJev, cutoffs = ADOPTED } = {}) {
  return Promise.all(steps.map(async (s) => {
    try {
      const { answers, usage } = await ask(stepRequest(s.label, stepCode(s)));
      const prob = answers.supported?.noul;
      const probContra = answers.contradicted?.noul;
      return { id: s.id, verdict: decideStep({ prob, probContra }, cutoffs) || 'unchecked', prob, probContra, usage };
    } catch (e) {
      return { id: s.id, verdict: 'unchecked', error: e.message, usage: e.usage || null };
    }
  }));
}
