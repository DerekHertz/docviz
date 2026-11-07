import {parseGitHubContext} from '../github-context.mjs';
export function surfaceContext(){return parseGitHubContext(new URL(location.href).searchParams.get('githubPR'));}
export async function request(path,body){
 let reply;try{reply=await chrome.runtime.sendMessage({type:'docviz.request',path,...(body===undefined?{}:{body})});}catch{throw new Error('The extension reloaded. Close Visual review and open it again.');}
 if(!reply?.ok)throw Object.assign(new Error(reply?.error||'The local engine did not respond.'),{status:reply?.status});return reply.value;
}
