import {
  isRouteErrorResponse,
  useNavigate,
  useRouteError,
} from 'react-router-dom';

import { AlertTriangle, Home, RotateCcw } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

export function RouteErrorPage() {
  const error = useRouteError();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const s = t.settings;

  let title = s.routeErrorSomethingWrong;
  let message = s.routeErrorUnexpected;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = s.routeErrorNotFound;
      message = s.routeErrorNotFoundMsg;
    } else {
      title = `Error ${error.status}`;
      message = error.statusText || message;
    }
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="bg-destructive/10 rounded-full p-4">
          <AlertTriangle className="text-destructive size-8" />
        </div>
        <div className="space-y-1">
          <h1 className="text-foreground text-lg font-semibold">{title}</h1>
          <p className="text-muted-foreground text-sm">{message}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate(-1)}
            className="border-border text-foreground hover:bg-muted flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors"
          >
            <RotateCcw className="size-3.5" />
            {s.routeErrorGoBack}
          </button>
          <button
            onClick={() => navigate('/')}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors"
          >
            <Home className="size-3.5" />
            {s.routeErrorHome}
          </button>
        </div>
      </div>
    </div>
  );
}
