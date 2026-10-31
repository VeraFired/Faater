/**
 * Small-sample statistics for refusal evaluation.
 *
 * Refusal quality is a proportion estimated from a modest number of items, so
 * every quoted number needs an interval. These routines are the minimum needed
 * to answer the question the plan says to ask FIRST: is the target even
 * measurable at this sample size?
 */

/** Lanczos approximation of ln Γ(x), x > 0. */
export function lnGamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  if (x < 0.5) {
    // Reflection formula.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x)
  }
  x -= 1
  let a = 0.99999999999980993
  const t = x + 7.5
  for (let i = 0; i < 8; i++) a += g[i] / (x + i + 1)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

/** Continued fraction for the incomplete beta function (Lentz's method). */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200
  const EPS = 3e-14
  const FPMIN = 1e-300
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

/** Regularized incomplete beta I_x(a, b). */
export function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  )
  return x < (a + 1) / (a + b + 2)
    ? (bt * betacf(a, b, x)) / a
    : 1 - (bt * betacf(b, a, 1 - x)) / b
}

/** Inverse of betai in x, by bisection. */
export function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0
  if (p >= 1) return 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (betai(a, b, mid) < p) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export interface Interval {
  lower: number
  upper: number
}

/**
 * Clopper-Pearson (exact) interval for a binomial proportion.
 *
 * Chosen over the normal approximation because refusal evaluations routinely
 * have k = 0 or k = n on small samples, where the normal interval collapses to
 * a point and lies.
 */
export function clopperPearson(k: number, n: number, confidence = 0.95): Interval {
  if (n <= 0) throw new Error('n must be positive')
  if (k < 0 || k > n) throw new Error('k must be within [0, n]')
  const alpha = 1 - confidence
  const lower = k === 0 ? 0 : betaQuantile(alpha / 2, k, n - k + 1)
  const upper = k === n ? 1 : betaQuantile(1 - alpha / 2, k + 1, n - k)
  return { lower, upper }
}

/**
 * Items needed to claim an upper bound of `target` with ZERO observed errors.
 *
 * Solving 1 - (alpha/2)^(1/n) <= target for n. This is the number the plan
 * demands before anyone quotes a point estimate: with 75 items, zero errors
 * still permits a true rate near 4.8%, so "we meet a 2% target" is not a
 * supportable claim at that size.
 */
export function itemsForUpperBound(target: number, confidence = 0.95): number {
  if (target <= 0 || target >= 1) throw new Error('target must be in (0, 1)')
  const alpha = 1 - confidence
  return Math.ceil(Math.log(alpha / 2) / Math.log(1 - target))
}

/** Wilson score interval — reported alongside Clopper-Pearson for comparison. */
export function wilson(k: number, n: number, confidence = 0.95): Interval {
  if (n <= 0) throw new Error('n must be positive')
  const z = normalQuantile(1 - (1 - confidence) / 2)
  const p = k / n
  const denom = 1 + (z * z) / n
  const centre = p + (z * z) / (2 * n)
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return {
    lower: Math.max(0, (centre - spread) / denom),
    upper: Math.min(1, (centre + spread) / denom),
  }
}

/** Acklam's inverse normal CDF; plenty accurate for CI work. */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) throw new Error('p must be in (0, 1)')
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const plow = 0.02425
  const phigh = 1 - plow
  let q: number
  let r: number
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  q = p - 0.5
  r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/** Percentile via linear interpolation between closest ranks. */
export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}