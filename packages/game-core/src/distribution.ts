import { seededRng, type Rng } from './rng.js';

/**
 * Random text distribution.
 *
 * Every player writes one text; everyone then answers texts written by others. A punished player
 * answers more of them, so the number of answer slots can exceed the number of texts — which is
 * why a text may be handed to several receivers, and why this is a degree-constrained bipartite
 * assignment rather than a shuffle (D1).
 *
 * The invariants, which the property tests assert on thousands of generated games:
 *
 *   I1  every player receives exactly their demand
 *   I2  no player receives the same text twice — equivalently, never two texts by one author (D2)
 *   I3  every text is assigned at least once, so nobody's text goes unanswered
 *   I4  usage is balanced: each text is used ⌊S/N⌋ or ⌈S/N⌉ times
 *   I5  a player receives their own text only when unavoidable (D4)
 *
 * **Why augmenting paths rather than the greedy the design sketched.** A descending-demand greedy
 * is enough to satisfy I1–I4 — that is the Gale–Ryser construction, and it never gets stuck. It
 * is *not* enough for I5, and a property test proved it: with four texts and demands 3,3,3,1 a
 * self-free assignment exists, but the greedy reaches an arrangement no single swap can repair.
 * Bounded swap-repair only pushes the counterexample further out. Treating self-assignment as a
 * forbidden edge and augmenting instead makes I5 exact rather than best-effort, at a cost that is
 * irrelevant for a party game's worth of players.
 */

export interface DistributableText {
  id: string;
  authorPlayerId: string;
}

export interface DistributionPlayer {
  id: string;
  /** How many texts this player must answer — already clamped by `demandFor` (D3). */
  demand: number;
}

export interface DistributionInput {
  texts: readonly DistributableText[];
  players: readonly DistributionPlayer[];
  seed: number | bigint;
}

export interface Assignment {
  textId: string;
  receiverPlayerId: string;
}

/** Thrown when the input cannot be satisfied. Always a caller bug — the clamp exists to prevent it. */
export class InfeasibleDistributionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InfeasibleDistributionError';
  }
}

/**
 * How many capacity layouts to try before allowing self-assignment.
 *
 * Which texts receive the spare uses is chosen at random, and an unlucky layout can make a
 * self-free arrangement impossible where another would allow it. Reshuffling is far cheaper than
 * reasoning about which layouts are safe.
 */
const CAPACITY_ATTEMPTS = 8;

function validate(input: DistributionInput): void {
  const textCount = input.texts.length;

  if (textCount === 0) {
    throw new InfeasibleDistributionError('Cannot distribute with no texts.');
  }

  for (const player of input.players) {
    if (!Number.isInteger(player.demand) || player.demand < 0) {
      throw new InfeasibleDistributionError(
        `Player ${player.id} has a demand of ${String(player.demand)}, which is not a whole number of texts.`,
      );
    }

    // The one condition that makes the problem solvable: nobody may be owed more texts than
    // exist, because I2 forbids handing them the same one twice. `demandFor` clamps to exactly
    // this bound, so reaching here means the caller skipped it.
    if (player.demand > textCount) {
      throw new InfeasibleDistributionError(
        `Player ${player.id} is owed ${String(player.demand)} texts but only ${String(textCount)} exist.`,
      );
    }
  }
}

/**
 * Spread the answer slots across the texts as evenly as possible.
 *
 * `S = Σ demand` slots over `N` texts gives every text ⌊S/N⌋ uses, with the remainder handed to
 * randomly chosen texts. Because every player's demand is at least one, `S ≥ N`, so every text
 * gets at least one use — that is I3, satisfied by construction. Total capacity is exactly `S`,
 * so a complete assignment uses every unit and I4 follows.
 */
function buildSlots(texts: readonly DistributableText[], totalSlots: number, rng: Rng): TextSlot[] {
  const base = Math.floor(totalSlots / texts.length);
  const remainder = totalSlots % texts.length;

  // Shuffled before the remainder is handed out, so the texts that get an extra use are chosen
  // by the seed rather than by whoever submitted first. The shuffle also fixes the traversal
  // order used during augmentation.
  return rng
    .shuffle(texts.map((text, originalIndex) => ({ text, originalIndex })))
    .map((entry, position) => ({
      text: entry.text,
      capacity: base + (position < remainder ? 1 : 0),
      holders: new Set<string>(),
      originalIndex: entry.originalIndex,
    }));
}

/**
 * One text, its remaining capacity, and who currently holds it.
 *
 * Slots are plain objects rather than lookups into a map so that capacity and holders are direct
 * property access. That is not micro-optimisation: a `map.get(...) ?? default` in the hot loop is
 * a branch for a state that cannot occur, and unreachable branches are exactly what makes a
 * coverage gate meaningless.
 */
interface TextSlot {
  text: DistributableText;
  capacity: number;
  holders: Set<string>;
  /** Position in the caller's text array, so output order does not depend on the shuffle. */
  originalIndex: number;
}

