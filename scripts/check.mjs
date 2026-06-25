import fs from "node:fs/promises";

const required = [
  "package.json",
  ".yarnrc.yml",
  ".env.example",
  ".env.production.example",
  ".gitignore",
  "src/server.js",
  "src/config/env.js",
  "src/http/routes/api.routes.js",
  "src/security/rate-guard.js",
  "src/storage/json-store.js",
  "src/sessions/session-state.js",
  "src/sessions/session-store.js",
  "src/sessions/session-public.js",
  "src/sessions/session-events.js",
  "src/sessions/baileys-manager.js",
  "src/sessions/cleanup.js",
  "src/utils/ids.js",
  "src/utils/time.js",
  "src/utils/phone.js",
  "src/utils/zip.js",
  "src/utils/sleep.js",
  "public/index.html",
  "public/assets/css/app.css",
  "public/assets/js/app.js",
  "vercel.json",
  "README.md"
];

let ok = true;

for (const file of required) {
  try {
    await fs.access(file);
    console.log(`OK ${file}`);
  } catch {
    ok = false;
    console.log(`MISS ${file}`);
  }
}

if (!ok) {
  process.exitCode = 1;
}
