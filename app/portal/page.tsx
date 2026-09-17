import { isAdmin, requireSession } from "../auth";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";
export default async function PortalPage() {
  const session = await requireSession();
  const admin = isAdmin(session);

  // The portal shell must remain available when D1 is temporarily unavailable
  // or has reached its daily quota. Access-management data can be loaded on
  // demand and must never make the entire dashboard fail with Worker 1101.
  return <Dashboard email={session.email} admin={admin} initialAllowed={[]} />;
}
