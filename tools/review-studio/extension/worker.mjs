import{validateSender,validateRequest,assertBoundReview,publicBootstrap,parseGitHubContext,samePullRequest}from'./protocol.mjs';
const engine='http://127.0.0.1:47836';let token=null;
async function engineRequest(path,body){
 let response;try{response=await fetch(engine+path,{...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json','x-docviz-token':token||''},body:JSON.stringify(body)}),signal:AbortSignal.timeout(35000)});}catch{throw new Error('Start the local Docviz engine, then retry. Double-click Launch Docviz.command in your Docviz app folder.');}
 const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error||'The engine request failed.'),{status:response.status});return value;
}
async function bootstrap(){const value=await engineRequest('/api/bootstrap');token=value.token;return value;}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 (async()=>{
  const tab=sender.tab?.id==null?null:await chrome.tabs.get(sender.tab.id),context=validateSender(sender,chrome.runtime.id,tab?.url),request=validateRequest(message,context);
  if(request.kind==='bootstrap')return publicBootstrap(await bootstrap(),context);
  if(!token)await bootstrap();
  if(request.kind==='review')assertBoundReview(await engineRequest('/api/reviews/'+request.reviewId),context);
  if(request.kind==='job'){
   const job=await engineRequest(request.path);if(job.reviewId)assertBoundReview(await engineRequest('/api/reviews/'+job.reviewId),context);else if(!samePullRequest(parseGitHubContext(job.context?.githubUrl||job.context?.prUrl),context))throw new Error('This job belongs to another PR.');return job;
  }
  let value;try{value=await engineRequest(request.path,request.body);}catch(error){if(error.status!==403)throw error;await bootstrap();value=await engineRequest(request.path,request.body);}
  if(request.kind==='review'&&value?.snapshot)assertBoundReview(value,context);return value;
 })().then(value=>reply({ok:true,value})).catch(error=>reply({ok:false,error:error.message,status:error.status||400}));return true;
});
chrome.action.onClicked.addListener(tab=>{if(tab.id&&parseGitHubContext(tab.url))chrome.tabs.sendMessage(tab.id,{type:'docviz.toggle'}).catch(()=>{});});
