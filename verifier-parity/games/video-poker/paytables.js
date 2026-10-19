/**
 * Duel.com Video Poker — published paytable.
 *
 * Source: GET https://duel.com/api/v2/video-poker/config
 * Captured: 2026-04-23
 * Variant: Jacks or Better (single variant — no risk levels, no alternative tables)
 *
 * Royal Flush (812.97…) is slightly more generous than the canonical 9/6
 * Jacks-or-Better paytable (800), per the captured config — preserved verbatim.
 *
 * 'none' = any losing hand (no pair of Jacks or better, no better combination).
 *
 * Verified: every captured bet's recorded multiplier matches paytable lookup
 * by combination — see derive.js comment for the full check.
 */

export const PAYTABLE = {
  royal_flush:     812.9719437907615,
  straight_flush:   58,
  four_of_a_kind:   26,
  full_house:        9,
  flush:             6,
  straight:          4,
  three_of_a_kind:   3,
  two_pair:          2,
  jacks_or_better:   1,
  none:              0,
};

/**
 * Hand-rank labels for display. Order matches the paytable highest → lowest.
 */
export const HAND_LABELS = {
  royal_flush:     'Royal Flush',
  straight_flush:  'Straight Flush',
  four_of_a_kind:  'Four of a Kind',
  full_house:      'Full House',
  flush:           'Flush',
  straight:        'Straight',
  three_of_a_kind: 'Three of a Kind',
  two_pair:        'Two Pair',
  jacks_or_better: 'Jacks or Better',
  none:            'No Win',
};

/**
 * Look up the multiplier for a hand-rank string.
 * Returns 0 for an unknown / 'none' rank.
 */
export function multiplierFor(combination) {
  return PAYTABLE[combination] ?? 0;
}
