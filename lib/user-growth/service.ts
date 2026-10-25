import { z } from "zod";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { ReplaySessionError, replayErrorResponse } from "@/lib/replay-sessions/scope";
import { growthRealm } from "./rules";
import { realmLabel } from "./presentation";
import { assertUserExists } from "./ownership";
import type { ProfileSession, UserIdentity } from "./types";

export const profileInput = z.object({ nickname: z.string().trim().refine(value => Array.from(value).length >= 1 && Array.from(value).length <= 24) }).strict();
export const assignmentInput = z.object({ sessionIds: z.array(z.string().min(1).max(128)).min(1).max(200).refine(ids => new Set(ids).size === ids.length) }).strict();
export function userIdentity(user: { id: string; nickname: string; growth?: { totalXp: number; realm: string } | null }): UserIdentity {
  const current = growthRealm(user.growth?.totalXp ?? 0, user.growth?.realm === "FOUNDATION");
  return { id: user.id, nickname: user.nickname, avatar: { preset: 0, zoom: 1, x: 50, y: 50 }, realmLabel: realmLabel(current.realm, current.layer) };
}
export async function saveProfile(input: z.infer<typeof profileInput>, id?: string) {
  return sqliteWriteTransaction(prisma, async tx => {
    if (id) await assertUserExists(tx, id);
    const row = id ? await tx.userProfile.update({ where: { id }, data: input, include: { growth: true } }) : await tx.userProfile.create({ data: { ...input, growth: { create: {} } }, include: { growth: true } });
    return userIdentity(row);
  });
}
export class AssignmentConflict extends Error { constructor(readonly ids: string[], readonly labels = ids) { super("ASSIGNMENT_CONFLICT"); } }
export async function assignHistory(userId: string, ids: string[]) {
  return sqliteWriteTransaction(prisma, async tx => {
    await assertUserExists(tx, userId);
    const rows = await tx.replaySession.findMany({ where: { id: { in: ids } }, select: { id: true, userId: true, name: true } });
    const available = new Set(rows.filter(row => row.userId === null).map(row => row.id));
    const conflicts = ids.filter(id => !available.has(id));
    const labels = (conflicting: string[]) => conflicting.map(id => rows.find(row => row.id === id)?.name ?? copy.userGrowth.deleted);
    if (conflicts.length) throw new AssignmentConflict(conflicts, labels(conflicts));
    const result = await tx.replaySession.updateMany({ where: { id: { in: ids }, userId: null }, data: { userId, ownershipSource: "HISTORICAL", growthEligible: false, assignedAt: new Date(), version: { increment: 1 } } });
    if (result.count !== ids.length) throw new AssignmentConflict(ids, labels(ids));
    return { assigned: result.count };
  });
}
export async function sessionPage(params: URLSearchParams, fixedUserId?: string) {
  const page = Math.min(1_000_000, Math.max(1, Number.parseInt(params.get("page") ?? "1") || 1));
  const search = (params.get("search") ?? "").trim().slice(0, 100);
  const mode = params.get("mode");
  const where: Prisma.ReplaySessionWhereInput = {
    ...(fixedUserId ? { userId: fixedUserId } : params.get("unassigned") === "1" ? { userId: null } : params.get("userId") ? { userId: params.get("userId")! } : {}),
    ...(search ? { name: { contains: search } } : {}), ...(mode === "training" ? { mode: "TRAINING" } : mode === "replay" ? { mode: "LIVE_REPLAY" } : {}),
  };
  return prisma.$transaction(async tx => {
    const total = await tx.replaySession.count({ where });
    const activePage = Math.min(page, Math.max(1, Math.ceil(total / 20)));
    const rows = await tx.replaySession.findMany({ where, skip: (activePage - 1) * 20, take: 20, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: {
      dataset: { select: { name: true, symbol: true } }, activeProjection: { select: { _count: { select: { entries: true } } } },
      propAccount: { select: { rounds: { select: { projection: { select: { _count: { select: { entries: true } } } } } } } },
    } });
    const items: ProfileSession[] = rows.map(row => ({ id: row.id, datasetId: row.datasetId, name: row.name, market: `${row.dataset.name} · ${row.dataset.symbol}`, mode: row.mode === "TRAINING" ? "training" : "replay", account: row.accountCategory === "PROP_PRACTICE" ? "prop" : "default", trades: row.propAccount ? row.propAccount.rounds.reduce((n, round) => n + round.projection._count.entries, 0) : row.activeProjection?._count.entries ?? 0,
      created: row.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }), eligibility: row.ownershipSource === "HISTORICAL" ? "historical" : row.growthEligible ? "growth" : "replay" }));
    return { items, page: activePage, pageSize: 20, total };
  });
}
export function userErrorResponse(error: unknown) {
  if (error instanceof AssignmentConflict) return NextResponse.json({ error: copy.userGrowth.historyConflict(error.labels.join("、")), conflictIds: error.ids }, { status: 409 });
  if (error instanceof SyntaxError || error instanceof z.ZodError) return NextResponse.json({ error: copy.userGrowth.invalidRequest }, { status: 400 });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: copy.userGrowth.nicknameTaken }, { status: 409 });
  return replayErrorResponse(error);
}
export async function requireProfile(id: string) {
  const user = await prisma.userProfile.findUnique({ where: { id }, include: { growth: true } });
  if (!user) throw new ReplaySessionError("USER_NOT_FOUND", 404, copy.userGrowth.userMissing);
  return userIdentity(user);
}
