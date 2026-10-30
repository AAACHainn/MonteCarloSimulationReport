import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Run once during local setup, never from a request or paid model call.
const original = existsSync(".env") ? readFileSync(".env", "utf8") : readFileSync(".env.example", "utf8");
const entry = original.match(/^AI_ENCRYPTION_KEY\s*=\s*["']?([^"'\r\n]*)["']?\s*$/m);
const current = process.env.AI_ENCRYPTION_KEY || entry?.[1]?.trim();
if (current) {
  const key = Buffer.from(current, "base64");
  if (key.length !== 32 || key.toString("base64") !== current) throw new Error("AI_ENCRYPTION_KEY is invalid; preserve the existing value and check deployment configuration.");
  console.log("AI encryption key is already configured; no changes.");
} else {
  const line = 'AI_ENCRYPTION_KEY="' + randomBytes(32).toString("base64") + '"';
  const updated = entry ? original.replace(entry[0], line + "\n") : original.trimEnd() + "\n\n" + line + "\n";
  writeFileSync(".env", updated, { mode: 0o600 });
  console.log("A stable AI encryption key has been saved to the local .env. Back it up and restart the service.");
}
