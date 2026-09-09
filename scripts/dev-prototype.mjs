// Runs `next dev` in prototype mode (fixtures only, no Supabase/Gemini) on any OS.
// `NEXT_PUBLIC_PROTOTYPE` is read from this parent process by Next at startup and inlined
// into the client bundle, so setting it here is equivalent to `NEXT_PUBLIC_PROTOTYPE=1`
// on a POSIX shell -- without needing that shell syntax on Windows.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

process.env.NEXT_PUBLIC_PROTOTYPE = "1";

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "dev", ...process.argv.slice(2)], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
