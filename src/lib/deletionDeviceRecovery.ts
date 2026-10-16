import { BACKEND_API_ORIGIN as API } from './backendApi';
import type { User } from 'firebase/auth';
import { auth, ensureAppCheck } from './firebase';
import { readBrowserValueStrict, removeBrowserValue, writeBrowserJson } from './sync/browserStorage';
import { assertDeletionDeadlineActive, withDeletionDeadline } from './deletionDeadline';
import { DeletionDeviceOperationError, deviceOperationFailure, type RecoveryPhase } from './deletionRecoveryDiagnostics';

const KEY='logbook_deletion_recovery_devices_v1';
const MAX_DEVICES=4;
const RECOVERY_REQUEST_TIMEOUT_MS=7_500;
type Credential={uid:string;token:string};

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
   if(typeof candidate.uid!=='string'||candidate.uid.length===0||typeof candidate.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(candidate.token))throw new DeletionRecoveryCredentialCorruptError();
   credentials.push({uid:candidate.uid,token:candidate.token});
 }
 return credentials.slice(-MAX_DEVICES);
}
function writeAll(v:Credential[]){const bounded=v.slice(-MAX_DEVICES);if(bounded.length===0)removeBrowserValue(KEY);else writeBrowserJson(KEY,bounded);}
export function removeDeletionRecoveryCredential(uid:string):void{writeAll(readAll().filter(x=>x.uid!==uid));}
async function appToken(signal:AbortSignal){
 await ensureAppCheck();
 assertDeletionDeadlineActive(signal);
 const {getLimitedUseAppCheckToken}=await import('./appCheck');
 assertDeletionDeadlineActive(signal);
 const token=await getLimitedUseAppCheckToken();
 assertDeletionDeadlineActive(signal);
 return token;
}

export async function registerDeletionRecoveryDevice(user:User):Promise<void>{
 if(!API)throw new DeletionDeviceOperationError('device-registration','http','unknown');
 if(!navigator.onLine)throw new DeletionDeviceOperationError('device-registration','http','transport');
 const all=readAll();let cred=all.find(x=>x.uid===user.uid);
 if(!cred){cred={uid:user.uid,token:randomToken()};writeAll([...all.filter(x=>x.uid!==user.uid),cred]);}
 let phase:RecoveryPhase='auth-token';
 try{
   await withDeletionDeadline(async signal=>{
     const idToken=await user.getIdToken();
     assertDeletionDeadlineActive(signal);
     if(auth.currentUser?.uid!==user.uid)throw new DeletionDeviceOperationError('device-registration','auth-token','stale-session');
     phase='app-check';
     const check=await appToken(signal);
     assertDeletionDeadlineActive(signal);
     if(auth.currentUser?.uid!==user.uid)throw new DeletionDeviceOperationError('device-registration','auth-token','stale-session');
     phase='http';
     const response=await fetch(API+'/api/account-deletion-device',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+idToken,'x-firebase-appcheck':check},body:JSON.stringify({deviceToken:cred.token}),cache:'no-store',signal});
     assertDeletionDeadlineActive(signal);
     if(response.status!==200)throw deviceOperationFailure('device-registration','http',undefined,response.status);
     phase='response-body';
     const body:unknown=await response.json();
     assertDeletionDeadlineActive(signal);
     phase='server-status';
     if(!body||typeof body!=='object'||Array.isArray(body)
       || (body as {registered?:unknown}).registered!==true){
       throw new DeletionDeviceOperationError('device-registration','server-status','invalid-response');
     }
     if(auth.currentUser?.uid!==user.uid)throw new DeletionDeviceOperationError('device-registration','auth-token','stale-session');
   },RECOVERY_REQUEST_TIMEOUT_MS);
 }catch(error){
   throw deviceOperationFailure('device-registration',phase,error);
 }
}

export function watchDeletionRecoveryDeviceRegistration(
 user:User,
 onError:(error:unknown)=>void=()=>{},
 onSuccess:()=>void=()=>{},
):()=>void{
 let disposed=false;let running=false;let registered=false;
 const attempt=async()=>{
   if(disposed||running||registered||!API||!navigator.onLine||auth.currentUser?.uid!==user.uid)return;
   running=true;
   try{await registerDeletionRecoveryDevice(user);if(!disposed&&auth.currentUser?.uid===user.uid){registered=true;onSuccess();}}catch(error){if(!disposed&&auth.currentUser?.uid===user.uid)onError(error);}finally{running=false;}
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
 let firstFinalizationError:DeletionRecoveryFinalizationError|undefined;
 for(const cred of readAll()){
   let phase:RecoveryPhase='app-check';
   let status:number;
   let body:unknown;
   try{
     ({status,body}=await withDeletionDeadline(async signal=>{
       const check=await appToken(signal);
       assertDeletionDeadlineActive(signal);
       phase='http';
       const response=await fetch(API+'/api/account-deletion-device',{headers:{'x-firebase-appcheck':check,'x-account-deletion-uid':cred.uid,'x-account-deletion-device':cred.token},cache:'no-store',signal});
       assertDeletionDeadlineActive(signal);
       if(!response.ok)return{status:response.status,body:undefined};
       phase='response-body';
       const json:unknown=await response.json();
       assertDeletionDeadlineActive(signal);
       return{status:response.status,body:json};
     },RECOVERY_REQUEST_TIMEOUT_MS));
     if(status===404)continue; // Expired/missing proof is not evidence of deletion.
     if(status!==200)throw deviceOperationFailure('routine-check','http',undefined,status);
     phase='server-status';
     if(!body||typeof body!=='object'||Array.isArray(body)||typeof (body as {status?:unknown}).status!=='string'){
       throw new DeletionDeviceOperationError('routine-check','server-status','invalid-response');
     }
     const remoteStatus=(body as {status:string}).status;
     if(remoteStatus==='failed')throw new DeletionDeviceOperationError('routine-check','server-status','remote-failed');
     if(!['none','requested','deleting','verifying','complete'].includes(remoteStatus)){
       throw new DeletionDeviceOperationError('routine-check','server-status','invalid-response');
     }
     if(remoteStatus!=='complete')continue;
   }catch(error){
     const failure=deviceOperationFailure('routine-check',phase,error);
     // A transient failure for owner A cannot mask a definitive failure for B.
     const significant=(value:DeletionDeviceOperationError)=>['remote-failed','invalid-response','rejected'].includes(value.kind);
     if(!firstRequestError
       || (significant(failure) && !(firstRequestError instanceof DeletionDeviceOperationError && significant(firstRequestError))))firstRequestError=failure;
     continue;
   }
   try{
     const outcome=await finalize(cred.uid);
     if(outcome.status==='complete')completed=true;
     else pendingMessage=outcome.message;
   }catch(error){
     firstFinalizationError??=new DeletionRecoveryFinalizationError(error);
   }
 }
 if(firstFinalizationError)throw firstFinalizationError;
 // A completed device must not conceal another verified device whose cloud
 // deletion failed or whose response violates the server status contract.
 if(firstRequestError instanceof DeletionDeviceOperationError
   && (firstRequestError.kind==='remote-failed'||firstRequestError.kind==='invalid-response'||firstRequestError.kind==='rejected'))throw firstRequestError;
 if(completed)return{status:'complete'};
 if(pendingMessage)return{status:'pending',message:pendingMessage};
 if(firstRequestError)throw firstRequestError;
 return{status:'none'};
}
