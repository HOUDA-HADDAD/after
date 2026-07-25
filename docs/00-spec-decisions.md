# 00 — Spec decisions & assumptions

The brief is detailed, but a handful of rules interact in ways that only become visible once
you try to satisfy all of them at once. This document records every ambiguity we found, the
ruling we made, and why. **Anything here is cheap to change now and expensive to change in
Phase 6 — please review this document first.**

> **Ratified by the product owner on 2026-07-25:** D1 (many-to-many distribution), D11 (transient
> game data), D8 (**changed to collective reveal** — unanimity required), and D9 (guess
> correctness gated behind the global reveal condition). Reveal votes stay private with no
> published tally. Implementation proceeds on these terms.

---

## D1. Punishment adds _received_ texts, not _authored_ texts

> "Number of texts = number of players." … "Additional texts only exist because of punishment.
> A punished player may **receive** multiple texts to answer."

**Ruling:** every participant authors exactly **one** text. Punishment increases how many texts
a player must **answer**. The progress counter ("8 / 8 texts") therefore always counts
_authored_ texts and always equals the participant count.

**Consequence — this is the important one:** the number of answer slots
`S = Σ demand(player)` can exceed the number of texts `N`. With 8 players and one player at
punishment level 2, `S = 7×1 + 3 = 10 > 8`. So **a text can be assigned to more than one
receiver**. Assignment is many-to-many, not a permutation.

