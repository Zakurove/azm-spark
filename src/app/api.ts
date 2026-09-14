import { Intake,Plan } from '../medical/plan';
export type Account={id:string;name:string;email:string;role:'member'};
export type AccountState={user:Account;intake:Intake|null;plan:Plan|null};
export async function api<T>(url:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T>{
 const response=await fetch(`/api${url}`,{method,credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json','X-Azm-Request':'1'},body:body===undefined?undefined:JSON.stringify(body)});
 const result=await response.json();if(!response.ok)throw new Error(result.error??'SERVER');return result as T;
}
