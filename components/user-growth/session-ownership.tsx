import { copy } from "@/lib/i18n";
import type { UserIdentity } from "@/lib/user-growth/types";

const t = copy.userGrowth;

export function SessionOwnership({ hasUsers, owner, eligibility }: { hasUsers: boolean; owner?: UserIdentity | null; eligibility?: string }) {
  const name = !hasUsers ? t.noCreatedUser : owner?.nickname ?? t.unowned;
  const hint = !hasUsers ? t.noCreatedUserHint : owner ? t.ownerHint(owner.nickname) : t.unownedHint;
  return <div className="space-y-2">
    <p className="break-words text-sm font-medium text-slate-700">{t.owner}：{name}</p>
    {hasUsers && owner && eligibility && <p className="text-sm text-slate-700">{eligibility}</p>}
    <p className="text-sm leading-6 text-slate-600">{hint}</p>
  </div>;
}