/**
 * Try to satisfy every demand, optionally treating "your own text" as a forbidden edge.
 *
 * Standard augmenting-path b-matching. Giving a player one more text either finds a text with
 * spare capacity, or finds a full text whose current holder can be moved somewhere else —
 * recursively. The visited set makes each text considered once per augmentation, so the search
 * terminates, and it succeeds whenever an assignment exists.
 */
function tryAssign(
  input: DistributionInput,
  slots: readonly TextSlot[],
  forbidSelf: boolean,
): boolean {
  // Every player is present from the outset, so the lookup below never misses.
  const holdings = new Map(input.players.map((player) => [player.id, new Set<string>()]));
  const heldBy = (playerId: string): Set<string> => holdings.get(playerId) as Set<string>;

  const allowed = (playerId: string, text: DistributableText): boolean =>
    !(forbidSelf && text.authorPlayerId === playerId);

  const link = (playerId: string, slot: TextSlot): void => {
    slot.holders.add(playerId);
    heldBy(playerId).add(slot.text.id);
  };

  const unlink = (playerId: string, slot: TextSlot): void => {
    slot.holders.delete(playerId);
    heldBy(playerId).delete(slot.text.id);
  };

  const augment = (playerId: string, visited: Set<string>): boolean => {
    for (const slot of slots) {
      if (visited.has(slot.text.id)) continue;
      if (!allowed(playerId, slot.text)) continue;
      if (heldBy(playerId).has(slot.text.id)) continue;

      visited.add(slot.text.id);

      if (slot.capacity > 0) {
        slot.capacity -= 1;
        link(playerId, slot);
        return true;
      }

      // Full. See whether one of its holders can be moved elsewhere to make room.
      // `playerId` cannot be among them — the check above skipped any slot they already hold.
      for (const holderId of [...slot.holders]) {
        unlink(holderId, slot);

        if (augment(holderId, visited)) {
          link(playerId, slot);
          return true;
        }

        link(holderId, slot);
      }
    }

    return false;
  };

  // Hardest first: a player owed many texts has the fewest ways to be satisfied.
  const receivers = [...input.players].sort((left, right) => right.demand - left.demand);

  for (const receiver of receivers) {
    for (let unit = 0; unit < receiver.demand; unit += 1) {
      if (!augment(receiver.id, new Set())) return false;
    }
  }

  return true;
}

export function distribute(input: DistributionInput): Assignment[] {
  validate(input);

  const rng = seededRng(input.seed);
  const totalSlots = input.players.reduce((sum, player) => sum + player.demand, 0);

  if (totalSlots === 0) return [];

  for (let attempt = 0; attempt < CAPACITY_ATTEMPTS; attempt += 1) {
    const slots = buildSlots(input.texts, totalSlots, rng);

    if (tryAssign(input, slots, true)) return toAssignments(slots);
  }

  // No self-free arrangement was found. Self-assignment is explicitly permitted (D4), and
  // dropping the constraint is always solvable because every demand is at most the text count.
  const slots = buildSlots(input.texts, totalSlots, rng);

  /* c8 ignore start -- Unreachable: with self-assignment permitted, every demand is at most the
     text count, which Gale–Ryser guarantees is solvable. Kept so that a future change to the
     capacity maths fails loudly instead of silently under-assigning someone. */
  if (!tryAssign(input, slots, false)) {
    throw new InfeasibleDistributionError(
      'Could not distribute texts. This is a bug in the distribution algorithm.',
    );
  }
  /* c8 ignore stop */

  return toAssignments(slots);
}

function toAssignments(slots: readonly TextSlot[]): Assignment[] {
  const assignments: Assignment[] = [];

  // Emit in the caller's text order, not the shuffled one, so the output is stable for a given
  // seed — which is what makes a distribution reproducible from the seed alone.
  for (const slot of [...slots].sort((left, right) => left.originalIndex - right.originalIndex)) {
    for (const receiverPlayerId of slot.holders) {
      assignments.push({ textId: slot.text.id, receiverPlayerId });
    }
  }

  return assignments;
}

/** How many times each text was handed out. Exposed for assertions and for the host's view. */
export function usageByText(assignments: readonly Assignment[]): Map<string, number> {
  const usage = new Map<string, number>();

  for (const assignment of assignments) {
    usage.set(assignment.textId, (usage.get(assignment.textId) ?? 0) + 1);
  }

  return usage;
}

/** Assignments where the receiver wrote the text. Allowed, but avoided wherever possible (D4). */
export function selfAssignments(
  texts: readonly DistributableText[],
  assignments: readonly Assignment[],
): Assignment[] {
  const authorByText = new Map(texts.map((text) => [text.id, text.authorPlayerId]));

  return assignments.filter(
    (assignment) => authorByText.get(assignment.textId) === assignment.receiverPlayerId,
  );
}
