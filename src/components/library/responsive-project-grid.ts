export const PROJECT_CARD_MIN_WIDTH_PX = 288;
export const PROJECT_CARD_MAX_WIDTH_PX = 352;

// Values below are pixel-literal to match PROJECT_CARD_MIN_WIDTH_PX /
// PROJECT_CARD_MAX_WIDTH_PX and VirtualCardGrid's GRID_GAP_PX (12). rem-based
// values here would drift from those JS-computed column counts whenever the
// root font size isn't 16px, breaking virtualized rows and keyboard nav.
export const RESPONSIVE_PROJECT_GRID_CLASS =
  'grid grid-cols-[repeat(auto-fill,minmax(min(288px,100%),1fr))] justify-items-start gap-[12px] [&>*]:w-full [&>*]:max-w-[352px]';
