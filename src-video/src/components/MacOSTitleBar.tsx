const DOT_COLORS = ['#ff5f57', '#ffbd2e', '#28ca42'] as const;

interface MacOSTitleBarProps {
  dotSize?: number;
}

export const MacOSTitleBar: React.FC<MacOSTitleBarProps> = ({
  dotSize = 12,
}) => (
  <div
    style={{
      height: 32,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      paddingLeft: 12,
      paddingBottom: 8,
    }}
  >
    {DOT_COLORS.map((bg) => (
      <div
        key={bg}
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: '50%',
          background: bg,
        }}
      />
    ))}
  </div>
);
