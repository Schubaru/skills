import { requireSession } from "@/auth";
import SettingsClient from "@/components/SettingsClient";
import "../dashboard.css";

export default async function SettingsPage() {
  const session = await requireSession();
  const user = session?.user as { name?: string | null; login?: string; image?: string | null } | undefined;
  return <SettingsClient user={{ name: user?.name ?? null, login: user?.login ?? "", image: user?.image ?? null }} />;
}
