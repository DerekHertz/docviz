// L1 on jev-1.13.0: Jev picks the card form and diagram kind for each doc section (lab/l1.js).
import { makeExperiment } from '../l1-experiment.js';

const exp = makeExperiment({ id: 'l1-jev113', model: 'jev-1.13.0' });
export const { cases, mutationNames, mutationHow, meta, evaluate } = exp;
