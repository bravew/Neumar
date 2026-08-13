export type ToolCallPhase = 'inProgress' | 'executing' | 'complete' | 'error';

export interface ToolCallError {
  message: string;
  code?: string;
}

export type ToolCallState<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult = unknown,
> =
  | {
      phase: 'inProgress';
      partialArgs: Partial<TArgs>;
      rawArgs: string;
    }
  | {
      phase: 'executing';
      args: TArgs;
      rawArgs: string;
    }
  | {
      phase: 'complete';
      args: TArgs;
      result: TResult;
      rawArgs: string;
    }
  | {
      phase: 'error';
      args?: Partial<TArgs>;
      error: ToolCallError;
      rawArgs?: string;
    };
