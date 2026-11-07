#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
const usage='Usage: node cli.mjs serve [--open] | open --repo PATH --base REF [--head REF] [--direct] | context REVIEW_ID | import REVIEW_ID PACKAGE.json [ROLE]';
async function main(){
 const[command,...args]=process.argv.slice(2);
 if(command==='serve'||!command){const{startServer}=await import('./server.mjs');await startServer({openBrowser:args.includes('--open')});return;}
 if(command==='--help'||command==='help'){console.log(usage);return;}
 const base=`http://127.0.0.1:${process.env.DOCVIZ_REVIEW_PORT||47836}`;
 const boot=await fetch(base+'/api/bootstrap').then(r=>r.json()).catch(()=>{throw new Error('Start Docviz with node cli.mjs serve, or double-click Launch Docviz.command.');});
 const request=async(path,body)=>{const r=await fetch(base+path,body?{method:'POST',headers:{'content-type':'application/json','x-docviz-token':boot.token},body:JSON.stringify(body)}:{});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;};
 if(command==='context'){if(!args[0])throw new Error(usage);process.stdout.write(JSON.stringify(await request(`/api/reviews/${args[0]}/context`),null,2)+'\n');}
 else if(command==='import'){if(!args[0]||!args[1])throw new Error(usage);const data=await request(`/api/reviews/${args[0]}/actions`,{action:'import',package:JSON.parse(await readFile(args[1],'utf8')),role:args[2]||'reviewer'});console.log(JSON.stringify({id:data.id,version:data.version,contributions:data.contributions.length}));}
 else if(command==='open'){const value=flag=>{const i=args.indexOf(flag);if(i<0||!args[i+1]||args[i+1].startsWith('--'))throw new Error(usage);return args[i+1];};const data=await request('/api/open',{repositoryPath:value('--repo'),baseRef:value('--base'),headRef:args.includes('--head')?value('--head'):'HEAD',mode:args.includes('--direct')?'direct':'merge-base'});console.log(base+'/#review='+data.id);}
 else throw new Error(usage);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
