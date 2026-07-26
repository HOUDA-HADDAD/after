-- Aftergame — group-written themes, and reactions on answers.
--
-- Two additions, both from Phase 10:
--
--   1. A theme may belong to a group (D19). The seeded defaults keep `group_id NULL` and stay
--      available everywhere; a group's own themes are visible and playable only there.
--   2. Reactions on answers (D20). The row records who reacted, because a player must be able to
--      take their own back and must not be able to remove anyone else's — but no projection ever
--      carries that identity outward.
--
-- As in the initial migration, the partial unique index and the CHECK constraints are
-- hand-written because Prisma's schema language cannot express them, and are asserted by
-- tests/integration/schema-constraints.test.ts so a later generated migration cannot drop them
-- unnoticed.

-- =============================================================================================
-- 1. Themes may belong to a group
-- =============================================================================================

ALTER TABLE "themes" ADD COLUMN "group_id" UUID;

ALTER TABLE "themes" ADD CONSTRAINT "themes_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "themes_group_id_idx" ON "themes"("group_id");

-- The old constraint made every slug unique across the whole installation, which would have let
-- one group's "confessions" prevent every other group from having one.
DROP INDEX "themes_slug_key";

CREATE UNIQUE INDEX "themes_group_id_slug_key" ON "themes"("group_id", "slug");

-- NULLs are distinct in a unique index, so the constraint above does not constrain the seeded
-- defaults at all. This partial index is what keeps *their* slugs unique — and it is why
-- `themes_group_id_slug_key` alone is not enough.
CREATE UNIQUE INDEX "themes_system_slug_key" ON "themes"("slug") WHERE "group_id" IS NULL;

-- A group theme must be usable: no empty names, and the prompts a player reads cannot be blank.
-- Matches the `body ~ '[^[:space:]]'` form used elsewhere, which rejects tabs and newlines —
-- `btrim` would only strip spaces.
ALTER TABLE "themes" ADD CONSTRAINT "themes_name_not_blank"
  CHECK ("name" ~ '[^[:space:]]');
ALTER TABLE "themes" ADD CONSTRAINT "themes_write_prompt_not_blank"
  CHECK ("write_prompt" ~ '[^[:space:]]');
ALTER TABLE "themes" ADD CONSTRAINT "themes_answer_prompt_not_blank"
  CHECK ("answer_prompt" ~ '[^[:space:]]');

-- =============================================================================================
-- 2. Reactions
-- =============================================================================================

CREATE TABLE "reactions" (
  "id"         UUID NOT NULL DEFAULT uuid_generate_v7(),
  "session_id" UUID NOT NULL,
  "answer_id"  UUID NOT NULL,
  "player_id"  UUID NOT NULL,
  "emoji"      VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "reactions_pkey" PRIMARY KEY ("id")
);

-- One reaction of a given emoji per player per answer. This is what makes a double tap idempotent
-- rather than a second row, and what lets the count be trusted without a DISTINCT.
CREATE UNIQUE INDEX "reactions_answer_id_player_id_emoji_key"
  ON "reactions"("answer_id", "player_id", "emoji");

CREATE INDEX "reactions_session_id_idx" ON "reactions"("session_id");
CREATE INDEX "reactions_answer_id_idx" ON "reactions"("answer_id");

ALTER TABLE "reactions" ADD CONSTRAINT "reactions_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_answer_id_fkey"
  FOREIGN KEY ("answer_id") REFERENCES "answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The emoji is chosen from a fixed set the API validates. The constraint here is the floor: a
-- bug that let free text through would otherwise turn this into an unmoderated comment field.
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_emoji_not_blank"
  CHECK ("emoji" ~ '[^[:space:]]');
