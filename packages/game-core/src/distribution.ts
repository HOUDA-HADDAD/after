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
 *
 * The property tests then found a second, rarer failure in the same invariant — see `buildSlots`
 * for what it was. Both bugs were invisible by reading and cost roughly one game in fifty
 * thousand; that ratio is the argument for generated tests over examples.
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

/**
 * How the search treats "your own text".
 *
 * `forbid` rules it out entirely. `last-resort` allows it for a single unit, and only once the
 * search has proved there is no self-free path for that unit — which is what makes "only when
 * unavoidable" (I5) true per player rather than only per game.
 */
type SelfPolicy = 'forbid' | 'last-resort';

/** Thrown when the input cannot be satisfied. Always a caller bug — the clamp exists to prevent it. */
export class InfeasibleDistributionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InfeasibleDistributionError';
  }
}

/**
 * How many traversal orders to try before allowing self-assignment.
 *
 * The spare capacity is allocated on demand rather than up front, so one attempt is normally
 * enough; the retries only vary the order texts are considered in, which costs almost nothing and
 * covers any residual order sensitivity.
 */
const ATTEMPTS = 4;

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
 * `S = Σ demand` slots over `N` texts gives every text ⌊S/N⌋ uses, and `S mod N` texts get one
 * more. Because every demand is at least one, `S ≥ N`, so `base ≥ 1` and every text is used —
 * that is I3, by construction. Total capacity is exactly `S`, so a complete assignment consumes
 * every unit and I4 follows.
 *
 * **Which texts get the spare use is decided during the search, not here.** Fixing it up front
 * was a real bug: with four texts and demands 3, 3, 1, 3 the three big receivers all need the one
 * text none of them wrote, so a self-free arrangement exists only if *that* text holds a spare.
 * Choosing at random and retrying failed roughly once in 256 for that shape — rare enough to pass
 * ten thousand generated games and still be wrong.
 */
function buildSlots(texts: readonly DistributableText[], totalSlots: number, rng: Rng): TextSlot[] {
  const base = Math.floor(totalSlots / texts.length);

  // The shuffle fixes the traversal order used during augmentation, so the result depends on the
  // seed rather than on who submitted first.
  return rng
    .shuffle(texts.map((text, originalIndex) => ({ text, originalIndex })))
    .map((entry) => ({
      text: entry.text,
      capacity: base,
      tookSpare: false,
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
  /** Whether this text has already claimed one of the shared spare uses. At most one, so that
   *  usage never exceeds ⌈S/N⌉ and I4 holds. */
  tookSpare: boolean;
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
  spareUses: number,
  selfPolicy: SelfPolicy,
): boolean {
  /** The shared pool of `S mod N` extra uses, claimed by whichever texts turn out to need them. */
  let spare = spareUses;
  // Every player is present from the outset, so the lookup below never misses.
  const holdings = new Map(input.players.map((player) => [player.id, new Set<string>()]));
  const heldBy = (playerId: string): Set<string> => holdings.get(playerId) as Set<string>;

  const allowed = (playerId: string, text: DistributableText, allowSelf: boolean): boolean =>
    allowSelf || text.authorPlayerId !== playerId;

  const link = (playerId: string, slot: TextSlot): void => {
    slot.holders.add(playerId);
    heldBy(playerId).add(slot.text.id);
  };

  const unlink = (playerId: string, slot: TextSlot): void => {
    slot.holders.delete(playerId);
    heldBy(playerId).delete(slot.text.id);
  };

  const augment = (playerId: string, visited: Set<string>, allowSelf: boolean): boolean => {
    for (const slot of slots) {
      if (visited.has(slot.text.id)) continue;
      if (!allowed(playerId, slot.text, allowSelf)) continue;
      if (heldBy(playerId).has(slot.text.id)) continue;

      visited.add(slot.text.id);

      // Full, but the shared pool still has a spare and this text has not claimed one yet.
      // Claiming here — at the moment a receiver actually needs it — is what makes the search
      // find a self-free arrangement whenever one exists for *any* legal capacity layout.
      if (slot.capacity === 0 && spare > 0 && !slot.tookSpare) {
        slot.capacity += 1;
        slot.tookSpare = true;
        spare -= 1;
      }

      if (slot.capacity > 0) {
        slot.capacity -= 1;
        link(playerId, slot);
        return true;
      }

      // Full. See whether one of its holders can be moved elsewhere to make room.
      // `playerId` cannot be among them — the check above skipped any slot they already hold.
      for (const holderId of [...slot.holders]) {
        unlink(holderId, slot);

        if (augment(holderId, visited, allowSelf)) {
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
      if (augment(receiver.id, new Set(), false)) continue;

      /**
       * No self-free path for *this* unit.
       *
       * Under `forbid` that ends the attempt. Under `last-resort` the constraint is dropped for
       * this one unit and no further: a player owed every text in play has to receive their own,
       * but that is their problem alone. Dropping the rule globally — which is what a single
       * `forbidSelf` flag amounts to — hands everybody else a self-assignment they could have
       * been spared, and D4 asks for the opposite.
       */
      if (selfPolicy === 'forbid') return false;

      /* c8 ignore start -- Unreachable: with self-assignment permitted for this unit, and every
         demand at most the text count, an augmenting path always exists. Kept so a future change
         to the capacity maths fails loudly here rather than silently under-assigning someone. */
      if (!augment(receiver.id, new Set(), true)) {
        return false;
      }
      /* c8 ignore stop */
    }
  }

  return true;
}

export function distribute(input: DistributionInput): Assignment[] {
  validate(input);

  const rng = seededRng(input.seed);
  const totalSlots = input.players.reduce((sum, player) => sum + player.demand, 0);

  if (totalSlots === 0) return [];

  const spareUses = totalSlots % input.texts.length;

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const slots = buildSlots(input.texts, totalSlots, rng);

    if (tryAssign(input, slots, spareUses, 'forbid')) return toAssignments(slots);
  }

  // No wholly self-free arrangement was found. Self-assignment is explicitly permitted (D4), so
  // the last pass allows it — but one unit at a time, only where the search proves it necessary.
  const slots = buildSlots(input.texts, totalSlots, rng);

  /* c8 ignore start -- Unreachable: with self-assignment permitted, every demand is at most the
     text count, which Gale–Ryser guarantees is solvable. Kept so that a future change to the
     capacity maths fails loudly instead of silently under-assigning someone. */
  if (!tryAssign(input, slots, spareUses, 'last-resort')) {
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
