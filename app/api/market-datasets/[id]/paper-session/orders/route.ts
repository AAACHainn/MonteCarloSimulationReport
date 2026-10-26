import { accountBalance } from "@/lib/paper-trading/account-funds";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { isClosingOrder, parseChecklist, parseTrainingGate, type EntryDiscipline } from "@/lib/paper-trading/training-gate";
import { withReplaySessionRoute } from '@/lib/replay-sessions/scope';
import { accountWhere, progressWhere, assertReplayWritable, markReplayMutation, getReplayScope, storageId } from '@/lib/replay-sessions/scope';
import { logicalId } from '@/lib/replay-sessions/identity';
import { recordReplayCommand } from '@/lib/replay-sessions/service';
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { getPaperSessionSnapshot, serializePaperOrder } from "@/lib/paper-trading/serialize";
import { calculateRiskSizing, isValidBracket } from "@/lib/paper-trading/risk-sizing";
import { isPriceOnTick } from "@/lib/market-replay/price-ticks";
import { isValidDisplayInterval } from "@/lib/market-replay/types";
import { paperOrderSchema } from "@/lib/validations";
import { serializeSourceBar } from "@/lib/market-replay/dataset";
import { executeCurrentPriceClose } from "@/lib/paper-trading/current-price-close";
import { assertPropTradingAvailable, observePropOperation } from "@/lib/prop-practice/service";

type RouteContext = { params: Promise<{ id: string }> };

async function handlePOST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = paperOrderSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const result = await sqliteWriteTransaction(prisma, async (tx) => {
    await assertReplayWritable(tx);
    await assertPropTradingAvailable(tx);
    const session = await tx.paperTradingSession.findFirst({ where: accountWhere(id) });
    if (!session) return { status: 404, error: copy.paperTrading.sessionNotFound };
    if (session.version !== parsed.data.expectedVersion) return { status: 409, error: copy.paperTrading.conflict };
    const [progress, dataset] = await Promise.all([
      tx.replayProgress.findFirst({ where: progressWhere(id) }),
      tx.marketDataset.findUnique({ where: { id }, select: { barCount: true, priceTickSize: true, sourceIntervalSeconds: true } }),
    ]);
    if (!progress || !dataset || progress.currentSequence < 0) return { status: 400, error: copy.paperTrading.noCurrentBar };
    if (!parsed.data.executeAtCurrentClose && progress.currentSequence >= dataset.barCount - 1) return { status: 400, error: copy.paperTrading.noNextBar };
    if (parsed.data.executeAtCurrentClose && (session.lastProcessedSequence !== progress.currentSequence
      || !isClosingOrder(session.netQuantity, parsed.data.side, Math.min(parsed.data.quantity, Math.abs(session.netQuantity))))) {
      return { status: 400, error: copy.paperTrading.immediateCloseInvalid };
    }
    const prices = [parsed.data.price, parsed.data.stopLoss, parsed.data.takeProfit].filter((value): value is number => value !== null && value !== undefined);
    if (prices.some((price) => !isPriceOnTick(price, dataset.priceTickSize))) {
      return { status: 400, error: copy.paperTrading.priceNotOnTick };
    }
    const currentBar = await tx.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: id, sequence: progress.currentSequence } } });
    if (!currentBar) return { status: 400, error: copy.paperTrading.noCurrentBar };
    const reference = parsed.data.price ?? currentBar.close;
    if (reference == null || !isValidBracket(parsed.data.side, reference, parsed.data.stopLoss ?? null, parsed.data.takeProfit ?? null)) {
      return { status: 400, error: copy.paperTrading.invalidBracket };
    }
    let quantity = parsed.data.quantity;
    if (parsed.data.riskAmount != null) {
      if (parsed.data.type === "MARKET" || parsed.data.stopLoss == null) {
        return { status: 400, error: copy.paperTrading.invalidBracket };
      }
      const sizing = calculateRiskSizing({
        side: parsed.data.side,
        type: parsed.data.type,
        entryPrice: reference,
        stopLoss: parsed.data.stopLoss,
        takeProfit: parsed.data.takeProfit,
        riskAmount: parsed.data.riskAmount,
        commissionBps: session.commissionBps,
        slippageBps: session.slippageBps,
      });
      if (!sizing.ok) return { status: 400, error: copy.paperTrading.invalidBracket };
      quantity = sizing.value.quantity;
    }
    const reduceOnly = parsed.data.reduceOnly || isClosingOrder(session.netQuantity, parsed.data.side, quantity);
    let discipline: EntryDiscipline | null = null;
    if (getReplayScope()?.mode === "TRAINING" && !reduceOnly) {
      const owner = await tx.replaySession.findUniqueOrThrow({ where: { id: getReplayScope()!.id }, select: { trainingGate: true, userId: true, accountCategory: true } });
      if (owner.userId && owner.accountCategory === "STANDARD" && accountBalance(session) < 0.005) return { status: 409, error: copy.userWallet.noTradingCapital };
      const gate = parseTrainingGate(owner.trainingGate);
      if (gate.active) {
        const approval = parsed.data.gateApproval;
        if (!approval) return { status: 400, error: copy.trainingGate.required };
        if (gate.activeMode === "PLAN") {
          if (approval.mode !== "PLAN" || !dataset.sourceIntervalSeconds
            || !isValidDisplayInterval(dataset.sourceIntervalSeconds, approval.displayIntervalSeconds)) {
            return { status: 400, error: copy.trainingGate.planRequired };
          }
          discipline = { mode: "PLAN", context: approval.context, plan: approval.plan,
            displayIntervalSeconds: approval.displayIntervalSeconds, confirmedSequence: progress.currentSequence,
            confirmedAt: new Date().toISOString() };
        } else {
          if (approval.mode === "PLAN") return { status: 400, error: copy.trainingGate.required };
          const strategy = await tx.tradeOption.findFirst({ where: { id: approval.strategyId, type: "STRATEGY", active: true } });
          const checklist = parseChecklist(strategy?.checklist);
          if (!strategy || !checklist.length) return { status: 400, error: copy.trainingGate.invalidStrategy };
          if (strategy.checklistVersion !== approval.checklistVersion) return { status: 409, error: copy.trainingGate.checklistChanged };
          const checked = new Set(approval.checkedItemIds);
          if (checked.size !== checklist.length || approval.checkedItemIds.length !== checked.size || checklist.some((item) => !checked.has(item.id))) {
            return { status: 400, error: copy.trainingGate.required };
          }
          discipline = { mode: "CHECKLIST", strategyId: strategy.id, strategyName: strategy.name,
            checklistVersion: strategy.checklistVersion, checklist, confirmedAt: new Date().toISOString() };
        }
      }
    }
    let order = await tx.paperOrder.create({
      data: {
        sessionId: session.id,
        side: parsed.data.side,
        type: parsed.data.type,
        quantity,
        riskAmount: reduceOnly ? null : parsed.data.riskAmount,
        price: parsed.data.type === "MARKET" ? null : parsed.data.price,
        stopLoss: reduceOnly ? null : parsed.data.stopLoss,
        takeProfit: reduceOnly ? null : parsed.data.takeProfit,
        reduceOnly,
        discipline: discipline ? JSON.stringify(discipline) : null,
        createdSequence: progress.currentSequence,
        activeFromSequence: progress.currentSequence + (parsed.data.executeAtCurrentClose ? 0 : 1),
      },
    });
    if (getReplayScope()) order = await tx.paperOrder.update({ where: { id: order.id }, data: { id: storageId(order.id) } });
    const recordedOrder = serializePaperOrder(order);
    if (parsed.data.executeAtCurrentClose) {
      await executeCurrentPriceClose(tx, session, progress.generation, serializeSourceBar(currentBar), recordedOrder.id);
    } else {
      await tx.paperTradingSession.update({ where: { id: session.id }, data: { version: { increment: 1 } } });
    }
    await recordReplayCommand(tx, progress.currentSequence, "ORDER_CREATE", {
      order: recordedOrder,
      ...(parsed.data.executeAtCurrentClose ? { executeAtCurrentClose: true, generation: progress.generation } : {}),
    });
    await observePropOperation(tx, Boolean(parsed.data.executeAtCurrentClose));
    await markReplayMutation(tx);
    return { status: 201, error: null };
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ snapshot: await getPaperSessionSnapshot(id) }, { status: 201 });
}

