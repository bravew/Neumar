export type SttFrame =
  | { t: 'audio'; pcm: ArrayBuffer }
  | { t: 'flush' }
  | { t: 'stop' };

export type SttEvent =
  | { t: 'partial'; type: 'partial'; text: string; ms: number }
  | {
      t: 'final';
      type: 'final';
      text: string;
      ms: number;
      confidence: number;
    }
  | { t: 'vad_start'; type: 'vad_start'; ms: number }
  | { t: 'vad_end'; type: 'vad_end'; ms: number }
  | { t: 'end_of_turn'; type: 'end_of_turn'; ms: number }
  | {
      t: 'error';
      type: 'error';
      code: 'no_model' | 'auth' | 'timeout' | 'unknown';
      msg: string;
      error: string;
      ms: number;
    };
