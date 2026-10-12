import { useEffect, useRef } from 'react';

interface Part {
  value: number;
  set: (v: number) => void;
  max?: number;
}

// Keeps each part's share of `base` fixed when `base` changes — e.g. rent
// stays 24% of salary, so its ₹ amount follows the new salary.
export function useRescaleOnBaseChange(base: number, parts: Part[]): void {
  const prevBase = useRef(base);
  const prevValues = useRef(parts.map((p) => p.value));

  useEffect(() => {
    const oldBase = prevBase.current;
    const oldValues = prevValues.current;
    prevBase.current = base;
    prevValues.current = parts.map((p) => p.value);

    if (base === oldBase || oldBase <= 0) return;
    // If the parts changed in the same update (e.g. the whole profile loaded
    // from Firestore at once), they're already in terms of the new base.
    if (parts.some((p, i) => p.value !== oldValues[i])) return;

    for (const p of parts) {
      p.set(Math.min(p.max ?? Infinity, Math.floor((p.value * base) / oldBase)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, ...parts.map((p) => p.value)]);
}
