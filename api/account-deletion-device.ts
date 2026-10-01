import { RequestAuthError, verifyDeletionRequester, verifyStatusAppCheck } from '../server/accountDeletion/httpAuth.js';
import { readDeletionStatusForUid, validateUid } from '../server/accountDeletion/jobStore.js';
import { registerDeletionRecoveryDevice, verifyDeletionRecoveryDevice } from '../server/accountDeletion/deviceRecovery.js';

export const maxDuration = 30;
const ALLOWED_ORIGIN = process.env.PUBLIC_APP_ORIGIN || 'https://thelogbook.web.app';
const headers=(origin:string|null):HeadersInit=>origin===ALLOWED_ORIGIN?{
 'access-control-allow-origin':origin,'access-control-allow-methods':'GET, POST, OPTIONS',
 'access-control-allow-headers':'authorization, content-type, x-firebase-appcheck, x-account-deletion-uid, x-account-deletion-device',
 'access-control-max-age':'600','vary':'Origin'
}:{'vary':'Origin'};
const json=(body:unknown,status:number,origin:string|null)=>Response.json(body,{status,headers:headers(origin)});
function allowed(req:Request){const o=req.headers.get('origin');if(o!==ALLOWED_ORIGIN)throw new RequestAuthError('Origin non autorizzata.',403);return o;}
export async function OPTIONS(req:Request){const o=req.headers.get('origin');return o===ALLOWED_ORIGIN?new Response(null,{status:204,headers:headers(o)}):json({error:'Origin non autorizzata.'},403,o);}
export async function POST(req:Request){
 const origin=req.headers.get('origin');
 try{allowed(req);const {uid}=await verifyDeletionRequester(req);const body=await req.json() as {deviceToken?:unknown};await registerDeletionRecoveryDevice(uid,body.deviceToken);return json({registered:true},200,origin);}
 catch(e){const status=e instanceof RequestAuthError?e.status:400;return json({error:e instanceof Error?e.message:'Richiesta non valida.'},status,origin);}
}
export async function GET(req:Request){
 const origin=req.headers.get('origin');
 try{allowed(req);await verifyStatusAppCheck(req);const uid=validateUid(req.headers.get('x-account-deletion-uid'));const token=req.headers.get('x-account-deletion-device');if(!await verifyDeletionRecoveryDevice(uid,token))return json({error:'Recovery non autorizzato.'},404,origin);const status=await readDeletionStatusForUid(uid);return status?json(status,200,origin):json({status:'none'},200,origin);}
 catch(e){const status=e instanceof RequestAuthError?e.status:400;return json({error:e instanceof Error?e.message:'Richiesta non valida.'},status,origin);}
}
