import { useEffect, useMemo, useState } from 'react';

import { cn } from '@/shared/lib/utils';
import type { DesignSystemRecord } from '@/shared/types/design-mode';

interface IconIdentity {
  label: string;
  simpleIconSlug?: string;
  initials?: string;
}

const SIMPLE_ICON_IDENTITIES: Record<string, IconIdentity> = {
  airbnb: { label: 'Airbnb', simpleIconSlug: 'airbnb' },
  airtable: { label: 'Airtable', simpleIconSlug: 'airtable' },
  ant: { label: 'Ant Design', simpleIconSlug: 'antdesign' },
  anthropic: { label: 'Anthropic', simpleIconSlug: 'anthropic' },
  apple: { label: 'Apple', simpleIconSlug: 'apple' },
  arc: { label: 'Arc', simpleIconSlug: 'arc' },
  binance: { label: 'Binance', simpleIconSlug: 'binance' },
  bmw: { label: 'BMW', simpleIconSlug: 'bmw' },
  bolt: { label: 'Bolt' },
  bugatti: { label: 'Bugatti', simpleIconSlug: 'bugatti' },
  cal: { label: 'Cal.com', simpleIconSlug: 'caldotcom', initials: 'Cal' },
  canva: { label: 'Canva' },
  claude: { label: 'Claude', simpleIconSlug: 'claude' },
  clickhouse: { label: 'ClickHouse', simpleIconSlug: 'clickhouse' },
  cohere: { label: 'Cohere' },
  coinbase: { label: 'Coinbase', simpleIconSlug: 'coinbase' },
  cursor: { label: 'Cursor', simpleIconSlug: 'cursor' },
  discord: { label: 'Discord', simpleIconSlug: 'discord' },
  duolingo: { label: 'Duolingo', simpleIconSlug: 'duolingo' },
  elevenlabs: { label: 'ElevenLabs', simpleIconSlug: 'elevenlabs' },
  expo: { label: 'Expo', simpleIconSlug: 'expo' },
  ferrari: { label: 'Ferrari', simpleIconSlug: 'ferrari' },
  figma: { label: 'Figma', simpleIconSlug: 'figma' },
  framer: { label: 'Framer', simpleIconSlug: 'framer' },
  github: { label: 'GitHub', simpleIconSlug: 'github' },
  hashicorp: { label: 'HashiCorp', simpleIconSlug: 'hashicorp' },
  huggingface: { label: 'Hugging Face', simpleIconSlug: 'huggingface' },
  ibm: { label: 'IBM' },
  intercom: { label: 'Intercom', simpleIconSlug: 'intercom' },
  kraken: { label: 'Kraken' },
  lamborghini: { label: 'Lamborghini', simpleIconSlug: 'lamborghini' },
  'linear-app': {
    label: 'Linear',
    simpleIconSlug: 'linear',
    initials: 'Ln',
  },
  lovable: { label: 'Lovable' },
  mastercard: { label: 'Mastercard', simpleIconSlug: 'mastercard' },
  meta: { label: 'Meta', simpleIconSlug: 'meta' },
  midjourney: { label: 'Midjourney' },
  minimax: { label: 'MiniMax', simpleIconSlug: 'minimax' },
  mintlify: { label: 'Mintlify', simpleIconSlug: 'mintlify' },
  miro: { label: 'Miro', simpleIconSlug: 'miro' },
  'mistral-ai': {
    label: 'Mistral AI',
    simpleIconSlug: 'mistralai',
    initials: 'Mi',
  },
  mongodb: { label: 'MongoDB', simpleIconSlug: 'mongodb' },
  nike: { label: 'Nike', simpleIconSlug: 'nike' },
  notion: { label: 'Notion', simpleIconSlug: 'notion' },
  nvidia: { label: 'NVIDIA', simpleIconSlug: 'nvidia' },
  ollama: { label: 'Ollama', simpleIconSlug: 'ollama' },
  openai: { label: 'OpenAI' },
  'opencode-ai': {
    label: 'OpenCode',
    initials: 'OC',
  },
  perplexity: { label: 'Perplexity', simpleIconSlug: 'perplexity' },
  pinterest: { label: 'Pinterest', simpleIconSlug: 'pinterest' },
  playstation: { label: 'PlayStation', simpleIconSlug: 'playstation' },
  posthog: { label: 'PostHog', simpleIconSlug: 'posthog' },
  raycast: { label: 'Raycast', simpleIconSlug: 'raycast' },
  renault: { label: 'Renault', simpleIconSlug: 'renault' },
  replicate: { label: 'Replicate', simpleIconSlug: 'replicate' },
  replit: { label: 'Replit', simpleIconSlug: 'replit' },
  resend: { label: 'Resend', simpleIconSlug: 'resend' },
  revolut: { label: 'Revolut', simpleIconSlug: 'revolut' },
  runwayml: { label: 'Runway' },
  sanity: { label: 'Sanity', simpleIconSlug: 'sanity' },
  sentry: { label: 'Sentry', simpleIconSlug: 'sentry' },
  shadcn: { label: 'shadcn/ui', simpleIconSlug: 'shadcnui' },
  shopify: { label: 'Shopify', simpleIconSlug: 'shopify' },
  spacex: { label: 'SpaceX', simpleIconSlug: 'spacex' },
  spotify: { label: 'Spotify', simpleIconSlug: 'spotify' },
  starbucks: { label: 'Starbucks', simpleIconSlug: 'starbucks' },
  stripe: { label: 'Stripe', simpleIconSlug: 'stripe' },
  supabase: { label: 'Supabase', simpleIconSlug: 'supabase' },
  superhuman: { label: 'Superhuman' },
  tesla: { label: 'Tesla', simpleIconSlug: 'tesla' },
  theverge: { label: 'The Verge' },
  'together-ai': {
    label: 'Together AI',
    initials: 'To',
  },
  uber: { label: 'Uber', simpleIconSlug: 'uber' },
  v0: { label: 'v0', simpleIconSlug: 'v0' },
  vercel: { label: 'Vercel', simpleIconSlug: 'vercel' },
  vodafone: { label: 'Vodafone', simpleIconSlug: 'vodafone' },
  warp: { label: 'Warp', simpleIconSlug: 'warp' },
  webflow: { label: 'Webflow', simpleIconSlug: 'webflow' },
  wise: { label: 'Wise', simpleIconSlug: 'wise' },
  'x-ai': { label: 'xAI', simpleIconSlug: 'x', initials: 'xAI' },
  xiaohongshu: {
    label: 'Xiaohongshu',
    simpleIconSlug: 'xiaohongshu',
    initials: 'XH',
  },
  zapier: { label: 'Zapier', simpleIconSlug: 'zapier' },
};

