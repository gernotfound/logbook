import type { User } from 'firebase/auth';
import { auth, ensureAppCheck } from './firebase';

const KEY='logbook_deletion_recovery_devices_v1';
const API=(import.meta.env.VITE_ACCOUNT_DELETION_API_ORIGIN || 'https://logbook-gnf.vercel.app').replace(/\/$/,'');
const MAX_DEVICES=4;
type Credential={uid:string;token:string};

function randomToken():string{const bytes=crypto.getRandomValues(new Uint8Array(32));let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');}
function readAll():Credential[]{try{const v=localStorage.getItem(KEY);const p=v?JSON.parse(v):[];return Array.isArray(p)?p.filter(x=>typeof x?.uid==='string'&&typeof x?.token==='string').slice(-MAX_DEVICES):[];}catch{return [];}}
function writeAll(v:Credential[]){const bounded=v.slice(-MAX_DEVICES);if(bounded.length===0)localStorage.removeItem(KEY);else localStorage.setItem(KEY,JSON.stringify(bounded));}
export function removeDeletionRecoveryCredential(uid:string):void{writeAll(readAll().filter(x=>x.uid!==uid));}
async function appToken(){await ensureAppCheck();const {getLimitedUseAppCheckToken}=await import('./appCheck');const t=await getLimitedUseAppCheckToken();if(!t)throw new Error('App Check non disponibile.');return t;}

export async function registerDeletionRecoveryDevice(user:User):Promise<void>{
 if(!API||!navigator.onLine)return;
 const all=readAll();let cred=all.find(x=>x.uid===user.uid);
 if(!cred){cred={uid:user.uid,token:randomToken()};writeAll([...all.filter(x=>x.uid!==user.uid),cred]);}
 const response=await fetch(API+'/api/account-deletion-device',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+await user.getIdToken(true),'x-firebase-appcheck':await appToken()},body:JSON.stringify({deviceToken:cred.token}),cache:'no-store'});
 if(!response.ok)throw new Error('Registrazione recovery device non riuscita.');
}
export async function recoverDeletedAccountOnThisDevice(purge:(owner:string)=>Promise<void>):Promise<boolean>{
 if(!API||!navigator.onLine||auth.currentUser)return false;
 let changed=false;const kept:Credential[]=[];
 for(const cred of readAll()){
   const response=await fetch(API+'/api/account-deletion-device',{headers:{'x-firebase-appcheck':await appToken(),'x-account-deletion-uid':cred.uid,'x-account-deletion-device':cred.token},cache:'no-store'});
   if(!response.ok){kept.push(cred);continue;}
   const body=await response.json() as {status?:string};
   if(body.status==='complete'){await purge('user:'+cred.uid);changed=true;} else kept.push(cred);
 }
 if(changed)writeAll(kept);
 return changed;
}
