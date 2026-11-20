export type GasLaw = 'boyle' | 'charles' | 'gay-lussac' | 'ideal' | 'combined' | 'avogadro';
export const GAS_CONSTANT = 8.31446261815324; // kPa L mol−1 K−1
export const gasVariables: Record<GasLaw, string[]> = {
  boyle: ['p1', 'v1', 'p2', 'v2'], charles: ['v1', 't1', 'v2', 't2'],
  'gay-lussac': ['p1', 't1', 'p2', 't2'], ideal: ['p', 'v', 'n', 't'],
  combined: ['p1', 'v1', 't1', 'p2', 'v2', 't2'], avogadro: ['v1', 'n1', 'v2', 'n2'],
};
export function toBase(value: number, unit: string): number {
  if (!Number.isFinite(value)) throw new Error('Enter finite numbers.');
  const factors: Record<string, number> = { kPa: 1, Pa: 0.001, atm: 101.325, bar: 100, torr: 101.325 / 760, L: 1, mL: 0.001, 'm³': 1000, mol: 1, mmol: 0.001, K: 1 };
  if (unit === '°C') return value + 273.15;
  if (!(unit in factors)) throw new Error('Unsupported unit.');
  return value * factors[unit];
}
export function fromBase(value: number, unit: string): number {
  if (unit === '°C') return value - 273.15;
  return value / toBase(1, unit);
}
export function solveGasLaw(law: GasLaw, unknown: string, values: Record<string, number>): number {
  const variables = gasVariables[law];
  if (!variables?.includes(unknown)) throw new Error('Choose a quantity to calculate.');
  for (const key of variables.filter(k => k !== unknown)) if (!Number.isFinite(values[key]) || values[key] <= 0) throw new Error('Known pressures, volumes, amounts and Kelvin temperatures must be greater than zero.');
  let result: number;
  if (law === 'ideal') {
    const { p, v, n, t } = values;
    result = unknown === 'p' ? n * GAS_CONSTANT * t / v : unknown === 'v' ? n * GAS_CONSTANT * t / p : unknown === 'n' ? p * v / (GAS_CONSTANT * t) : p * v / (n * GAS_CONSTANT);
  } else if (law === 'boyle') {
    const { p1, v1, p2, v2 } = values;
    result = unknown === 'p1' ? p2 * v2 / v1 : unknown === 'v1' ? p2 * v2 / p1 : unknown === 'p2' ? p1 * v1 / v2 : p1 * v1 / p2;
  } else if (law === 'combined') {
    const { p1, v1, t1, p2, v2, t2 } = values;
    result = unknown === 'p1' ? p2 * v2 * t1 / (t2 * v1)
      : unknown === 'v1' ? p2 * v2 * t1 / (t2 * p1)
      : unknown === 't1' ? p1 * v1 * t2 / (p2 * v2)
      : unknown === 'p2' ? p1 * v1 * t2 / (t1 * v2)
      : unknown === 'v2' ? p1 * v1 * t2 / (t1 * p2)
      : p2 * v2 * t1 / (p1 * v1);
  } else if (law === 'avogadro') {
    const { v1, n1, v2, n2 } = values;
    result = unknown === 'v1' ? v2 * n1 / n2 : unknown === 'n1' ? v1 * n2 / v2 : unknown === 'v2' ? v1 * n2 / n1 : v2 * n1 / v1;
  } else {
    const a = law === 'charles' ? 'v' : 'p';
    const [x1, t1, x2, t2] = [values[`${a}1`], values.t1, values[`${a}2`], values.t2];
    result = unknown === `${a}1` ? x2 * t1 / t2 : unknown === 't1' ? x1 * t2 / x2 : unknown === `${a}2` ? x1 * t2 / t1 : x2 * t1 / x1;
  }
  if (!Number.isFinite(result) || result <= 0) throw new Error('The result is outside the supported numeric range.');
  return result;
}
export function partialPressureTotal(values: number[]): number {
  if (values.length < 2 || values.some(v => !Number.isFinite(v) || v < 0)) throw new Error('Enter at least two non-negative partial pressures.');
  const total = values.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total)) throw new Error('The total is outside the supported numeric range.');
  return total;
}
