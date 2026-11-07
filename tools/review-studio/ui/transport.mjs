export function surfaceContext(){return null;}
export async function request(path,body,token){
 const response=await fetch(path,body?{method:'POST',headers:{'content-type':'application/json','x-docviz-token':token||''},body:JSON.stringify(body)}:{});
 const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error||'The local action did not complete.'),{status:response.status});return value;
}
