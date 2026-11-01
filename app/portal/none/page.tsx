import { Card } from "@/components/ui";
import { getSession } from "@/lib/auth/session";

export default async function PortalNone() {
  const session = await getSession();
  return (
    <Card title="No customer account here" description={`${session?.email ?? "This sign-in"} has no portal access. Open the invitation your pest control company sent, or ask them to send one.`}>
      <p className="text-sm text-stone-600">If you work for a pest control company, your office pages are at the home page.</p>
    </Card>
  );
}