async function handleDELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = z.object({
    expectedVersion: z.number().int().positive(),
    scope: z.enum(["ALL", "BRACKET"]).default("ALL"),
  }).safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: copy.paperTrading.conflict }, { status: 400 });
  const result = await sqliteWriteTransaction(prisma, async (tx) => {
    await assertReplayWritable(tx);
    await assertPropTradingAvailable(tx);
    const session = await tx.paperTradingSession.findFirst({ where: accountWhere(id) });
    if (!session) return { status: 404, error: copy.paperTrading.sessionNotFound } as const;
    if (session.version !== body.data.expectedVersion) {
      return { status: 409, error: copy.paperTrading.conflict } as const;
    }
    const where = {
        sessionId: session.id,
        status: "PENDING" as const,
        ...(body.data.scope === "BRACKET" ? { isProtective: true } : {}),
    };
    const targets = await tx.paperOrder.findMany({ where, select: { id: true } });
    const updated = await tx.paperOrder.updateMany({
      where,
      data: { status: "CANCELLED", cancelReason: "USER_CANCELLED" },
    });
    if (updated.count) {
      await tx.paperTradingSession.update({
        where: { id: session.id },
        data: { version: { increment: 1 } },
      });
      await recordReplayCommand(tx, session.lastProcessedSequence, "ORDER_CANCEL", { orderIds: targets.map((order) => logicalId(order.id)) });
      await observePropOperation(tx, false);
      await markReplayMutation(tx);
    }
    return { status: 200, error: null } as const;
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ snapshot: await getPaperSessionSnapshot(id) });
}

export const POST = withReplaySessionRoute(handlePOST, { write: true, annotation: false });

export const DELETE = withReplaySessionRoute(handleDELETE, { write: true, annotation: false });
