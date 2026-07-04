/*
  Warnings:

  - You are about to drop the column `searchVector` on the `Issue` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Issue" DROP COLUMN "searchVector";

-- Functional GIN index for full-text search (ADR-0006). No stored/generated
-- column: to_tsvector is computed on the fly at index-build/query time.
-- The 'english' literal (not a column/param) makes the expression IMMUTABLE,
-- which is required for it to be index-eligible.
CREATE INDEX "Issue_fts_idx" ON "Issue"
  USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'')));
