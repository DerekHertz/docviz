import {parseGitHubContext,sameGitHubContext} from '../github-context.mjs';
const idPattern=/^[a-f0-9]{24,64}$/;
export {parseGitHubContext};
export function parsePullRequest(input){const context=parseGitHubContext(input);return context?.kind==='pull-request'?context:null;}
export const samePullRequest=sameGitHubContext;
export function validateSender(sender,extensionId,topURL){
 if(sender.id!==extensionId||!Number.isInteger(sender.tab?.id))throw new Error('Only the installed Docviz review frame can contact its engine.');
 const frame=new URL(sender.url),expected=`chrome-extension://${extensionId}`;
 if(frame.protocol+'//'+frame.host!==expected||frame.pathname!=='/ui/index.html')throw new Error('This extension page cannot access review records.');
 const requested=parseGitHubContext(frame.searchParams.get('githubPR')),top=parseGitHubContext(topURL||sender.tab.url);
 if(!samePullRequest(requested,top))throw new Error('The GitHub PR changed. Close Visual review and open it again.');return top;
}
const actions=new Set(['review','property','confirm-property','component','import','apply-contribution','dismiss-contribution','refresh','finish','generate','check','jev']);
export function validateRequest(message,context){
 if(message?.type!=='docviz.request'||typeof message.path!=='string'||message.path.length>3000)throw new Error('Invalid extension request.');
 const body=message.body;if(body!==undefined&&(!body||typeof body!=='object'||Array.isArray(body)||JSON.stringify(body).length>2500000))throw new Error('Invalid review action.');
 const url=new URL(message.path,'http://engine.invalid');if(url.origin!=='http://engine.invalid'||url.pathname!==message.path.split('?')[0]||url.hash)throw new Error('Only local review operations are allowed.');
 const path=url.pathname,method=body===undefined?'GET':'POST';
 if(path==='/api/bootstrap'&&method==='GET')return{path,method,kind:'bootstrap'};
 if(['/api/open-pr','/api/open-github-comparison'].includes(path)&&method==='POST'){if(path!==(context.kind==='comparison'?'/api/open-github-comparison':'/api/open-pr')||!samePullRequest(parseGitHubContext(body.url),context))throw new Error('A GitHub tab can open only its own PR.');return{path,method,body:{url:context.url},kind:'open'};}
 let m=path.match(/^\/api\/jobs\/([\w-]+)$/);if(m&&method==='GET')return{path,method,kind:'job',jobId:m[1]};
 m=path.match(/^\/api\/reviews\/([a-f0-9]{24,64})(?:\/(source|diff|context|export|actions))?$/);
 if(!m||!idPattern.test(m[1]))throw new Error('This operation is unavailable in the GitHub view.');
 const part=m[2];if(method==='POST'&&(part!=='actions'||!actions.has(body.action)))throw new Error('Unsupported review action.');if(method==='GET'&&part==='actions')throw new Error('Invalid review request.');
 if([...url.searchParams.keys()].some(k=>!['path','side'].includes(k)))throw new Error('Unexpected source parameter.');
 return{path:message.path,method,body,kind:'review',reviewId:m[1]};
}
export function assertBoundReview(doc,context){if(![doc?.pr?.url,doc?.githubComparison?.url].some(url=>samePullRequest(parseGitHubContext(url),context)))throw new Error('This review is not bound to the current GitHub PR.');return doc;}
export function publicBootstrap(value,context){const{token,repositories,reviews,jobs,...publicValue}=value;return{...publicValue,repositories:[],reviews:(reviews||[]).filter(r=>[r.prUrl,r.comparisonUrl].some(url=>samePullRequest(parseGitHubContext(url),context))),jobs:(jobs||[]).filter(j=>samePullRequest(parseGitHubContext(j.context?.githubUrl||j.context?.prUrl),context)||(reviews||[]).some(r=>r.id===j.reviewId&&[r.prUrl,r.comparisonUrl].some(url=>samePullRequest(parseGitHubContext(url),context))))};}
