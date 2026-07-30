import { NextResponse } from "next/server";
import { addUser, getSession, isAdmin, listVisibleUsers, removeUser } from "../../auth";

async function admin() { const session=await getSession(); return session&&isAdmin(session); }
export async function GET(){if(!(await admin()))return NextResponse.json({error:"Forbidden"},{status:403});return NextResponse.json({items:await listVisibleUsers()})}
export async function POST(request:Request){if(!(await admin()))return NextResponse.json({error:"Forbidden"},{status:403});const {email,password}=await request.json() as {email?:string;password?:string};try{if(!email||!password)throw new Error("邮箱和临时密码均为必填");await addUser(email,password);return NextResponse.json({items:await listVisibleUsers()})}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"无法添加"},{status:400})}}
export async function DELETE(request:Request){if(!(await admin()))return NextResponse.json({error:"Forbidden"},{status:403});const {email}=await request.json() as {email?:string};try{if(!email)throw new Error("Email required");await removeUser(email);return NextResponse.json({items:await listVisibleUsers()})}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"无法删除"},{status:400})}}
