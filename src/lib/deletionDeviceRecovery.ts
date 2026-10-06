import type { User } from 'firebase/auth';
import { auth, ensureAppCheck } from './firebase';
import { readBrowserValueStrict, removeBrowserValue, writeBrowserJson } from './sync/browserStorage';

const KEY='logbook_deletion_recovery_devices_v1';
const API=(import.meta.env.VITE_ACCOUNT_DELETION_API_ORIGIN || 'https://logbook-gnf.vercel.app').replace(/\/$/,'');
const MAX_DEVICES=4;
type Credential={uid:string;token:string};

class DeletionRecoveryRequestError extends Error {
 readonly code='account-deletion-device-request-failed';
 constructor(message:string,readonly status:number){super(message+' (HTTP '+status+').');this.name='DeletionRecoveryRequestError';}
}
export class DeletionRecoveryFinalizationError extends Error {
 readonly code='account-deletion-device-finalization-failed';
 constructor(error:unknown){super(error instanceof Error?error.message:'Account eliminato dal cloud, ma la pulizia locale non è stata completata.',error instanceof Error?{cause:error}:undefined);this.name='DeletionRecoveryFinalizationError';}
}

export class DeletionRecoveryCredentialCorruptError extends Error {
 readonly code='account-deletion-device-credential-corrupt';
 constructor(error?:unknown){super('Credenziali locali di recovery account non leggibili.',error instanceof Error?{cause:error}:undefined);this.name='DeletionRecoveryCredentialCorruptError';}
}

function randomToken():string{const bytes=crypto.getRandomValues(new Uint8Array(32));let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');}
function readAll():Credential[]{
 const raw=readBrowserValueStrict(KEY);
 if(!raw)return[];
 let parsed:unknown;
 try{parsed=JSON.parse(raw);}catch(error){throw new DeletionRecoveryCredentialCorruptError(error);}
 if(!Array.isArray(parsed))throw new DeletionRecoveryCredentialCorruptError();
 const credentials:Credential[]=[];
 for(const item of parsed){
   if(!item||typeof item!=='object')throw new DeletionRecoveryCredentialCorruptError();
   const candidate=item as {uid?:unknown;token?:unknown};
   if(typeof candidate.uid!=='string'||candidate.uid.length===0||typeof candidate.token!=='string'||candidate.token.length===0)throw new DeletionRecoveryCredentialCorruptError();
   credentials.push({uid:candidate.uid,token:candidate.token});
 }
 return credentials.slice(-MAX_DEVICES);
}
function writeAll(v:Credential[]){const bounded=v.slice(-MAX_DEVICES);if(bounded.length===0)removeBrowserValue(KEY);else writeBrowserJson(KEY,bounded);}
export function removeDeletionRecoveryCredential(uid:string):void{writeAll(readAll().filter(x=>x.uid!==uid));}
async function appToken(){
 await ensureAppCheck();
 const {getLimitedUseAppCheckToken}=await import('./appCheck');
 try{return await getLimitedUseAppCheckToken();}
 catch(error){throw new Error('Verifica di sicurezza temporaneamente non disponibile. La copia locale resta conservata; il controllo verrà ripetuto automaticamente.',{cause:error});}
}

export async function registerDeletionRecoveryDevice(user:User):Promise<void>{
 if(!API||!navigator.onLine)return;
 const all=readAll();let cred=all.find(x=>x.uid===user.uid);
 if(!cred){cred={uid:user.uid,token:randomToken()};writeAll([...all.filter(x=>x.uid!==user.uid),cred]);}
 const response=await fetch(API+'/api/account-deletion-device',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+await user.getIdToken(),'x-firebase-appcheck':await appToken()},body:JSON.stringify({deviceToken:cred.token}),cache:'no-store'});
 if(!response.ok)throw new DeletionRecoveryRequestError('Registrazione recovery device non riuscita',response.status);
}

export function watchDeletionRecoveryDeviceRegistration(
 user:User,
 onError:(error:unknown)=>void=()=>{},
):()=>void{
 let disposed=false;let running=false;let registered=false;
 const attempt=async()=>{
   if(disposed||running||registered||!API||!navigator.onLine||auth.currentUser?.uid!==user.uid)return;
   running=true;
   try{await registerDeletionRecoveryDevice(user);registered=true;}catch(error){if(!disposed)onError(error);}finally{running=false;}
 };
 const handleOnline=()=>{void attempt();};
 const handleVisibility=()=>{if(document.visibilityState==='visible')void attempt();};
 void attempt();
 window.addEventListener('online',handleOnline);
 document.addEventListener('visibilitychange',handleVisibility);
 return()=>{disposed=true;window.removeEventListener('online',handleOnline);document.removeEventListener('visibilitychange',handleVisibility);};
}
type LocalDeletionCompletion={status:'complete'}|{status:'pending';message:string};
export type DeviceDeletionRecoveryOutcome={status:'none'}|LocalDeletionCompletion;
export async function recoverDeletedAccountOnThisDevice(finalize:(uid:string)=>Promise<LocalDeletionCompletion>):Promise<DeviceDeletionRecoveryOutcome>{
 if(!API||!navigator.onLine)return{status:'none'};
 let pendingMessage:string|undefined;let completed=false;let firstRequestError:Error|undefined;
 for(const cred of readAll()){
   const response=await fetch(API+'/api/account-deletion-device',{headers:{'x-firebase-appcheck':await appToken(),'x-account-deletion-uid':cred.uid,'x-account-deletion-device':cred.token},cache:'no-store'});
   if(!response.ok){
     if(response.status!==404&&!firstRequestError)firstRequestError=new DeletionRecoveryRequestError('Verifica recovery device non riuscita',response.status);
     continue;
   }
   const body=await response.json() as {status?:string};
   if(body.status!=='complete')continue;
   let outcome:LocalDeletionCompletion;
   try{outcome=await finalize(cred.uid);}catch(error){throw new DeletionRecoveryFinalizationError(error);}
   if(outcome.status==='complete')completed=true;
   else pendingMessage=outcome.message;
 }
 if(completed)return{status:'complete'};
 if(pendingMessage)return{status:'pending',message:pendingMessage};
 if(firstRequestError)throw firstRequestError;
 return{status:'none'};
}