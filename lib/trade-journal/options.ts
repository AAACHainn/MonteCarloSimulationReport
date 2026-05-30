import { prisma } from "@/lib/db";

export async function loadJournalTradeOptions(
  instrumentOptionId: string,
  strategyOptionId: string,
  allowedInactiveOptionIds: string[] = [],
) {
  const options = await prisma.tradeOption.findMany({
    where: {
      id: { in: [instrumentOptionId, strategyOptionId] },
      OR: [{ active: true }, { id: { in: allowedInactiveOptionIds } }],
    },
  });
  const instrument = options.find((option) => option.id === instrumentOptionId && option.type === "INSTRUMENT");
  const strategy = options.find((option) => option.id === strategyOptionId && option.type === "STRATEGY");

  if (!instrument || !strategy) {
    throw new Error("请选择有效的品种和交易策略。");
  }
  return { instrument, strategy };
}
