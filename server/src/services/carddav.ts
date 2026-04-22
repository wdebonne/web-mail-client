// Minimal CardDAV client used to push local contacts to a remote address book
// (e.g. o2switch / RoundCube / SabreDAV).

export interface CardDAVConfig {
  baseUrl: string; // collection URL (ends or not with /)
  username: string;
  password: string;
}

export class CardDAVService {
  private config: CardDAVConfig;
  private origin: string;

  constructor(config: CardDAVConfig) {
    this.config = {
      ...config,
      baseUrl: config.baseUrl.endsWith('/') ? config.baseUrl : config.baseUrl + '/',
    };
    try {
      const u = new URL(this.config.baseUrl);
      this.origin = `${u.protocol}//${u.host}`;
    } catch {
      this.origin = '';
    }
  }

  private authHeader(): string {
    return 'Basic ' + Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
  }

  private absolute(href: string): string {
    if (/^https?:\/\//i.test(href)) return href;
    if (href.startsWith('/')) return this.origin + href;
    return this.config.baseUrl + href;
  }

  async testConnection(): Promise<{ ok: boolean; status?: number; error?: string }> {
    try {
      const res = await fetch(this.config.baseUrl, {
        method: 'PROPFIND',
        headers: {
          Authorization: this.authHeader(),
          Depth: '0',
          'Content-Type': 'application/xml; charset=utf-8',
        },
        body: `<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:"><prop><displayname/><resourcetype/></prop></propfind>`,
      });
      return { ok: res.ok || res.status === 207, status: res.status };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network error' };
    }
  }

  /** PUT a vCard to `{collection}/{uid}.vcf`. Returns the saved href + etag. */
  async putContact(uid: string, vcardBody: string, ifMatch?: string): Promise<{ ok: boolean; status: number; href: string; etag?: string; error?: string }> {
    const href = `${this.config.baseUrl}${encodeURIComponent(uid)}.vcf`;
    try {
      const headers: Record<string, string> = {
        Authorization: this.authHeader(),
        'Content-Type': 'text/vcard; charset=utf-8',
      };
      if (ifMatch) headers['If-Match'] = ifMatch;
      const res = await fetch(href, { method: 'PUT', headers, body: vcardBody });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, status: res.status, href, error: text.slice(0, 300) };
      }
      const etag = res.headers.get('etag') || undefined;
      return { ok: true, status: res.status, href, etag };
    } catch (e: any) {
      return { ok: false, status: 0, href, error: e?.message || 'network error' };
    }
  }

  async deleteContact(hrefOrUid: string): Promise<{ ok: boolean; status: number }> {
    const url = hrefOrUid.startsWith('http') || hrefOrUid.startsWith('/')
      ? this.absolute(hrefOrUid)
      : `${this.config.baseUrl}${encodeURIComponent(hrefOrUid)}.vcf`;
    try {
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: this.authHeader() },
      });
      return { ok: res.ok || res.status === 404, status: res.status };
    } catch {
      return { ok: false, status: 0 };
    }
  }
}
