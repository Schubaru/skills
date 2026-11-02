import type { Metadata } from "next";
import Watch from "./Watch";

export const metadata: Metadata = {
  title: "N00B Inc · view only",
  robots: { index: false, follow: false },
};

export default async function WatchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Watch token={token} />;
}
