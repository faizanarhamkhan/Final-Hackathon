export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Illustrative annual income tax slabs from the brief (PKR).
export const TAX_SLABS = [
  { upTo: 600000, base: 0, rate: 0, over: 0 },
  { upTo: 1200000, base: 0, rate: 0.05, over: 600000 },
  { upTo: 2400000, base: 30000, rate: 0.15, over: 1200000 },
  { upTo: 3600000, base: 210000, rate: 0.25, over: 2400000 },
  { upTo: Infinity, base: 510000, rate: 0.35, over: 3600000 },
];

export function annualTax(annualIncome) {
  const income = Math.max(0, Number(annualIncome) || 0);
  const slab = TAX_SLABS.find((s) => income <= s.upTo);
  return round2(slab.base + (income - slab.over) * slab.rate);
}
