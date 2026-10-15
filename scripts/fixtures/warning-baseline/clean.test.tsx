/**
 * Clean fixture for scripts/check-warning-baseline.test.mjs.
 *
 * This file is deliberately named `.test.tsx` so `pnpm test` can name it, but
 * it lives under `scripts/` and declares no tests of its own. It carries two
 * lint warnings and one suppression comment, which is what the gate baseline
 * for a clean tree records.
 */
import { useEffect, useState } from 'react';

export function BaselineGateFixture({ value }: { value: number }) {
  const [doubled, setDoubled] = useState(0);
  const [label, setLabel] = useState('');

  useEffect(() => {
    setDoubled(value * 2);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    setLabel(String(value));
  }, [value]);

  return (
    <div>
      {doubled}
      {label}
    </div>
  );
}
