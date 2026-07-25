-- Aftergame — initial schema.
--
-- Structure of this file:
--   1. Extensions and the UUIDv7 generator  (hand-written — must exist before the tables)
--   2. Tables, enums, indexes, foreign keys (generated from prisma/schema.prisma)
--   3. Partial unique indexes and CHECK constraints (hand-written)
--
-- Sections 1 and 3 exist because Prisma's schema language cannot express extensions, functions,
-- filtered indexes or CHECK constraints. They are therefore invisible to `prisma migrate dev`,
-- which means a future generated migration could silently drop them — so every one of them is
-- asserted by tests/integration/schema-constraints.test.ts. If that suite goes red after a
-- migration, this is why.
--
-- See docs/03-database-schema.md.

-- =============================================================================================
-- 1. Extensions and identifiers
-- =============================================================================================

-- gen_random_bytes(), used by the UUIDv7 generator below.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Case-insensitive text, so `A@x.com` and `a@x.com` cannot become two accounts.
CREATE EXTENSION IF NOT EXISTS "citext";

-- Time-ordered UUIDs.
--
-- PostgreSQL 18 ships uuidv7() in core; we target 16, so we implement it here rather than take a
-- dependency on the pg_uuidv7 extension (which managed free tiers generally do not offer).
-- Time-ordered keys insert at the right-hand edge of the B-tree instead of scattering across it,
-- which keeps the hot tables (assignments, comments) from fragmenting — while still leaking no
-- sequential count the way an integer key would.
--
-- Layout per RFC 9562: 48 bits of Unix milliseconds, 4 bits version, 74 bits randomness.
CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  -- Milliseconds since the epoch, big-endian, truncated to the low 6 bytes.
  unix_ts_ms := substring(
    int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3
  );

  uuid_bytes := unix_ts_ms || gen_random_bytes(10);

  -- Version 7 in the high nibble of byte 6.
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);
  -- IETF variant (10xx) in the high bits of byte 8.
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);

  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$;

-- =============================================================================================
-- 2. Tables, enums, indexes and foreign keys (generated from prisma/schema.prisma)
-- =============================================================================================
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "group_role" AS ENUM ('OWNER', 'COHOST', 'MEMBER');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('ACTIVE', 'GAME_BLOCKED');

