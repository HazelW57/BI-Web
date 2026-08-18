import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getSession,isAdmin } from "../../../auth";
import { configureBbyCredential } from "../../../../lib/bby";

export async function POST(request:Request){
  const session=await getSession();
  if(!session||!isAdmin(session))return NextResponse.json({error:"Forbidden"},{status:403});
  try{
    const body=await request.json() as {store?:string;apiKey?:string};
    return NextResponse.json(await configureBbyCredential(env,body.store==="JS"?"JS":"SAP",body.apiKey||""));
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Credential configuration failed"},{status:500});}
}
