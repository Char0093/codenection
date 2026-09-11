import { EnteringView } from "@/features/marketing/entering-view";

// The branded transition between the public landing page and /login. See EnteringView --
// no auth happens here, it just paces the hand-off with the workspace's own visual language.
export default function EnteringPage() {
  return <EnteringView />;
}
