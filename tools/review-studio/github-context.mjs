export function parseGitHubContext(input){
 let u;try{u=new URL(input);}catch{return null;}
 if(u.protocol!=='https:'||u.hostname!=='github.com'||u.port||u.username||u.password)return null;
 const pr=u.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)(?:\/(?:files|commits|checks|changes)(?:\/[^/?#]+)?)?\/?$/);
 if(pr){if(!Number.isSafeInteger(Number(pr[3]))||['.','..'].includes(pr[1])||['.','..'].includes(pr[2]))return null;return{kind:'pull-request',owner:pr[1],repo:pr[2],number:Number(pr[3]),url:`https://github.com/${pr[1]}/${pr[2]}/pull/${pr[3]}`};}
 const compare=u.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/compare\/(.+?)\.\.\.(.+)$/);if(!compare)return null;
 let base,head;try{base=decodeURIComponent(compare[3]);head=decodeURIComponent(compare[4]);}catch{return null;}
 if([compare[1],compare[2]].some(x=>['.','..'].includes(x))||[base,head].some(x=>!x||x.length>250||/[\s\0:]/.test(x)||x.includes('..')||x.startsWith('-')))return null;
 return{kind:'comparison',owner:compare[1],repo:compare[2],base,head,url:`https://github.com/${compare[1]}/${compare[2]}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`};
}
export function sameGitHubContext(a,b){return !!a&&!!b&&a.kind===b.kind&&a.owner.toLowerCase()===b.owner.toLowerCase()&&a.repo.toLowerCase()===b.repo.toLowerCase()&&(a.kind==='pull-request'?a.number===b.number:a.base===b.base&&a.head===b.head);}
