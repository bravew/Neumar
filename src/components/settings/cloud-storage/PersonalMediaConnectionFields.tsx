interface PersonalMediaConnectionFieldsProps {
  provider: 'immich' | 'photoprism';
  setProvider: (provider: 'immich' | 'photoprism') => void;
  displayName: string;
  setDisplayName: (name: string) => void;
  baseUrl: string;
  setBaseUrl: (url: string) => void;
  apiKey: string;
  setApiKey: (apiKey: string) => void;
  isEditing: boolean;
  detailsLoading: boolean;
  s: Record<string, string>;
}

const INPUT_CLASS =
  'border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-9 w-full rounded-md border px-3 text-sm focus:ring-2 focus:outline-none';

export function PersonalMediaConnectionFields({
  provider,
  setProvider,
  displayName,
  setDisplayName,
  baseUrl,
  setBaseUrl,
  apiKey,
  setApiKey,
  isEditing,
  detailsLoading,
  s,
}: PersonalMediaConnectionFieldsProps) {
  return (
    <>
      <label className="space-y-1.5 text-sm">
        <span className="font-medium">{s.provider}</span>
        <select
          className={INPUT_CLASS}
          value={provider}
          disabled={isEditing || detailsLoading}
          onChange={(event) =>
            setProvider(event.target.value as 'immich' | 'photoprism')
          }
        >
          <option value="immich">{s.providerImmich}</option>
          <option value="photoprism">{s.providerPhotoPrism}</option>
        </select>
      </label>

      <label className="space-y-1.5 text-sm">
        <span className="font-medium">{s.displayName}</span>
        <input
          className={INPUT_CLASS}
          value={displayName}
          disabled={detailsLoading}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder={provider === 'immich' ? 'Home Immich' : 'PhotoPrism'}
        />
      </label>

      <label className="space-y-1.5 text-sm">
        <span className="font-medium">{s.baseUrl}</span>
        <input
          className={INPUT_CLASS}
          value={baseUrl}
          disabled={detailsLoading}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="http://192.168.1.20:2283"
        />
      </label>

      <label className="space-y-1.5 text-sm">
        <span className="font-medium">{s.apiKey}</span>
        <input
          className={INPUT_CLASS}
          type="password"
          value={apiKey}
          disabled={detailsLoading}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={isEditing ? s.apiKeyLeaveBlank : undefined}
          autoComplete="new-password"
        />
      </label>
    </>
  );
}
