import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getSession } from "../../../auth";
import { addBbyExcludedOrders,deleteBbyExcludedOrder,listBbyExcludedOrders } from "../../../../lib/bby";

const storeOf=(value:unknown)=>value==="JS"?"JS" as const:"SAP" as const;
export async function GET(request:Request){const session=await getSession();if(!session)return NextResponse.json({error:"Unauthorized"},{status:401});const store=storeOf(new URL(request.url).searchParams.get("store"));const result=await listBbyExcludedOrders(env.DB,store);return NextResponse.json({store,rows:result.results});}
export async function POST(request:Request){const session=await getSession();if(!session)return NextResponse.json({error:"Unauthorized"},{status:401});try{const body=await request.json() as {store?:string;orderIds?:string[];note?:string};return NextResponse.json(await addBbyExcludedOrders(env.DB,storeOf(body.store),body.orderIds||[],body.note||"",session.email));}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Submission failed"},{status:400});}}
export async function DELETE(request:Request){const session=await getSession();if(!session)return NextResponse.json({error:"Unauthorized"},{status:401});try{const body=await request.json() as {store?:string;orderId?:string};if(!body.orderId)throw new Error("Order ID is required");return NextResponse.json(await deleteBbyExcludedOrder(env.DB,storeOf(body.store),body.orderId));}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Delete failed"},{status:400});}}
