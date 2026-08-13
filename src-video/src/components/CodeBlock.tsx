import { useCurrentFrame } from 'remotion';

import { fonts, brand } from '../theme';
import { MacOSTitleBar } from './MacOSTitleBar';

interface CodeBlockProps {
  code: string;
  typingSpeed?: number;
  delay?: number;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  typingSpeed = 2,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const relFrame = frame - delay;

  if (relFrame < 0) return null;

  const charsToShow = Math.min(Math.floor(relFrame * typingSpeed), code.length);
  const visibleCode = code.slice(0, charsToShow);
  const showCursor = charsToShow < code.length;

  return (
    <div
      style={{
        background: '#1e1e1e',
        borderRadius: 12,
        padding: '24px 32px',
        fontFamily: fonts.mono,
        fontSize: 18,
        lineHeight: 1.6,
        color: '#d4d4d4',
        whiteSpace: 'pre-wrap',
        position: 'relative',
        boxShadow: `0 20px 60px -15px ${brand.colors.shadow}60`,
      }}
    >
      <MacOSTitleBar dotSize={10} />

      {visibleCode}
      {showCursor && (
        <span
          style={{
            display: 'inline-block',
            width: 10,
            height: 20,
            background: brand.colors.primary,
            opacity: frame % 30 < 15 ? 1 : 0,
            marginLeft: 2,
            verticalAlign: 'text-bottom',
          }}
        />
      )}
    </div>
  );
};
