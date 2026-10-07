export const MAX_REVIEW_TEMPLATE_NAME_LENGTH = 50;
export const MAX_REVIEW_LENGTH = 300;

export type ReviewTemplate = { id: string; name: string; content: string };

export function reviewLength(value: string) {
  return Array.from(value).length;
}

export function limitReview(value: string) {
  return Array.from(value).slice(0, MAX_REVIEW_LENGTH).join("");
}

export function normalizeReviewTemplateName(value: string) {
  return value.normalize("NFKC").trim();
}

export function normalizeReviewTemplateKey(value: string) {
  return normalizeReviewTemplateName(value).toLocaleLowerCase("zh-CN");
}
