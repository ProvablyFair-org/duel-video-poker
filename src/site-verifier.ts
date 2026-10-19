/**
 * The ProvablyFair.org docs-site Video Poker verifier, vendored and pinned (profile VP-24).
 *
 * WHAT THIS IS. The site's player verifier (VerifyBets → games/video-poker) is what a player runs to
 * check a hand. It is a separate implementation from src/rng.ts. This module loads a BYTE-EXACT copy
 * of the site's derive.js and the three files it imports, refuses to run it unless every file hashes
 * to its pin below, and returns its deriveVideoPoker. Step 5 then runs it on every captured bet.
 *
 * PROVENANCE. Read with `git cat-file -p origin/main:<path>` from the docs-site checkout
 * (qa-workspace/duel/docusaurus, mikepforg/pf-audit-duel) at origin/main bd4d59c, 2026-09-26, and
 * copied unedited to verifier-parity/. The site files are ES modules; the only transformation made
 * here — at load time, never on disk — is removing the `export` keywords and replacing the three
 * import lines with function parameters, exactly as the Dice package does for its one import.
 *
 * Ported from pf-duel-workspace/games/dice/src/site-verifier.ts (2026-09-25).
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

export const SITE_VERIFIER_DIR = path.join(__dirname, '../verifier-parity');

export const SITE_VERIFIER_PINS: Readonly<Record<string, string>> = Object.freeze({
  'games/video-poker/derive.js':    '99763fc4367eac4aee11eb7e0ad0380c38200186ffa1ba4b2a1930c0f452dfdd',
  'games/video-poker/evaluator.js': '3ac92866623f6ef544a4b0b5bc81c6c11c7ddfde582296891819fd4947bf6373',
  'games/video-poker/paytables.js': '55d04619dada49ffa0139c319210f75f790fe9d1fbd3ad028dad7545ac3988f6',
  'lib/hmac-sha256.js':             'bc30bfe9ef202905ece93de33440d41851abf16e910f90c2a567774a2b79d889',
});

export const SITE_VERIFIER_PROVENANCE = Object.freeze({
  siteRoot: 'qa-workspace/duel/docusaurus/src/components/VerifyBets',
  repository: 'mikepforg/pf-audit-duel',
  ref: 'origin/main',
  head: 'bd4d59cd9a3e75146f2575c5218a3fb9a8b2692d',
  headDate: '2026-09-19',
  deriveLastChanged: '4aaa1b267a6b86199c46f57db41058c7885067bb (2026-06-07)',
  paytablesLastChanged: '80046e3104ec0e6fb7e463a2bfa36dc6ee954834 (2026-05-08)',
  readVia: 'git cat-file -p origin/main:<path>',
  readOn: '2026-09-26',
});

/** The exact import lines derive.js may carry; anything else is refused. */
export const DERIVE_IMPORTS: readonly string[] = Object.freeze([
  "import { hmacSha256Hex, hexToBytes } from '../../lib/hmac-sha256';",
  "import { evaluateHand } from './evaluator';",
  "import { multiplierFor, HAND_LABELS } from './paytables';",
]);

export interface SiteVideoPokerResult {
  initialHand: string[];
  replacementPool: string[];
  heldCards: string[] | null;
  finalHand: string[] | null;
  combination: string | null;
  multiplier: number | null;
  isWin: boolean;
}
export type SiteDeriveVideoPoker =
  (p: { clientSeed: string; serverSeed: string; nonce: number; heldCards: string[] | null }) => SiteVideoPokerResult;

export interface SiteVerifierLoad {
  files: Array<{ file: string; pinned: string; actual: string | null; match: boolean }>;
  hashesMatch: boolean;
  derive: SiteDeriveVideoPoker | null;
  error: string | null;
}

const sha256 = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');
const stripExports = (src: string): string => src.replace(/^export (function|const|let|class) /gm, '$1 ');
const importsOf = (src: string): string[] => src.split('\n').filter(l => /^\s*import\b/.test(l));

export function loadSiteVerifier(dir = SITE_VERIFIER_DIR): SiteVerifierLoad {
  const files = Object.entries(SITE_VERIFIER_PINS).map(([file, pinned]) => {
    const p = path.join(dir, file);
    const actual = fs.existsSync(p) ? sha256(fs.readFileSync(p)) : null;
    return { file, pinned, actual, match: actual === pinned };
  });
  const hashesMatch = files.every(f => f.match);
  if (!hashesMatch) return { files, hashesMatch, derive: null, error: 'vendored site verifier does not match its pinned SHA-256' };
  try {
    const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
    // runInThisContext, not a new context: the pure-JS SHA-256 is far slower in a fresh context
    // (measured on Duel Mines, 2026-09-24), which would force a sample instead of every bet.
    const lib = (vm.runInThisContext(
      `(function () {\n${stripExports(read('lib/hmac-sha256.js'))}\n;return { hmacSha256Hex, hexToBytes };\n})`,
      { filename: 'verifier-parity/lib/hmac-sha256.js' },
    ) as () => { hmacSha256Hex: unknown; hexToBytes: unknown })();

    const evSrc = read('games/video-poker/evaluator.js');
    const ptSrc = read('games/video-poker/paytables.js');
    if (importsOf(evSrc).length || importsOf(ptSrc).length) {
      return { files, hashesMatch, derive: null, error: 'evaluator.js / paytables.js carry imports the loader does not provide' };
    }
    const ev = (vm.runInThisContext(`(function () {\n${stripExports(evSrc)}\n;return { evaluateHand };\n})`,
      { filename: 'verifier-parity/games/video-poker/evaluator.js' }) as () => { evaluateHand: unknown })();
    const pt = (vm.runInThisContext(`(function () {\n${stripExports(ptSrc)}\n;return { multiplierFor, HAND_LABELS };\n})`,
      { filename: 'verifier-parity/games/video-poker/paytables.js' }) as () => { multiplierFor: unknown; HAND_LABELS: unknown })();

    let deriveSrc = read('games/video-poker/derive.js');
    const imports = importsOf(deriveSrc);
    if (imports.length !== DERIVE_IMPORTS.length || imports.some((l, i) => l !== DERIVE_IMPORTS[i])) {
      return { files, hashesMatch, derive: null,
        error: `derive.js imports ${JSON.stringify(imports)}; the vendored import set is ${JSON.stringify(DERIVE_IMPORTS)}` };
    }
    for (const l of DERIVE_IMPORTS) deriveSrc = deriveSrc.replace(l, '');
    const body = `(function (hmacSha256Hex, hexToBytes, evaluateHand, multiplierFor, HAND_LABELS) {\n`
      + `${stripExports(deriveSrc)}\n;return { deriveVideoPoker };\n})`;
    const mod = (vm.runInThisContext(body, { filename: 'verifier-parity/games/video-poker/derive.js' }) as
      (...a: unknown[]) => { deriveVideoPoker: SiteDeriveVideoPoker })(
      lib.hmacSha256Hex, lib.hexToBytes, ev.evaluateHand, pt.multiplierFor, pt.HAND_LABELS);
    if (typeof mod.deriveVideoPoker !== 'function') {
      return { files, hashesMatch, derive: null, error: 'derive.js does not define deriveVideoPoker' };
    }
    return { files, hashesMatch, derive: mod.deriveVideoPoker, error: null };
  } catch (e) {
    return { files, hashesMatch, derive: null, error: `vendored site verifier failed to evaluate: ${(e as Error).message}` };
  }
}
