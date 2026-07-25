/**
 * `@aftergame/game-core` — the rules of the game.
 *
 * This package has **no dependencies at all**, not even Node's globals, and no ambient clock or
 * randomness: time and entropy are always parameters. That is enforced by a lint rule, and it is
 * what makes every rule here provable by generated input rather than by a few examples.
 *
 * Distribution, phases and the visibility rules join punishment here in Phases 5 and 6.
 */
export * from './punishment.js';
