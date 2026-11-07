(() => {
 const key='__docvizGitHubSurface';if(globalThis[key])return;globalThis[key]=true;
 let current=null,panel=null,frame=null,button=null,entry=null,previousFocus=null,scheduled=false;
 function pr(){return parseGitHubContext(location.href)?.url||null;}
 function close(){if(!panel)return;panel.hidden=true;button?.setAttribute('aria-expanded','false');previousFocus?.focus();}
 function destroy(){panel?.remove();entry?.remove();panel=frame=button=entry=null;current=null;}
 function toggle(){if(!current)return;if(!panel){
   panel=document.createElement('section');panel.id='docviz-github-panel';panel.setAttribute('aria-label','Docviz visual review');
   const header=document.createElement('div');header.className='docviz-surface-heading';const title=document.createElement('strong');title.textContent='Visual review';const note=document.createElement('span');note.textContent='Component → property → evidence → decision';const closeButton=document.createElement('button');closeButton.type='button';closeButton.textContent='Return to GitHub';closeButton.addEventListener('click',close);header.append(title,note,closeButton);
   frame=document.createElement('iframe');frame.title='Docviz component and evidence explorer';frame.src=chrome.runtime.getURL('ui/index.html')+'?githubPR='+encodeURIComponent(current);frame.referrerPolicy='no-referrer';panel.append(header,frame);
   entry.insertAdjacentElement('afterend',panel);
  }
  if(!panel.hidden&&button.getAttribute('aria-expanded')==='true'){close();return;}previousFocus=document.activeElement;panel.hidden=false;button.setAttribute('aria-expanded','true');panel.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
 }
 function reconcile(){
  const next=pr();if(next!==current){destroy();current=next;}if(!current)return;
  const visible=element=>!!element?.getClientRects().length&&getComputedStyle(element).visibility!=='hidden';
  const nav=[...document.querySelectorAll('nav,[role="navigation"]')].find(element=>visible(element)&&/pull request/i.test(element.getAttribute('aria-label')||''));
  const heading=[...document.querySelectorAll('h1')].find(element=>visible(element)&&!element.closest('#docviz-github-panel'));
  const mount=nav||heading?.parentElement;if(!mount)return;
  if(button?.isConnected){if(panel&&!panel.isConnected)entry.insertAdjacentElement('afterend',panel);return;}
  entry?.remove();entry=document.createElement('div');entry.id='docviz-github-entry';entry.className='docviz-github-entry';
  button=document.createElement('button');button.id='docviz-visual-review-tab';button.type='button';button.className='docviz-visual-review-tab';button.textContent='Visual review';button.setAttribute('aria-expanded',String(!!panel&&!panel.hidden));button.setAttribute('aria-controls','docviz-github-panel');button.addEventListener('click',toggle);
  const hint=document.createElement('span');hint.textContent='Explore components, properties, evidence and agent claims';entry.append(button,hint);mount.insertAdjacentElement('afterend',entry);
  if(panel&&!panel.isConnected)entry.insertAdjacentElement('afterend',panel);
 }
 const schedule=()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;reconcile();});};
 new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});addEventListener('popstate',schedule);addEventListener('pageshow',schedule);document.addEventListener('turbo:load',schedule);document.addEventListener('pjax:end',schedule);
 chrome.runtime.onMessage.addListener((message,sender)=>{if(sender.id===chrome.runtime.id&&message?.type==='docviz.toggle'){reconcile();toggle();}});reconcile();
})();
