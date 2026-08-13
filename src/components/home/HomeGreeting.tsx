import ImageLogo from '@/assets/logo.png';
import { APP_NAME } from '@/config';
import { useSettingsValue } from '@/shared/db/settings';
import { useAuth } from '@/shared/hooks/useAuth';
import { useLanguage } from '@/shared/providers/language-provider';

function cleanName(raw: string): string {
  const [firstName] = raw
    .replace(/[^\p{L}\p{N}\s.'_-]/gu, ' ')
    .trim()
    .split(/\s+/);
  return firstName || APP_NAME;
}

function greetingPeriod(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export function HomeGreeting() {
  const { tt } = useLanguage();
  const settings = useSettingsValue();
  const auth = useAuth();
  const siteConnection = auth.getConnection('site');
  const rawName =
    siteConnection?.displayName ||
    siteConnection?.accountEmail?.split('@')[0] ||
    settings.profile.nickname ||
    APP_NAME;
  const name = cleanName(rawName);
  const period = greetingPeriod(new Date().getHours());

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <img
        src={ImageLogo}
        alt=""
        className="size-8 rounded-md object-contain"
      />
      <h1 className="text-foreground font-serif text-4xl font-normal tracking-normal">
        {tt(`home.greeting.${period}`, { name })}
      </h1>
    </div>
  );
}
