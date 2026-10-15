/**
 * Failing fixture for scripts/check-warning-baseline.test.mjs.
 *
 * The clean fixture plus one extra effect, which adds exactly one new
 * `react-hooks/exhaustive-deps` warning and one new suppression comment. A
 * gate that sees that growth must exit non-zero.
 */
import { useEffect, useState } from 'react';

export function BaselineGateFixture({ value }: { value: number }) {
  const [doubled, setDoubled] = useState(0);
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    setDoubled(value * 2);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    setLabel(String(value));
  }, [value]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    setText(`value ${value}`);
  }, []);

  return (
    <div>
      {doubled}
      {label}
      {text}
    </div>
  );
}