-- CreateEnum
CREATE TYPE "punishment_action" AS ENUM ('PUNISH', 'FORGIVE', 'AUTO_RESET');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('LOBBY', 'WRITING', 'ANSWERING', 'REVIEW', 'REVEAL', 'COMPLETED', 'CANCELLED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "reveal_scope" AS ENUM ('TEXTS', 'TEXTS_AND_ANSWERS');

-- CreateEnum
CREATE TYPE "content_status" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "assignment_status" AS ENUM ('PENDING', 'ANSWERED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "reveal_choice" AS ENUM ('YES', 'NO');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "username" CITEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "user_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" VARCHAR(400),
    "ip_hash" VARCHAR(64),

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "name" VARCHAR(60) NOT NULL,
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_memberships" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "group_role" NOT NULL DEFAULT 'MEMBER',
    "status" "membership_status" NOT NULL DEFAULT 'ACTIVE',
    "consecutive_punishments" SMALLINT NOT NULL DEFAULT 0,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "group_id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "created_by_id" UUID,
    "expires_at" TIMESTAMPTZ(3),
    "max_uses" INTEGER,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "punishment_events" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "group_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" "punishment_action" NOT NULL,
    "resulting_level" SMALLINT NOT NULL,
    "game_session_id" UUID,
    "reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "punishment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "themes" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "slug" VARCHAR(40) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "write_prompt" TEXT NOT NULL,
    "write_placeholder" TEXT NOT NULL,
    "answer_prompt" TEXT NOT NULL,
    "icon" VARCHAR(40) NOT NULL,
    "supports_comments" BOOLEAN NOT NULL DEFAULT false,
    "supports_author_guess" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_sessions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "group_id" UUID NOT NULL,
    "theme_id" UUID NOT NULL,
    "created_by_id" UUID,
    "status" "session_status" NOT NULL DEFAULT 'LOBBY',
    "required_text_count" INTEGER NOT NULL DEFAULT 0,
    "distribution_seed" BIGINT NOT NULL DEFAULT 0,
    "display_seed" BIGINT NOT NULL DEFAULT 0,
    "reveal_scope" "reveal_scope" NOT NULL DEFAULT 'TEXTS_AND_ANSWERS',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purge_after" TIMESTAMPTZ(3),

    CONSTRAINT "game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_players" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "punishment_level_at_start" SMALLINT NOT NULL DEFAULT 0,
    "was_punished_this_session" BOOLEAN NOT NULL DEFAULT false,
    "receive_quota" INTEGER NOT NULL DEFAULT 1,
    "text_submitted" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(3),

    CONSTRAINT "game_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_texts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "session_id" UUID NOT NULL,
    "author_player_id" UUID NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "status" "content_status" NOT NULL DEFAULT 'DRAFT',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMPTZ(3),

    CONSTRAINT "game_texts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_assignments" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "session_id" UUID NOT NULL,
    "text_id" UUID NOT NULL,
    "receiver_player_id" UUID NOT NULL,
    "status" "assignment_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "text_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "assignment_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "status" "content_status" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMPTZ(3),

    CONSTRAINT "answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "session_id" UUID NOT NULL,
    "answer_id" UUID NOT NULL,
    "author_player_id" UUID NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "is_anonymous" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "author_guesses" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "session_id" UUID NOT NULL,
    "text_id" UUID NOT NULL,
    "guesser_player_id" UUID NOT NULL,
    "guessed_player_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "author_guesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reveal_votes" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "session_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "choice" "reveal_choice" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reveal_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "groups_owner_id_idx" ON "groups"("owner_id");

-- CreateIndex
CREATE INDEX "group_memberships_user_id_idx" ON "group_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_memberships_group_id_user_id_key" ON "group_memberships"("group_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_code_key" ON "invitations"("code");

-- CreateIndex
CREATE INDEX "invitations_group_id_idx" ON "invitations"("group_id");

-- CreateIndex
CREATE INDEX "punishment_events_group_id_target_user_id_idx" ON "punishment_events"("group_id", "target_user_id");

-- CreateIndex
CREATE INDEX "punishment_events_group_id_created_at_idx" ON "punishment_events"("group_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "themes_slug_key" ON "themes"("slug");

-- CreateIndex
CREATE INDEX "game_sessions_group_id_idx" ON "game_sessions"("group_id");

-- CreateIndex
CREATE INDEX "game_sessions_purge_after_idx" ON "game_sessions"("purge_after");

-- CreateIndex
CREATE INDEX "game_sessions_last_activity_at_idx" ON "game_sessions"("last_activity_at");

-- CreateIndex
CREATE INDEX "game_players_session_id_idx" ON "game_players"("session_id");

-- CreateIndex
CREATE INDEX "game_players_user_id_idx" ON "game_players"("user_id");

-- CreateIndex
CREATE INDEX "game_players_membership_id_idx" ON "game_players"("membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_players_session_id_user_id_key" ON "game_players"("session_id", "user_id");

-- CreateIndex
CREATE INDEX "game_texts_session_id_idx" ON "game_texts"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_texts_session_id_author_player_id_key" ON "game_texts"("session_id", "author_player_id");

-- CreateIndex
CREATE INDEX "text_assignments_receiver_player_id_idx" ON "text_assignments"("receiver_player_id");

-- CreateIndex
CREATE INDEX "text_assignments_session_id_idx" ON "text_assignments"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "text_assignments_text_id_receiver_player_id_key" ON "text_assignments"("text_id", "receiver_player_id");

-- CreateIndex
CREATE UNIQUE INDEX "answers_assignment_id_key" ON "answers"("assignment_id");

-- CreateIndex
CREATE INDEX "answers_session_id_idx" ON "answers"("session_id");

-- CreateIndex
CREATE INDEX "comments_answer_id_created_at_idx" ON "comments"("answer_id", "created_at");

-- CreateIndex
CREATE INDEX "comments_session_id_idx" ON "comments"("session_id");

-- CreateIndex
CREATE INDEX "author_guesses_session_id_idx" ON "author_guesses"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "author_guesses_text_id_guesser_player_id_key" ON "author_guesses"("text_id", "guesser_player_id");

-- CreateIndex
CREATE UNIQUE INDEX "reveal_votes_player_id_key" ON "reveal_votes"("player_id");

-- CreateIndex
CREATE INDEX "reveal_votes_session_id_idx" ON "reveal_votes"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "reveal_votes_session_id_player_id_key" ON "reveal_votes"("session_id", "player_id");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "punishment_events" ADD CONSTRAINT "punishment_events_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "punishment_events" ADD CONSTRAINT "punishment_events_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "punishment_events" ADD CONSTRAINT "punishment_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "punishment_events" ADD CONSTRAINT "punishment_events_game_session_id_fkey" FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "themes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "group_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_texts" ADD CONSTRAINT "game_texts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_texts" ADD CONSTRAINT "game_texts_author_player_id_fkey" FOREIGN KEY ("author_player_id") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_assignments" ADD CONSTRAINT "text_assignments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_assignments" ADD CONSTRAINT "text_assignments_text_id_fkey" FOREIGN KEY ("text_id") REFERENCES "game_texts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_assignments" ADD CONSTRAINT "text_assignments_receiver_player_id_fkey" FOREIGN KEY ("receiver_player_id") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "text_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_player_id_fkey" FOREIGN KEY ("author_player_id") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "author_guesses" ADD CONSTRAINT "author_guesses_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "author_guesses" ADD CONSTRAINT "author_guesses_guesser_player_id_fkey" FOREIGN KEY ("guesser_player_id") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "author_guesses" ADD CONSTRAINT "author_guesses_guessed_player_id_fkey" FOREIGN KEY ("guessed_player_id") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reveal_votes" ADD CONSTRAINT "reveal_votes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reveal_votes" ADD CONSTRAINT "reveal_votes_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================================================
-- 3. Partial unique indexes and CHECK constraints
--
-- These encode rules the application must never be able to violate, even with a bug. Each one
-- is asserted by tests/integration/schema-constraints.test.ts.
-- =============================================================================================

-- Exactly one owner per group. A group with two owners, or none, is unrepresentable.
CREATE UNIQUE INDEX "group_memberships_one_owner_per_group"
  ON "group_memberships" ("group_id")
  WHERE "role" = 'OWNER';

-- At most one live session per group (docs/00-spec-decisions.md D12).
--
-- Two concurrent games in one group would make the punishment counter ambiguous — which game
-- resets it? A partial unique index settles it in the database, so even a race between two
-- hosts pressing Start cannot create a second live session.
CREATE UNIQUE INDEX "game_sessions_one_live_per_group"
  ON "game_sessions" ("group_id")
  WHERE "status" NOT IN ('COMPLETED', 'CANCELLED', 'ABANDONED');

-- Punishment escalation is 0 → 1 → 2 → 3 and nothing else (D6, D7).
ALTER TABLE "group_memberships"
  ADD CONSTRAINT "group_memberships_punishment_range"
  CHECK ("consecutive_punishments" >= 0 AND "consecutive_punishments" <= 3);

-- Level 3 and GAME_BLOCKED are the same fact stated twice; they may never disagree.
ALTER TABLE "group_memberships"
  ADD CONSTRAINT "group_memberships_blocked_iff_max_punishments"
  CHECK (("consecutive_punishments" = 3) = ("status" = 'GAME_BLOCKED'));

ALTER TABLE "punishment_events"
  ADD CONSTRAINT "punishment_events_level_range"
  CHECK ("resulting_level" >= 0 AND "resulting_level" <= 3);

-- A player in a game is at level 0–2; level 3 is blocked and never reaches a roster.
ALTER TABLE "game_players"
  ADD CONSTRAINT "game_players_punishment_level_range"
  CHECK ("punishment_level_at_start" >= 0 AND "punishment_level_at_start" <= 2);

-- Everyone answers at least one text.
ALTER TABLE "game_players"
  ADD CONSTRAINT "game_players_receive_quota_positive"
  CHECK ("receive_quota" >= 1);

-- "Empty texts are forbidden." The UI warns, the API validates, and this is the layer that
-- cannot be bypassed by a bug in either.
--
-- The condition reads "contains at least one non-whitespace character". Note that the obvious
-- `length(btrim(body)) > 0` is WRONG: btrim() with no character set strips spaces only, so a
-- body of tabs and newlines would pass it. The POSIX class covers every whitespace character
-- with no escaping to get wrong.
ALTER TABLE "game_texts"
  ADD CONSTRAINT "game_texts_body_not_blank"
  CHECK ("body" ~ '[^[:space:]]');

ALTER TABLE "answers"
  ADD CONSTRAINT "answers_body_not_blank"
  CHECK ("body" ~ '[^[:space:]]');

ALTER TABLE "comments"
  ADD CONSTRAINT "comments_body_not_blank"
  CHECK ("body" ~ '[^[:space:]]');

-- An invitation with zero or negative capacity is a bug, not a revoked invite.
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_max_uses_positive"
  CHECK ("max_uses" IS NULL OR "max_uses" > 0);

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_use_count_non_negative"
  CHECK ("use_count" >= 0);

-- A session cannot require a negative number of texts.
ALTER TABLE "game_sessions"
  ADD CONSTRAINT "game_sessions_required_text_count_non_negative"
  CHECK ("required_text_count" >= 0);
