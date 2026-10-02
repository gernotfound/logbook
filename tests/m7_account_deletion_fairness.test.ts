import { describe, expect, it, vi } from 'vitest';

const poison=Array.from({length:30},(_,i)=>({id:'poison-'+i,data:()=>({uid:'poison-'+i,status:'failed',retryable:false,attempts:1,updatedAt:{toMillis:()=>i}})}));
const active=[
 {id:'active-a',data:()=>({uid:'active-a',status:'requested',attempts:0,updatedAt:{toMillis:()=>100}})},
 {id:'active-b',data:()=>({uid:'active-b',status:'verifying',attempts:1,updatedAt:{toMillis:()=>101}})},
];
const retryable=[{id:'retry',data:()=>({uid:'retry',status:'failed',retryable:true,attempts:2,updatedAt:{toMillis:()=>99}})}];

function query(filters:Array<[string,string,unknown]> = []):any {
 return {
  where(field:string,op:string,value:unknown){return query([...filters,[field,op,value]]);},
  limit(count:number){return {async get(){
   const status=filters.find(x=>x[0]==='status');
   const retry=filters.find(x=>x[0]==='retryable');
   let docs:any[]=[];
   if(status?.[1]==='in') docs=active;
   else if(status?.[2]==='failed'&&retry?.[2]===true) docs=retryable;
   else docs=poison;
   return {docs:docs.slice(0,count),empty:docs.length===0};
  }};}
 };
}
vi.mock('../server/accountDeletion/firebaseAdmin',()=>({adminDb:()=>({collection:()=>query()}),adminAuth:()=>({})}));
import { listRecoverableDeletionJobs } from '../server/accountDeletion/jobStore';

describe('account deletion recovery fairness',()=>{
 it('cannot be starved by more than 25 non-retryable poison jobs',async()=>{
  const jobs=await listRecoverableDeletionJobs(25);
  expect(jobs.map(j=>j.uid)).toEqual(['retry','active-a','active-b']);
  expect(jobs.some(j=>j.uid.startsWith('poison-'))).toBe(false);
 });
});
