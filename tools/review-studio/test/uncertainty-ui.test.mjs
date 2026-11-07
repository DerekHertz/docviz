import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceJudgmentPresentation} from '../ui/verification.mjs';
test('insufficient source context is visibly uncertainty while old contradictions retain their recorded meaning',()=>{
 const uncertain=sourceJudgmentPresentation({kind:'source-judgment',result:'uncertain',uncertaintyReason:'insufficient-source-context',contextSufficient:.1,contradicted:.9});
 assert.equal(uncertain.label,'Source context uncertain');assert.equal(uncertain.tone,'pending');assert.match(uncertain.detail,/source context/i);
 const contradiction=sourceJudgmentPresentation({kind:'source-judgment',result:'contradicts'});
 assert.equal(contradiction.label,'Source contradiction');assert.equal(contradiction.tone,'bad');
 const unknown=sourceJudgmentPresentation({kind:'source-judgment',result:'unknown',uncertaintyReason:'invalid-model-response'});
 assert.equal(unknown.label,'Source check incomplete');assert.equal(unknown.tone,'pending');
 assert.equal(sourceJudgmentPresentation({kind:'executed-command',result:'pass'}).label,'pass');
});
