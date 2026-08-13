export type SketchTheme = 'light' | 'dark';
export type SketchColorTool = 'pen' | 'highlight' | 'line';

const LIGHT_TOOL_COLORS: Record<SketchColorTool, string> = {
  pen: '#1D4ED8',
  highlight: '#FACC15',
  line: '#1D4ED8',
};

const DARK_TOOL_COLORS: Record<SketchColorTool, string> = {
  pen: '#93C5FD',
  highlight: '#FDE68A',
  line: '#93C5FD',
};

export function resolveDefaultSketchToolColor(
  tool: SketchColorTool,
  theme: SketchTheme,
): string {
  return theme === 'dark' ? DARK_TOOL_COLORS[tool] : LIGHT_TOOL_COLORS[tool];
}
