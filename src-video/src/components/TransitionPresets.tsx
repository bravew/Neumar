import { linearTiming, springTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';

export const transitions = {
  crossfade: {
    presentation: fade(),
    timing: linearTiming({ durationInFrames: 15 }),
  },
  slideRight: {
    presentation: slide({ direction: 'from-right' }),
    timing: springTiming({ config: { damping: 200 } }),
  },
  slideLeft: {
    presentation: slide({ direction: 'from-left' }),
    timing: springTiming({ config: { damping: 200 } }),
  },
  slideUp: {
    presentation: slide({ direction: 'from-bottom' }),
    timing: springTiming({ config: { damping: 200 } }),
  },
  wipe: {
    presentation: wipe(),
    timing: linearTiming({ durationInFrames: 20 }),
  },
} as const;
