import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { AiError } from "./errors";
import { resolveLimits } from "./limits";
import { defaultSettings } from "./prompts";
import { settingsSchema, type AiSettings, type Endpoint, type SkillKey } from "./schema";

function masterKey() {
  const text = process.env.AI_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(text, "base64");
  if (key.length !== 32 || key.toString("base64") !== text) throw new AiError("KEY_MISSING", copy.ai.keyMissing, 503);
  return key;
}
export function protectKey(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((v) => v.toString("base64")).join(".");
}
export function revealKey(value?: string) {
  if (!value) return "";
  try {
    const parts = value.split(".");
    if (parts.length !== 3 || parts.some((s) => Buffer.from(s, "base64").toString("base64") !== s)) throw new Error("Invalid ciphertext");
    const [iv, tag, body] = parts.map((s) => Buffer.from(s, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch { throw new AiError("KEY_MISSING", copy.ai.keyMissing, 503); }
}
export function endpointUrls(endpoint: Pick<Endpoint, "baseUrl" | "chatUrl" | "modelsUrl">) {
  function check(value: string) {
    let url: URL;
    try { url = new URL(value); } catch { throw new AiError("URL", copy.ai.badUrl); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
      throw new AiError("URL", copy.ai.badUrl);
    return url.toString();
  }
  const base = endpoint.baseUrl.replace(/\/+$/, "");
  return { chat: check(endpoint.chatUrl || base + "/chat/completions"), models: check(endpoint.modelsUrl || base + "/models") };
}
export async function ensureAiStorage() {
  try {
    await prisma.aiSetting.findUnique({ where: { id: "config" }, select: { id: true } });
    await prisma.aiRunStep.findFirst({ select: { id: true } });
    await prisma.aiToolCall.findFirst({ select: { id: true } });
    await prisma.aiChartVariant.findFirst({ select: { id: true } });
    await prisma.aiAsset.findFirst({ select: { contentHash: true } });
  }
  catch { throw new AiError("MIGRATION_REQUIRED", copy.ai.migration, 503); }
}
export async function readSettings() {
  await ensureAiStorage();
  const row = await prisma.aiSetting.findUnique({ where: { id: "config" } });
  if (!row) return { value: defaultSettings(), version: 0 };
  const raw = JSON.parse(row.value);
  const defaults = defaultSettings();
  return { value: settingsSchema.parse({ ...defaults, ...raw, skills: { ...defaults.skills, ...raw.skills } }), version: row.version };
}
export function publicSettings(value: AiSettings) {
  return { ...value, endpoints: value.endpoints.map((e) => {
    const safe: Partial<Endpoint> & { hasApiKey: boolean } = { ...e, hasApiKey: Boolean(e.encryptedKey) };
    delete safe.encryptedKey; delete safe.apiKey; delete safe.clearApiKey;
    return safe as Endpoint & { hasApiKey: boolean };
  }) };
}
export async function saveSettings(input: unknown, expectedVersion: number) {
  const next = settingsSchema.parse(input), old = await readSettings();
  // Older settings pages omit personalization when saving the rest of the form.
  if ((input as Partial<AiSettings>).personalization === undefined) next.personalization = old.value.personalization;
  next.limits = resolveLimits(next.limits);
  if (old.version !== expectedVersion) throw new AiError("CONFIG_CONFLICT", copy.ai.conflict, 409);
  if (new Set(next.endpoints.map((e) => e.id)).size !== next.endpoints.length) throw new AiError("INVALID", copy.ai.invalid);
  if (next.activeEndpointId && !next.endpoints.some((e) => e.id === next.activeEndpointId)) throw new AiError("INVALID", copy.ai.invalid);
  for (const endpoint of next.endpoints) {
    endpointUrls(endpoint);
    const previous = old.value.endpoints.find((e) => e.id === endpoint.id);
    endpoint.encryptedKey = endpoint.clearApiKey ? undefined : endpoint.apiKey?.trim() ? protectKey(endpoint.apiKey.trim()) : previous?.encryptedKey;
    // Clients cannot forge capabilities or inject ciphertext.
    endpoint.capabilities = previous && previous.baseUrl === endpoint.baseUrl && previous.chatUrl === endpoint.chatUrl && previous.tokenParameter === endpoint.tokenParameter
      && !endpoint.apiKey?.trim() && !endpoint.clearApiKey ? previous.capabilities : {};
    delete endpoint.apiKey; delete endpoint.clearApiKey;
  }
  await sqliteWriteTransaction(prisma, async (tx) => {
    if (expectedVersion === 0) {
      const exists = await tx.aiSetting.findUnique({ where: { id: "config" } });
      if (exists) throw new AiError("CONFIG_CONFLICT", copy.ai.conflict, 409);
      await tx.aiSetting.create({ data: { id: "config", value: JSON.stringify(next) } });
    } else {
      const result = await tx.aiSetting.updateMany({ where: { id: "config", version: expectedVersion }, data: { value: JSON.stringify(next), version: { increment: 1 } } });
      if (!result.count) throw new AiError("CONFIG_CONFLICT", copy.ai.conflict, 409);
    }
  });
  return { value: publicSettings(next), version: expectedVersion + 1 };
}
export function resolveEndpoint(settings: AiSettings) {
  const endpoint = settings.endpoints.find((e) => e.id === settings.activeEndpointId);
  if (!endpoint) throw new AiError("UNCONFIGURED", copy.ai.unconfigured);
  const model = endpoint.defaultModel;
  if (!model) throw new AiError("MODEL_REQUIRED", copy.ai.modelRequired);
  return { endpoint, model };
}
export function resolveModel(settings: AiSettings, task: SkillKey) {
  const skill = settings.skills[task];
  if (!skill.enabled) throw new AiError("DISABLED", copy.ai.disabled);
  return { ...resolveEndpoint(settings), prompt: skill.prompt };
}
