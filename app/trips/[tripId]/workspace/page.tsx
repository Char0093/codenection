import { redirect } from "next/navigation";

// The selected-trip workspace is now a section of the shared shell (Slice 5). Keep this
// legacy path working by redirecting compatible links into the shell's Plan surface.
export const dynamic = "force-dynamic";

export default async function LegacyWorkspacePage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  redirect(`/trips/${tripId}/plan`);
}
