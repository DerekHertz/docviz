import {resolve} from 'node:path';
import {startServer} from '../../server.mjs';

// Starts the studio on DATA_ROOT and opens PR18 (c31d97d → CANDIDATE). Prepare PR18 and PR1 into the same
// DATA_ROOT first, so the reviewer comparison's target link opens the PR1 lifecycle.
const [repoPath,dataPath,candidate,port='47840']=process.argv.slice(2);
if(!candidate)throw new Error('Usage: node tools/review-studio/examples/stack/open-pr18.mjs REPO DATA_ROOT CANDIDATE_SHA [PORT]');
const app=await startServer({dataRoot:resolve(dataPath),port:Number(port),seed:false});
const doc=await app.workspace.open({repositoryPath:resolve(repoPath),baseRef:'c31d97dd082d887bc108a22f91dcd36aa47ebe16',headRef:candidate,intent:'PR #18 · visual review studio + independent contract review'});
console.log(`Open ${app.url}#review=${doc.id}`);
