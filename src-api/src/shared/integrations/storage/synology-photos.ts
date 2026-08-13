import type { FetchLike } from '@/shared/services/publish/upload/upload-session';

export interface SynologyPhotosClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  fetch?: FetchLike;
  teamSpace?: boolean;
}

export interface SynologyUploadInput {
  fileName: string;
  content: Blob;
  albumId?: string;
}

export interface SynologyUploadResult {
  providerId: string;
  url?: string;
  sid: string;
}

export class SynologyPhotosClient {
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;
  private sid: string | null = null;

  constructor(private readonly options: SynologyPhotosClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/g, '');
    this.fetch = options.fetch ?? fetch;
  }

  async login(): Promise<string> {
    const url = new URL(`${this.baseUrl}/webapi/auth.cgi`);
    url.searchParams.set('api', 'SYNO.API.Auth');
    url.searchParams.set('version', '6');
    url.searchParams.set('method', 'login');
    url.searchParams.set('account', this.options.username);
    url.searchParams.set('passwd', this.options.password);
    url.searchParams.set('session', 'Photos');
    url.searchParams.set('format', 'sid');
    const response = await this.fetch(url);
    const body = (await response.json()) as {
      success?: boolean;
      data?: { sid?: string };
    };
    if (!response.ok || !body.success || !body.data?.sid) {
      throw new Error('Synology Photos login failed');
    }
    this.sid = body.data.sid;
    return this.sid;
  }

  async upload(input: SynologyUploadInput): Promise<SynologyUploadResult> {
    const sid = this.sid ?? (await this.login());
    const response = await this.uploadWithSid(input, sid);
    if (response.status === 403 && (await isSidExpired(response.clone()))) {
      const refreshed = await this.login();
      return this.parseUpload(
        await this.uploadWithSid(input, refreshed),
        refreshed,
      );
    }
    return this.parseUpload(response, sid);
  }

  private uploadWithSid(
    input: SynologyUploadInput,
    sid: string,
  ): Promise<Response> {
    const form = new FormData();
    form.set(
      'api',
      this.options.teamSpace ? 'SYNO.PhotoTeam.Upload' : 'SYNO.Foto.Upload',
    );
    form.set('version', '1');
    form.set('method', 'upload');
    form.set('_sid', sid);
    if (input.albumId) form.set('album_id', input.albumId);
    form.set('file', input.content, input.fileName);
    return this.fetch(`${this.baseUrl}/webapi/entry.cgi`, {
      method: 'POST',
      body: form,
    });
  }

  private async parseUpload(
    response: Response,
    sid: string,
  ): Promise<SynologyUploadResult> {
    const body = (await response.json()) as {
      success?: boolean;
      data?: { id?: string; url?: string };
    };
    if (!response.ok || !body.success || !body.data?.id) {
      throw new Error('Synology Photos upload failed');
    }
    return {
      providerId: body.data.id,
      url: body.data.url,
      sid,
    };
  }
}

async function isSidExpired(response: Response): Promise<boolean> {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: number };
  } | null;
  return body?.error?.code === 119;
}
