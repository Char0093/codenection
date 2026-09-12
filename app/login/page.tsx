import fs from "node:fs";
import path from "node:path";
import { LoginForm, PrototypeEntry } from "@/components/login-form";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isPrototype } from "@/lib/prototype/config";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const SLIDESHOW_DIR = "auth-slideshow";
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function getSlideshowImages(): string[] {
  const dir = path.join(process.cwd(), "public", SLIDESHOW_DIR);
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .sort()
      .map((name) => `/${SLIDESHOW_DIR}/${name}`);
  } catch {
    return [];
  }
}

export default async function LoginPage() {
  const slideshowImages = getSlideshowImages();

  if (isPrototype()) return <PrototypeEntry slideshowImages={slideshowImages} />;

  const configured = isSupabaseConfigured();
  if (configured) {
    const { data: { user } } = await (await createClient()).auth.getUser();
    if (user) redirect("/");
  }
  return <LoginForm configured={configured} slideshowImages={slideshowImages} />;
}
