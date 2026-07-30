import { isAdmin, listVisibleUsers, requireSession } from "../auth";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";
export default async function PortalPage(){const session=await requireSession();const admin=isAdmin(session);return <Dashboard email={session.email} admin={admin} initialAllowed={admin?await listVisibleUsers():[]}/>}
