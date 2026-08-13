import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HtmlFramePreview } from '../HtmlFramePreview';

describe('HtmlFramePreview', () => {
  it('renders an iframe whose sandbox never includes allow-same-origin', () => {
    render(
      <HtmlFramePreview
        rawHtml="<!doctype html><html><head></head><body><h1>x</h1></body></html>"
        variables={{ a: 1 }}
        identity="tpl/intro"
      />,
    );
    const iframe = screen.getByTitle('html-frame preview') as HTMLIFrameElement;
    expect(iframe.getAttribute('sandbox')).toBeTruthy();
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  it('embeds the variable map into the srcdoc', () => {
    render(
      <HtmlFramePreview
        rawHtml="<!doctype html><html><head></head><body></body></html>"
        variables={{ headline: 'Hi' }}
        identity="tpl/x"
      />,
    );
    const iframe = screen.getByTitle('html-frame preview') as HTMLIFrameElement;
    expect(iframe.getAttribute('srcdoc')).toContain(
      'window.__NEUMA_VARS__={"headline":"Hi"}',
    );
  });

  it('renders an <img> instead of an iframe when mode=poster + posterUrl set', () => {
    render(
      <HtmlFramePreview
        rawHtml="<!doctype html><html><body></body></html>"
        variables={{}}
        identity="tpl/x"
        mode="poster"
        posterUrl="blob:poster"
      />,
    );
    expect(screen.queryByTitle('html-frame preview')).toBeNull();
    const img = screen.getByAltText('html-frame preview') as HTMLImageElement;
    expect(img.src).toContain('blob:poster');
  });

  it('falls back to iframe when mode=poster but no posterUrl available', () => {
    render(
      <HtmlFramePreview
        rawHtml="<!doctype html><html><body></body></html>"
        variables={{}}
        identity="tpl/x"
        mode="poster"
      />,
    );
    expect(screen.getByTitle('html-frame preview')).toBeInstanceOf(
      HTMLIFrameElement,
    );
  });
});
