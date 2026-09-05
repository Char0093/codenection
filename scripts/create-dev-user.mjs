#!/usr/bin/env node
// Dev-only helper: creates (or updates) a confirmed Supabase auth user with a password, so
// local development is not blocked by magic-link email rate limits. Never run against a
// production project. Requires the service-role key (Project Settings -> API), passed only
// via environment variable -- it is never read from .env.local and never printed.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-dev-user.mjs <email> <password>

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const [email, password] = process.argv.slice(2);

if (!url) {
  console.error("NEXT_PUBLIC_SUPABASE_URL is not set. Run this via `npm run seed:dev-user -- ...` (it loads .env), or set it in the environment yourself.");
  process.exit(1);
}
if (!serviceRoleKey) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is not set. Get it from Supabase -> Project Settings -> API -> service_role, then set it for this command only -- never put it in .env or .env.local.");
  process.exit(1);
}
if (!email || !password) {
  console.error("Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-dev-user.mjs <email> <password>");
  process.exit(1);
}
if (password.length < 6) {
  console.error("Password must be at least 6 characters (Supabase Auth minimum).");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: created, error: createError } = await admin.auth.admin.createUser({
  email, password, email_confirm: true,
});

if (!createError) {
  console.log(`Created dev user ${created.user.email} (${created.user.id}). Sign in at /login with the dev-only password form.`);
  process.exit(0);
}

// Already exists: update the password instead of failing.
if (createError.code === "email_exists" || createError.status === 422) {
  const { data: list, error: listError } = await admin.auth.admin.listUsers();
  if (listError) { console.error(`Failed to look up existing user: ${listError.message}`); process.exit(1); }
  const existing = list.users.find((user) => user.email === email);
  if (!existing) { console.error(`Supabase reported ${email} as existing but it could not be found.`); process.exit(1); }
  const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
  if (updateError) { console.error(`Failed to update existing user: ${updateError.message}`); process.exit(1); }
  console.log(`Updated password for existing dev user ${updated.user.email} (${updated.user.id}).`);
  process.exit(0);
}

console.error(`Failed to create user: ${createError.message}`);
process.exit(1);
