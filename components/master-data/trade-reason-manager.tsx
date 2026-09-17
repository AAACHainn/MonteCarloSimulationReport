import { ListChecks } from "lucide-react";
import { NamedMasterDataManager } from "@/components/master-data/named-master-data-manager";
import { copy } from "@/lib/i18n";
import { MAX_TRADE_REASON_NAME_LENGTH } from "@/lib/paper-trading/trade-reasons";

export type ManagedTradeReason = {
  id: string;
  name: string;
  _count: { replayJournalEntries: number };
};

export function TradeReasonManager({ reasons }: { reasons: ManagedTradeReason[] }) {
  return (
    <NamedMasterDataManager
      items={reasons.map((reason) => ({ id: reason.id, name: reason.name, usageCount: reason._count.replayJournalEntries }))}
      endpoint="/api/trade-reasons"
      inputId="new-trade-reason"
      maxNameLength={MAX_TRADE_REASON_NAME_LENGTH}
      text={copy.masterData.reasons}
      icon={<ListChecks className="h-5 w-5 text-blue-700" aria-hidden="true" />}
    />
  );
}
