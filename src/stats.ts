/**
 * Statistical functions for the Video Poker audit.
 *
 *   chiSquaredTest      — goodness-of-fit with exact p-values via regularized incomplete gamma
 *   chiSquaredPValue    — right-tail p-value P(chi2 > stat | df), exact gamma
 *   binomialCoeff       — C(n,k), overflow-safe for n ≤ 52
 *   hypergeometricPMF   — P(exactly h hits) for an N-D-K draw
 *   lag1Autocorrelation — lag-1 autocorrelation of a numeric series
 *   runsTest            — Wald-Wolfowitz runs test for serial randomness
 *   inverseCriticalZ    — inverse standard-normal for Bonferroni z-critical
 */

// ── Chi-squared goodness-of-fit ────────────────────────────────────────────────

export interface ChiSquaredResult {
  chi2:   number;
  df:     number;
  pValue: number;
}

export function chiSquaredTest(
  observed: readonly number[],
  expected: readonly number[],
): ChiSquaredResult {
  if (observed.length !== expected.length) {
    throw new Error('observed and expected must have the same length');
  }

  // Pool bins with expected < 5 from front and back tails.
  const obs: number[] = [...observed];
  const exp: number[] = [...expected];

  while (obs.length > 2 && exp[0] < 5) {
    obs[1] += obs[0]; exp[1] += exp[0];
    obs.shift(); exp.shift();
  }
  while (obs.length > 2 && exp[exp.length - 1] < 5) {
    const n = obs.length;
    obs[n - 2] += obs[n - 1]; exp[n - 2] += exp[n - 1];
    obs.pop(); exp.pop();
  }

  let chi2 = 0;
  for (let i = 0; i < obs.length; i++) {
    if (exp[i] > 0) chi2 += (obs[i] - exp[i]) ** 2 / exp[i];
  }

  const df     = obs.length - 1;
  const pValue = chiSquaredPValue(chi2, df);
  return { chi2, df, pValue };
}

/** Right-tail p-value: P(chi2 > stat | df), via exact regularized incomplete gamma. */
export function chiSquaredPValue(stat: number, df: number): number {
  if (df <= 0) throw new Error(`df must be positive, got ${df}`);
  if (stat <= 0) return 1;
  return 1 - regularizedGamma(df / 2, stat / 2);
}

// ── Regularized incomplete gamma (exact) ──────────────────────────────────────

function regularizedGamma(a: number, x: number): number {
  if (x < 0) return 0;
  if (x === 0) return 0;
  if (x < a + 1) return gammaSeries(a, x);
  return 1 - gammaCF(a, x);
}

function logGamma(z: number): number {
  const c = [
     0.99999999999980993,
   676.5203681218851,
  -1259.1392167224028,
   771.32342877765313,
  -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
     9.9843695780195716e-6,
     1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = c[0];
  for (let i = 1; i < 9; i++) x += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function gammaSeries(a: number, x: number): number {
  const lnGa = logGamma(a);
  let ap  = a;
  let del = 1 / a;
  let sum = del;
  for (let n = 0; n < 300; n++) {
    ap++;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 3e-14) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGa);
}

function gammaCF(a: number, x: number): number {
  const lnGa = logGamma(a);
  let b = x + 1 - a;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 300; i++) {
    const an = -i * (i - a);
    b += 2;
    d  = an * d + b; if (Math.abs(d) < 1e-30) d = 1e-30;
    c  = b + an / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d  = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGa) * h;
}

// ── Combinatorial functions ───────────────────────────────────────────────────

/** C(n, k) — overflow-safe for n ≤ 52. */
export function binomialCoeff(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < kk; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

/**
 * Hypergeometric PMF: P(exactly h hits) when drawing K from N with D successes.
 *   pmf(h) = C(D,h) × C(N-D, K-h) / C(N, K)
 */
export function hypergeometricPMF(
  N: number, D: number, K: number, h: number,
): number {
  return (binomialCoeff(D, h) * binomialCoeff(N - D, K - h)) / binomialCoeff(N, K);
}

// ── Lag-1 autocorrelation ─────────────────────────────────────────────────────

export function lag1Autocorrelation(series: readonly number[]): number {
  const n    = series.length;
  const mean = series.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n - 1; i++) num += (series[i] - mean) * (series[i + 1] - mean);
  for (let i = 0; i < n; i++)     den += (series[i] - mean) ** 2;
  return den === 0 ? 0 : num / den;
}

// ── Wald-Wolfowitz runs test ──────────────────────────────────────────────────

export interface RunsTestResult {
  runs:     number;
  expected: number;
  z:        number;
  pValue:   number;
}

export function runsTest(series: readonly number[]): RunsTestResult {
  const med = quickMedian(series);
  let n1 = 0;
  let runs = 1;
  let prevAbove = series[0] >= med;
  if (prevAbove) n1++;
  for (let i = 1; i < series.length; i++) {
    const above = series[i] >= med;
    if (above) n1++;
    if (above !== prevAbove) { runs++; prevAbove = above; }
  }
  const n        = series.length;
  const n2       = n - n1;
  const expected = (2 * n1 * n2) / n + 1;
  const varRuns  = (2 * n1 * n2 * (2 * n1 * n2 - n)) / (n * n * (n - 1));
  const z        = varRuns > 0 ? (runs - expected) / Math.sqrt(varRuns) : 0;
  const pValue   = 2 * (1 - normalCDF(Math.abs(z)));
  return { runs, expected, z, pValue };
}

function quickMedian(arr: readonly number[]): number {
  let min = arr[0], max = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < min) min = arr[i];
    if (arr[i] > max) max = arr[i];
  }
  const counts = new Array(max - min + 1).fill(0);
  for (let i = 0; i < arr.length; i++) counts[arr[i] - min]++;
  const mid = Math.floor(arr.length / 2);
  let cum = 0;
  for (let v = 0; v < counts.length; v++) {
    cum += counts[v];
    if (arr.length % 2 === 1) {
      if (cum > mid) return v + min;
    } else {
      if (cum === mid) {
        for (let w = v + 1; w < counts.length; w++) {
          if (counts[w] > 0) return ((v + min) + (w + min)) / 2;
        }
        return v + min;
      }
      if (cum > mid) return v + min;
    }
  }
  return arr[0];
}

function normalCDF(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.sign(x) * y;
}

/** Inverse standard normal CDF — used to convert Bonferroni alpha to a z-critical. */
export function inverseCriticalZ(alpha: number): number {
  // Two-tailed alpha → one-tailed quantile p = 1 - alpha/2
  const p = 1 - alpha / 2;
  return probit(p);
}

/** Abramowitz & Stegun 26.2.23 — inverse standard normal CDF, max error ~4.5e-4. */
function probit(p: number): number {
  if (p < 0 || p > 1) throw new Error(`probit: p must be in [0,1]`);
  if (p === 0) return -Infinity;
  if (p === 1) return  Infinity;

  const c0 = 2.515517,  c1 = 0.802853,  c2 = 0.010328;
  const d1 = 1.432788,  d2 = 0.189269,  d3 = 0.001308;

  const pp = p > 0.5 ? 1 - p : p;
  const t  = Math.sqrt(-2 * Math.log(pp));
  const num = c0 + c1 * t + c2 * t * t;
  const den = 1 + d1 * t + d2 * t * t + d3 * t * t * t;
  const z  = t - num / den;
  return p > 0.5 ? z : -z;
}