function identityForSystem(system: DesignSystemRecord): IconIdentity {
  const known = SIMPLE_ICON_IDENTITIES[system.id];
  if (known) return known;
  const title = system.title.replace(/^Design System Inspired by\s+/i, '');
  return {
    label: title,
    initials: initialsFromTitle(title),
  };
}

function initialsFromTitle(title: string): string {
  const words = title
    .replace(/[^a-z0-9\s./-]/gi, ' ')
    .split(/[\s./-]+/)
    .filter(Boolean);
  if (words.length === 0) return 'DS';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

function swatchBackground(system: DesignSystemRecord): string {
  return (
    system.swatches.find((swatch) => /^#[0-9a-f]{6}$/i.test(swatch)) ??
    '#111827'
  );
}

function readableTextColor(background: string): string {
  const value = background.replace('#', '');
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  const channels = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;
  return whiteContrast >= blackContrast ? '#ffffff' : '#111827';
}

export function getDesignSystemIconSearchTerms(
  system: DesignSystemRecord,
): string[] {
  const identity = identityForSystem(system);
  return [identity.label, identity.simpleIconSlug].filter(Boolean) as string[];
}

export function DesignSystemCompanyIcon({
  system,
  className,
}: {
  system: DesignSystemRecord;
  className?: string;
}) {
  const identity = useMemo(() => identityForSystem(system), [system]);
  const src = identity.simpleIconSlug
    ? `https://cdn.simpleicons.org/${identity.simpleIconSlug}`
    : undefined;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src && !failed) {
    return (
      <span
        className={cn(
          'border-border/70 flex size-8 shrink-0 items-center justify-center rounded-md border bg-white shadow-sm dark:border-white/10',
          className,
        )}
        data-testid={`design-system-icon-${system.id}`}
      >
        <img
          src={src}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className="size-5 object-contain"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  const background = swatchBackground(system);
  const foreground = readableTextColor(background);
  const initials = identity.initials ?? initialsFromTitle(identity.label);

  return (
    <span
      className={cn(
        'border-border/70 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border shadow-sm',
        className,
      )}
      data-testid={`design-system-icon-${system.id}`}
    >
      <svg
        viewBox="0 0 40 40"
        aria-hidden="true"
        focusable="false"
        className="size-full"
      >
        <rect width="40" height="40" rx="8" fill={background} />
        <text
          x="20"
          y="24"
          textAnchor="middle"
          fill={foreground}
          fontFamily="Inter, system-ui, sans-serif"
          fontSize={initials.length > 2 ? 10 : 13}
          fontWeight="700"
        >
          {initials}
        </text>
      </svg>
    </span>
  );
}
