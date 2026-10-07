CREATE TABLE "ReplayReviewTemplate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "ReplayReviewTemplate_normalizedName_key" ON "ReplayReviewTemplate"("normalizedName");
CREATE INDEX "ReplayReviewTemplate_name_idx" ON "ReplayReviewTemplate"("name");
