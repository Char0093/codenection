import { redirect } from "next/navigation";

// Superseded by /settings, which folds this same edit-your-Travel-DNA form into the
// account-level Settings page (alongside Log out). Kept as a redirect so any old link/bookmark
// still lands somewhere real.
export default function PreferencesPage() {
  redirect("/settings");
}
