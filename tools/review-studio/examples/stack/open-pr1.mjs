import {resolve} from 'node:path';
import {startServer} from '../../server.mjs';

// Starts the studio on DATA_ROOT and opens the exact PR1 comparison, so the prepared stack's behavior view appears.
const [repoPath,dataPath,port='47840']=process.argv.slice(2);
if(!dataPath)throw new Error('Usage: node tools/review-studio/examples/stack/open-pr1.mjs REPO DATA_ROOT [PORT]');
const app=await startServer({dataRoot:resolve(dataPath),port:Number(port),seed:false});
const doc=await app.workspace.open({repositoryPath:resolve(repoPath),baseRef:'595f590ba2b69e90f73e14c0591be0ca3d8f97d7',headRef:'8967e5d3e193b84d62ae359f59ae37a0312014b3',intent:'PR #1 · ELI5 depth, per-card costs + daily budget'});
console.log(`Open ${app.url}#review=${doc.id}`);
