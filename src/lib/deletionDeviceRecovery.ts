import type { User } from 'firebase/auth';
import { auth, ensureAppCheck } from './firebase';

const KEY='logbook_deletion_recovery_device_v1';
const API=(import.meta.env.VITE_ACCOUNT_DELETION_API_ORIGIN || 'https://logbook-gnf.vercel.app').replace(/\/$/,'');
type Credential={uid:string;token:string};

function randomToken():string{const bytes=crypto.getRandomValues(new Uint8Array(32));let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');}
function read():Credential|null{try{const v=localStorage.getItem(KEY);if(!v)return null;const p=JSON.parse(v);return typeof p?.uid==='string'&&typeof p?.token==='string'?p:null;}catch{return null;}}
function write(v:Credential){localStorage.setItem(KEY,JSON.stringify(v));}
async function appToken(){await ensureAppCheck();const {getAppCheckToken}=await import('./appCheck');const t=await getAppCheckToken(true);if(!t)throw new Error('App Check non disponibile.');return t;}

export async function registerDeletionRecoveryDevice(user:User):Promise<void>{
 if(!API||!navigator.onLine)return;
 let cred=read();if(!cred||cred.uid!==user.uid){cred={uid:user.uid,token:randomToken()};write(cred);}
 const response=await fetch(API+'/api/account-deletion-device',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+await user.getIdToken(true),'x-firebase-appcheck':await appToken()},body:JSON.stringify({deviceToken:cred.token}),cache:'no-store'});
 if(!response.ok)throw new Error('Registrazione recovery device non riuscita.');
}
export async function recoverDeletedAccountOnThisDevice(purge:(owner:string)=>Promise<void>):Promise<boolean>{
 if(!API||!navigator.onLine||auth.currentUser)return false;
 const cred=read();if(!cred)return false;
 const response=await fetch(API+'/api/account-deletion-device',{headers:{'x-firebase-appcheck':await appToken(),'x-account-deletion-uid':cred.uid,'x-account-deletion-device':cred.token},cache:'no-store'});
 if(!response.ok)return false;
 const body=await response.json() as {status?:string};
 if(body.status!=='complete')return false;
 await purge('user:'+cred.uid);localStorage.removeItem(KEY);return true;
}