This is not a workaround — it is the only arithmetic that satisfies the brief, and it is a
product _upside_: the timeline can show the same question answered by two different anonymous
players, which is one of the funniest things this genre produces. See
[03 — TextAssignment](03-database-schema.md#textassignment).

## D2. "Never two texts by the same author" reduces to "never the same text twice"

Since each author writes exactly one text, the author→text mapping is a bijection. The rule
"a player receiving multiple texts must never receive two texts created by the same author" is
therefore exactly equivalent to "no receiver gets the same text twice" — a uniqueness
constraint on `(text_id, receiver_id)`, enforced in the database, not only in code.

## D3. Demand must be clamped to the number of texts

A player at punishment level 2 owes 3 answers. In a 2-player game only 2 texts exist, and D2
forbids handing them the same text twice. **Ruling:** `demand = min(1 + punishmentLevel, N)`.
In a 2-player game a punished player answers 2 texts, not 3, and the UI states this plainly
("2 of a possible 3 — not enough players"). Without this clamp, distribution is infeasible and
the game hard-locks.

## D4. A player may receive their own text — but we avoid it when we can

The brief explicitly allows self-assignment. **Ruling:** it is allowed and never surfaced in
the UI (surfacing it would leak authorship), but the distribution algorithm treats it as a soft
penalty and eliminates it whenever a legal swap exists. In practice self-assignment only occurs
in very small games. It is never _forbidden_, because forbidding it can make distribution
infeasible at `N = 2`.

## D5. Punishment counter resets only for a game played _without_ punishment

> "After playing a normal game without punishment: reset punishment counter to zero."

**Ruling:** each participant carries a per-session flag `wasPunishedThisSession`. When a session
reaches `COMPLETED`, every participant with the flag **false** has their group punishment counter
reset to 0. Participants punished for that session keep their (already incremented) counter, so
consecutive punishments accumulate as intended. A player who never joins a session neither
accumulates nor resets.

Abandoned or cancelled sessions do **not** reset anything.

## D6. Punishment is applied in the lobby, and its effect is snapshotted at start

Punishing increments `consecutivePunishments` on the group membership immediately (so it is
visible in the group's punishment list even if the game never starts). The **answer load** is
computed once, at the moment distribution runs, and snapshotted onto the participant row. A host
cannot change a player's load mid-game.

## D7. Level 3 is a game ban, not a group ban

Three consecutive punishments sets membership status to `GAME_BLOCKED`. The player keeps full
read access to the group, its member list and its history, and can chat/see lobbies — they simply
cannot be added to a session roster. Only an owner or co-host can forgive, which resets the
counter to 0 and the status to `ACTIVE`.

## D8. Reveal is collective — unanimous, or nobody

> The brief describes a per-person rule ("users who voted YES can see revealed authors").
> **Superseded by product decision, 2026-07-25.**

**Ruling:** the reveal vote is a **group decision**. Every participant is asked privately, and
authors are revealed **to everyone only if every participant votes YES**. One NO keeps the
timeline anonymous for all — including for the people who voted YES.

**Why this is the better rule.** Under the per-person variant a YES voter learns the authorship
of a NO voter's text, so refusing to reveal did not actually protect you unless everyone else
also refused. Unanimity makes a single NO sufficient to protect the whole table, which is what
players intuitively expect when they are offered the choice.

Implementation consequences:

- **Entitlement becomes session-wide, not per-viewer.** `entitlement(session)` is one boolean.
  Timeline payloads are therefore identical for every participant and can be broadcast to the
  session room rather than projected per socket. Viewer-specific fields (your own draft, your own
  assignments, your own guess) stay per-socket. The projection function keeps its `viewer`
  parameter so the rule can be changed back without a refactor.
- **Abstention counts as NO.** Reveal requires an affirmative YES from every participant still on
  the roster. If a player never votes and the host closes voting, reveal does not happen. This is
  the privacy-safe default: silence never authorises disclosure.
- **Players who left before `REVEAL` are excluded from the denominator**, so one person walking
  away does not make reveal permanently unreachable for the rest.
- The reveal outcome is announced as a single fact — "the group chose to stay anonymous" — with no
  indication of how many refused.

**Inherent limitation, stated honestly:** the _outcome_ is unavoidably informative. If reveal
fails, everyone learns that at least one person refused. With 8 players that hides the refuser
among 7 others; **in a 2-player game it identifies them completely** — if you voted YES and reveal
fails, the other player voted NO. No implementation can prevent this; it follows from the rule
itself. The reveal screen therefore warns players in 2- and 3-player games before they vote, so
the choice is informed. This is the price of collective reveal, and it is worth stating in review.

## D8a. Reveal votes stay private and the tally is never published

Independent of D8, and unchanged: publishing "5 of 8 voted yes" leaks. The API exposes only
`decided / total` — how many people have _answered_ the prompt — and **never** the yes/no split:
not to members, not to co-hosts, not to the owner, not in any host view, not in logs, not in
analytics. The split is not computed anywhere in the codebase. Asserted by the anonymity
regression suite ([08](08-testing.md#anonymity-regression-suite)).

## D9. Author guesses are gated behind the same reveal wall

Anecdotes mode asks "who do you think wrote this?". Telling a player whether their guess was
_correct_ discloses authorship just as surely as naming the author.

**Ruling:** guess correctness, scores and the guessing leaderboard are disclosed **only when the
global reveal condition in D8 is met** — that is, only when every participant voted YES. If
reveal does not happen, every player sees their own submitted guesses with no verdict, and no
leaderboard is produced. Correctness is computed at read time inside the entitled projection and
never stored, so there is no field that could leak by accident.

## D10. "Reveal authors" reveals text authors _and_ answer authors

The brief says "authors" without qualifying. **Ruling:** the reveal covers who wrote each text
**and** who wrote each answer, under the single collective gate from D8. It is stored as a
session setting (`revealScope`, default `TEXTS_AND_ANSWERS`) so this can be narrowed without a
migration.

Comment attribution is unaffected — a comment posted anonymously stays anonymous forever, in
every phase, to everyone. That is a promise made at the moment of posting and we do not break it.

## D11. "Do not permanently store completed games" — defined precisely

**Ruling:** game data is written to PostgreSQL during play (we need durability against a crash
mid-game), and **hard-deleted** afterwards. The timeline remains readable for a configurable
grace window after the session completes — default **24 hours** — then a scheduled job deletes
the `game_sessions` row and PostgreSQL cascades the delete to every text, assignment, answer,
comment, guess and reveal vote.

What survives the purge, deliberately:

- users, groups, memberships, invitations;
- the group punishment counter, and a `punishment_events` audit row per punish/forgive action
  (who did it, to whom, when, resulting level) — otherwise "consecutive punishments" is not
  auditable and a host could be accused of anything.

The audit row's link to the session is `ON DELETE SET NULL`, so it survives the purge with the
session reference dropped. No game _content_ is retained anywhere, including logs. See
[03 — Retention & purge](03-database-schema.md#retention--purge).

## D12. One live session per group at a time

Not stated in the brief, but two concurrent sessions in one group make the punishment counter
ambiguous (which game resets it?) and the roster confusing. **Ruling:** a partial unique index
permits at most one session per group in a non-terminal state. Starting a new game while one is
live returns a clear error with a link to the live game.

## D13. Roster is locked at start; disconnection is not elimination

"Players cannot join after the beginning" is enforced on the roster. A player who closes their
laptop is still a participant and still owes their text/answers — the session simply waits, and
the host retains a force-advance control (see D14). Reconnecting resumes exactly where they left
off, drafts intact.

## D14. The host can always force the game forward

Without this, one absent player freezes a session forever. **Ruling:** in `WRITING` and
`ANSWERING`, the host (owner or co-host) sees a "skip and continue" control, enabled once at
least one submission is outstanding. Skipped players' missing texts are dropped from the pool
(the required count adjusts) and their unanswered assignments are marked `SKIPPED` and shown in
the timeline as "no answer". A session with fewer than 2 submitted texts cannot advance.

## D15. Themes are data, not `if` statements

The brief asks for exactly three themes but also lists "Themes" as a schema entity. **Ruling:**
a `themes` table, seeded with the three defaults, carrying _capability flags_ —
`supports_comments`, `supports_author_guess`, prompt copy, placeholder text, icon. Comments and
guessing are enabled for Anecdotes because its row says so, not because of a hardcoded branch.
Adding a fourth theme later becomes a seed row plus copy, with no engine change.

## D16. Ownership, co-hosts and the "host" concept

"Host" in the brief means _owner or co-host_ — they have identical powers, per the spec.
Additional rulings:

- The owner cannot leave the group without transferring ownership first.
- Ownership transfer targets an `ACTIVE` member; the previous owner becomes a co-host.
- A co-host cannot punish, remove, or demote the owner or another co-host — only the owner can
  act on co-hosts. (Otherwise two co-hosts can punish each other into oblivion.)
- Nobody can punish themselves.

## D17. Comments are anonymous or named, per comment

Each comment carries an `is_anonymous` flag chosen at post time. Anonymous comments are shown as
"Anonymous" with no stable pseudonym, meaning two anonymous comments by the same person are
uncorrelatable. That is the strongest privacy stance and it is the default.

## D18. Answers are text only

The brief specifies text answers up to 1000 characters, with browser spellcheck and browser
dictation, and no paid AI. Dictation uses the **Web Speech API**, which is free and built into
Chrome, Edge and Safari, and absent in Firefox. **Ruling:** progressive enhancement — the
microphone button is feature-detected and simply does not render where unsupported. Typing is
always available. Same limit (1000 chars) applies to texts and answers; comments are capped at 500.

---

## Open questions for the product owner

These do not block Phase 0–4. Answers are needed before Phase 7.

1. ~~**D8 trade-off** — per-person vs collective reveal.~~ **Decided 2026-07-25: collective
   reveal, unanimity required.** See D8.
2. **Reveal deadline** — with abstention counting as NO, a single idle player blocks reveal until
   the host closes voting. Should voting also close automatically after a timer (say 3 minutes),
   or only by host action? We assume host action, with the abandon TTL as the backstop.
3. **Grace window** — is 24 hours the right lifetime for a finished timeline, or should it be
   "until the host closes it" / "1 hour"?
4. **Text pool on skip (D14)** — should a skipped player's _slot_ be filled by a house prompt
   from the theme, so the count stays whole, or simply dropped? We assume dropped.
5. **Group size cap** — we assume a soft cap of 50 members and 30 participants per session for
   sane UI and distribution cost. Confirm.
6. **Account recovery** — the brief specifies email + password with no mention of password reset.
   A reset flow needs outbound email (free tiers exist, e.g. Resend/Brevo, but it is a
   dependency). Phase 9 stretch; until then, lost password = lost account.
