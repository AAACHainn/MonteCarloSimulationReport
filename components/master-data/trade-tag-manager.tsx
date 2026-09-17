import { Tags } from "lucide-react";
import { NamedMasterDataManager } from "@/components/master-data/named-master-data-manager";
import { copy } from "@/lib/i18n";
import { MAX_TAG_NAME_LENGTH } from "@/lib/trade-journal/tags";

export type ManagedTradeTag = {
  id: string;
  name: string;
  _count: { trades: number };
};

export function TradeTagManager({ tags }: { tags: ManagedTradeTag[] }) {
  return (
    <NamedMasterDataManager
      items={tags.map((tag) => ({ id: tag.id, name: tag.name, usageCount: tag._count.trades }))}
      endpoint="/api/trade-tags"
      inputId="new-trade-tag"
      maxNameLength={MAX_TAG_NAME_LENGTH}
      text={copy.masterData.tags}
      icon={<Tags className="h-5 w-5 text-blue-700" aria-hidden="true" />}
    />
  );
}
