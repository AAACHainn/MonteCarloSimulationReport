export const MAX_TAG_NAME_LENGTH = 50;
export const MAX_TAGS_PER_TRADE = 20;

export type TradeTagValue = {
  id: string;
  name: string;
};

export function normalizeTagName(value: string) {
  return value.normalize("NFKC").trim();
}

export function normalizeTagKey(value: string) {
  return normalizeTagName(value).toLocaleLowerCase("zh-CN");
}

export function deduplicateTagNames(values: string[]) {
  const namesByKey = new Map<string, string>();

  for (const value of values) {
    const name = normalizeTagName(value);
    const key = normalizeTagKey(name);
    if (name && !namesByKey.has(key)) namesByKey.set(key, name);
  }

  return Array.from(namesByKey.values());
}

export function matchesAnyTag(tags: TradeTagValue[], selectedTagIds: string[]) {
  if (selectedTagIds.length === 0) return true;
  const selectedIds = new Set(selectedTagIds);
  return tags.some((tag) => selectedIds.has(tag.id));
}
