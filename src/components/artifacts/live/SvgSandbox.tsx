import { useDeferredValue, useMemo, useRef } from 'react';

import DOMPurify from 'dompurify';

import { generateNonce, wrapSvgSrcdoc } from './iframe-sandbox';
import { IframeSandbox } from './IframeSandbox';

interface SvgSandboxProps {
  svg: string;
  identity: string;
  title?: string;
}

export function SvgSandbox({ svg, identity, title }: SvgSandboxProps) {
  const nonce = useRef(generateNonce()).current;
  const deferredSvg = useDeferredValue(svg);

  const srcdoc = useMemo(() => {
    const clean = DOMPurify.sanitize(deferredSvg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['script', 'foreignObject'],
      FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover', 'href'],
    });
    return wrapSvgSrcdoc(String(clean), nonce);
  }, [deferredSvg, nonce]);

  return (
    <IframeSandbox
      srcdoc={srcdoc}
      nonce={nonce}
      identity={identity}
      title={title ?? 'svg artifact'}
    />
  );
}
