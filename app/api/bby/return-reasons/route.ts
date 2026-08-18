import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getSession,isAdmin } from "../../../auth";
import { syncBbyReturnReasons } from "../../../../lib/bby";

export async function POST(request:Request){
  const session=await getSession();
  if(!session||!isAdmin(session))return NextResponse.json({error:"Forbidden"},{status:403});
  try{
    const body=await request.json() as {store?:string;from?:string;to?:string};
    const store=body.store==="JS"?"JS":"SAP";
    const from=body.from||"2026-05-01",to=body.to||new Date().toISOString().slice(0,10);
    return NextResponse.json({store,from,to,...await syncBbyReturnReasons(env,store,from,to)});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Best Buy return reason sync failed"},{status:502});
  }
}
