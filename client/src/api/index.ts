const API_BASE = '/api';

/**
 * Silent-refresh state.
 *
 * When an API call returns 401 we try once to rotate the httpOnly refresh
 * cookie via POST /api/auth/refresh, update `auth_token`, and retry the
 * original request. Concurrent 401s share the same pending refresh promise
 * so we never fire multiple refreshes in parallel.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = await res.json().catch(() => null) as { token?: string } | null;
      if (!data?.token) return false;
      localStorage.setItem('auth_token', data.token);
      return true;
    } catch {
      return false;
    } finally {
      // Clear on next tick so any piggy-backed callers see the same result.
      setTimeout(() => { refreshInFlight = null; }, 0);
    }
  })();
  return refreshInFlight;
}

/** Attempt to silently restore a session on app boot (uses the refresh cookie). */
export async function tryRestoreSession(): Promise<boolean> {
  return performRefresh();
}

async function request<T>(url: string, options: RequestInit = {}, _retry = false): Promise<T> {
  const token = localStorage.getItem('auth_token');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (response.status === 401) {
    // Never try to refresh the refresh endpoint itself.
    if (!_retry && !url.startsWith('/auth/refresh') && !url.startsWith('/auth/login')) {
      const refreshed = await performRefresh();
      if (refreshed) {
        return request<T>(url, options, true);
      }
    }
    localStorage.removeItem('auth_token');
    if (window.location.pathname !== '/login' && window.location.pathname !== '/') {
      window.location.href = '/';
    }
    throw new Error('Session expirée');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Erreur réseau' }));
    const err = new Error(body.error || `Erreur ${response.status}`) as Error & { status: number };
    err.status = response.status;
    throw err;
  }

  return response.json();
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<{ token?: string; user?: any; requires2FA?: boolean; pendingToken?: string; userId?: string }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) }
    ),

  register: (email: string, password: string, displayName: string) =>
    request<{ token: string; user: any }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    }),

  logout: () => request('/auth/logout', { method: 'POST' }),

  authForgotPassword: (email: string) =>
    request<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  authResetPassword: (token: string, password: string) =>
    request<{ success: boolean }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),

  getMe: () => request<any>('/auth/me'),

  // Device sessions ("stay signed in" per device)
  getDevices: () => request<Array<{
    id: string;
    deviceName: string | null;
    userAgent: string | null;
    ipLastSeen: string | null;
    createdAt: string;
    lastUsedAt: string;
    expiresAt: string;
    current: boolean;
  }>>('/auth/devices'),
  revokeDevice: (id: string) => request<{ success: boolean }>(`/auth/devices/${id}`, { method: 'DELETE' }),

  // Admin: all device sessions across users
  adminListDevices: () => request<Array<{
    userId: string;
    email: string;
    displayName: string | null;
    isAdmin: boolean;
    devices: Array<{
      id: string;
      deviceName: string | null;
      userAgent: string | null;
      ipLastSeen: string | null;
      createdAt: string;
      lastUsedAt: string;
      expiresAt: string;
    }>;
  }>>('/admin/devices'),
  adminRevokeDevice: (id: string) =>
    request<{ success: boolean }>(`/admin/devices/${id}`, { method: 'DELETE' }),
  adminRevokeUserDevices: (userId: string) =>
    request<{ success: boolean; revoked: number }>(`/admin/users/${userId}/devices`, { method: 'DELETE' }),

  // WebAuthn / passkeys
  webauthnRegisterOptions: () =>
    request<any>('/auth/webauthn/register/options', { method: 'POST' }),
  webauthnRegisterVerify: (response: any, nickname?: string) =>
    request<{ success: boolean; id: string }>('/auth/webauthn/register/verify', {
      method: 'POST',
      body: JSON.stringify({ response, nickname }),
    }),
  webauthnCredentials: () =>
    request<Array<{
      id: string;
      nickname: string | null;
      deviceType: string | null;
      backedUp: boolean;
      createdAt: string;
      lastUsedAt: string | null;
    }>>('/auth/webauthn/credentials'),
  webauthnDeleteCredential: (id: string) =>
    request<{ success: boolean }>(`/auth/webauthn/credentials/${id}`, { method: 'DELETE' }),
  webauthnLoginOptions: (pendingToken: string) =>
    request<any>('/auth/webauthn/login/options', {
      method: 'POST',
      body: JSON.stringify({ pendingToken }),
    }),
  webauthnLoginVerify: (pendingToken: string, response: any) =>
    request<{ token: string; user: any }>('/auth/webauthn/login/verify', {
      method: 'POST',
      body: JSON.stringify({ pendingToken, response }),
    }),
  webauthnUnlockOptions: () =>
    request<any>('/auth/webauthn/unlock/options', { method: 'POST' }),
  webauthnUnlockVerify: (response: any) =>
    request<{ success: boolean }>('/auth/webauthn/unlock/verify', {
      method: 'POST',
      body: JSON.stringify({ response }),
    }),

  // Passwordless passkey login (discoverable credential)
  webauthnPasskeyOptions: () =>
    request<any>('/auth/webauthn/passkey/options', { method: 'POST' }),
  webauthnPasskeyVerify: (response: any) =>
    request<{ token: string; user: any }>('/auth/webauthn/passkey/verify', {
      method: 'POST',
      body: JSON.stringify({ response }),
    }),

  // Accounts
  getAccounts: () => request<any[]>('/accounts'),

  createAccount: (data: any) =>
    request('/accounts', { method: 'POST', body: JSON.stringify(data) }),

  updateAccount: (id: string, data: any) =>
    request(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteAccount: (id: string) =>
    request(`/accounts/${id}`, { method: 'DELETE' }),

  testAccount: (id: string) =>
    request<{ success: boolean; error?: string }>(`/accounts/${id}/test`, { method: 'POST' }),

  // Mail
  getFolders: (accountId: string) =>
    request<any[]>(`/mail/accounts/${accountId}/folders`),

  /** Compteurs (messages, unseen, recent) par chemin de dossier — utilisé pour
   *  afficher le nombre de mails non lus à côté du nom du dossier. */
  getFoldersStatus: (accountId: string, refresh = false) =>
    request<{ folders: Record<string, { messages: number; unseen: number; recent: number }>; cached?: boolean }>(
      `/mail/accounts/${accountId}/folders/status${refresh ? '?refresh=1' : ''}`,
    ),

  /** Pastille (Web App Badging API). `source` = type d'information remontée. */
  getBadgeCount: (
    source: 'inbox-unread' | 'inbox-recent' | 'inbox-total' = 'inbox-unread',
    scope: 'all' | 'default' = 'all',
  ) =>
    request<{ source: string; scope: string; count: number; perAccount: Array<{ accountId: string; count: number }>; cached?: boolean }>(
      `/mail/badge?source=${encodeURIComponent(source)}&scope=${encodeURIComponent(scope)}`,
    ),

  createFolder: (accountId: string, path: string) =>
    request(`/mail/accounts/${accountId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  renameFolder: (accountId: string, oldPath: string, newPath: string) =>
    request(`/mail/accounts/${accountId}/folders`, {
      method: 'PATCH',
      body: JSON.stringify({ oldPath, newPath }),
    }),

  deleteFolder: (accountId: string, path: string) =>
    request(`/mail/accounts/${accountId}/folders`, {
      method: 'DELETE',
      body: JSON.stringify({ path }),
    }),

  getMessages: (accountId: string, folder: string, page: number = 1) =>
    request<{ messages: any[]; total: number; page: number }>(`/mail/accounts/${accountId}/messages?folder=${encodeURIComponent(folder)}&page=${page}`),

  getMessage: (accountId: string, uid: number, folder: string) =>
    request<any>(`/mail/accounts/${accountId}/messages/${uid}?folder=${encodeURIComponent(folder)}`),

  sendMail: (data: any) => {
    const normalizeRecipients = (list?: any[]) =>
      (list || [])
        .map((item) => ({
          email: item?.email || item?.address || '',
          name: item?.name,
        }))
        .filter((item) => item.email);

    const payload = {
      ...data,
      to: normalizeRecipients(data?.to),
      cc: normalizeRecipients(data?.cc),
      bcc: normalizeRecipients(data?.bcc),
    };

    return request('/mail/send', { method: 'POST', body: JSON.stringify(payload) });
  },

  /** Send a pre-built RFC 822 MIME message (S/MIME or PGP/MIME). The server relays it
   *  as-is through SMTP and appends a copy to the Sent folder. */
  sendMailRaw: (data: { accountId: string; to: any[]; cc?: any[]; bcc?: any[]; rawMime: string; inReplyToUid?: number; inReplyToFolder?: string }) => {
    return request('/mail/send-raw', { method: 'POST', body: JSON.stringify(data) });
  },

  saveToOutbox: (data: any) =>
    request('/mail/outbox', { method: 'POST', body: JSON.stringify(data) }),

  processOutbox: () =>
    request('/mail/outbox/process', { method: 'POST' }),

  markAsRead: (accountId: string, uid: number, isRead: boolean, folder: string) =>
    request(`/mail/accounts/${accountId}/messages/${uid}/read?folder=${encodeURIComponent(folder)}`, {
      method: 'PATCH',
      body: JSON.stringify({ isRead }),
    }),

  markFolderAllRead: (accountId: string, folder: string) =>
    request(`/mail/accounts/${accountId}/folders/mark-all-read?folder=${encodeURIComponent(folder)}`, {
      method: 'PATCH',
    }),

  toggleFlag: (accountId: string, uid: number, isFlagged: boolean, folder: string) =>
    request(`/mail/accounts/${accountId}/messages/${uid}/flag?folder=${encodeURIComponent(folder)}`, {
      method: 'PATCH',
      body: JSON.stringify({ isFlagged }),
    }),

  moveMessage: (accountId: string, uid: number, fromFolder: string, toFolder: string) =>
    request(`/mail/accounts/${accountId}/messages/${uid}/move`, {
      method: 'POST',
      body: JSON.stringify({ fromFolder, toFolder }),
    }),

  copyMessage: (accountId: string, uid: number, fromFolder: string, toFolder: string) =>
    request(`/mail/accounts/${accountId}/messages/${uid}/copy`, {
      method: 'POST',
      body: JSON.stringify({ fromFolder, toFolder }),
    }),

  archiveMessage: (accountId: string, uid: number, fromFolder: string) =>
    request<{ success: boolean; destFolder: string }>(
      `/mail/accounts/${accountId}/messages/${uid}/archive`,
      { method: 'POST', body: JSON.stringify({ fromFolder }) }
    ),

  transferMessage: (params: {
    srcAccountId: string;
    srcFolder: string;
    uid: number;
    destAccountId: string;
    destFolder: string;
    mode: 'copy' | 'move';
  }) =>
    request('/mail/messages/transfer', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  copyFolderToAccount: (params: {
    srcAccountId: string;
    srcPath: string;
    destAccountId: string;
    destPath: string;
  }) =>
    request<{ success: boolean; copied?: number; failed?: number; total?: number }>(
      '/mail/folders/copy',
      { method: 'POST', body: JSON.stringify(params) }
    ),

  deleteMessage: (accountId: string, uid: number, folder: string) =>
    request(`/mail/accounts/${accountId}/messages/${uid}?folder=${encodeURIComponent(folder)}`, {
      method: 'DELETE',
    }),

  deleteMessages: (accountId: string, uids: number[], folder: string, toTrash?: boolean, trashFolder?: string) =>
    request<{ deleted: number[] }>(
      `/mail/accounts/${accountId}/messages/bulk-delete`,
      { method: 'POST', body: JSON.stringify({ uids, folder, toTrash, trashFolder }) },
    ),

  // Contacts
  getContacts: (params?: { search?: string; groupId?: string; source?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.groupId) query.set('groupId', params.groupId);
    if (params?.source) query.set('source', params.source);
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.offset) query.set('offset', params.offset.toString());
    return request<{ contacts: any[]; total: number }>(`/contacts?${query}`);
  },

  getContact: (id: string) => request<any>(`/contacts/${id}`),

  createContact: (data: any) =>
    request('/contacts', { method: 'POST', body: JSON.stringify(data) }),

  updateContact: (id: string, data: any) =>
    request(`/contacts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteContact: (id: string) =>
    request(`/contacts/${id}`, { method: 'DELETE' }),

  recordSender: (email: string, name?: string) =>
    request('/contacts/senders/record', { method: 'POST', body: JSON.stringify({ email, name }) }),

  promoteContact: (id: string) =>
    request(`/contacts/${id}/promote`, { method: 'POST' }),

  importContacts: (contacts: any[], mode: 'merge' | 'skip' | 'replace' = 'merge') =>
    request<{ imported: number; updated: number; skipped: number; errors: string[]; total: number }>(
      '/contacts/import',
      { method: 'POST', body: JSON.stringify({ contacts, mode }) }
    ),

  searchContacts: (q: string) =>
    request<{ contacts: any[]; distributionLists: any[] }>(`/contacts/search/autocomplete?q=${encodeURIComponent(q)}`),

  // Organization directory — app users (optionally filtered by q).
  listDirectoryUsers: (q?: string) =>
    request<Array<{ id: string; email: string; display_name: string | null; avatar_url: string | null; nc_username: string | null }>>(
      `/contacts/directory/users${q ? `?q=${encodeURIComponent(q)}` : ''}`
    ),

  getContactGroups: () => request<any[]>('/contacts/groups/list'),

  createContactGroup: (name: string) =>
    request('/contacts/groups', { method: 'POST', body: JSON.stringify({ name }) }),

  deleteContactGroup: (id: string) =>
    request(`/contacts/groups/${id}`, { method: 'DELETE' }),

  getDistributionLists: () => request<any[]>('/contacts/distribution-lists'),

  createDistributionList: (data: any) =>
    request('/contacts/distribution-lists', { method: 'POST', body: JSON.stringify(data) }),

  updateDistributionList: (id: string, data: any) =>
    request(`/contacts/distribution-lists/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteDistributionList: (id: string) =>
    request(`/contacts/distribution-lists/${id}`, { method: 'DELETE' }),

  shareDistributionList: (id: string, sharedWith: any[]) =>
    request(`/contacts/distribution-lists/${id}/share`, { method: 'POST', body: JSON.stringify({ sharedWith }) }),

  // Admin distribution lists
  getAdminDistributionLists: (params?: { search?: string; userId?: string; includeDeleted?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.userId) q.set('userId', params.userId);
    if (params?.includeDeleted) q.set('includeDeleted', 'true');
    return request<any[]>(`/admin/distribution-lists${q.toString() ? `?${q}` : ''}`);
  },

  adminUpdateDistributionList: (id: string, data: any) =>
    request(`/admin/distribution-lists/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  adminDeleteDistributionList: (id: string) =>
    request(`/admin/distribution-lists/${id}`, { method: 'DELETE' }),

  adminShareDistributionList: (id: string, sharedWith: any[]) =>
    request(`/admin/distribution-lists/${id}/share`, { method: 'POST', body: JSON.stringify({ sharedWith }) }),

  adminRestoreDistributionList: (id: string) =>
    request(`/admin/distribution-lists/${id}/restore`, { method: 'POST' }),

  // Calendar
  getCalendars: () => request<any[]>('/calendar'),

  createCalendar: (data: any) =>
    request('/calendar', { method: 'POST', body: JSON.stringify(data) }),

  updateCalendar: (id: string, data: any) =>
    request(`/calendar/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteCalendar: (id: string) =>
    request(`/calendar/${id}`, { method: 'DELETE' }),

  getEvents: (start: string, end: string, calendarIds?: string) => {
    const query = new URLSearchParams({ start, end });
    if (calendarIds) query.set('calendarIds', calendarIds);
    return request<any[]>(`/calendar/events?${query}`);
  },

  createEvent: (data: any) =>
    request('/calendar/events', { method: 'POST', body: JSON.stringify(data) }),

  updateEvent: (id: string, data: any) =>
    request(`/calendar/events/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteEvent: (id: string) =>
    request(`/calendar/events/${id}`, { method: 'DELETE' }),

  // Calendar <-> Mail accounts CalDAV sync
  getCalendarAccounts: () => request<any[]>('/calendar/accounts'),

  getUserNextcloudStatus: () =>
    request<{ enabled: boolean; linked: boolean; ncUsername?: string; ncEmail?: string; autoCreateCalendars?: boolean }>('/calendar/nextcloud-status'),

  updateAccountCaldav: (accountId: string, data: { caldavUrl?: string | null; caldavUsername?: string | null; caldavSyncEnabled?: boolean }) =>
    request(`/calendar/accounts/${accountId}/caldav`, { method: 'PUT', body: JSON.stringify(data) }),

  testAccountCaldav: (accountId: string, data?: { caldavUrl?: string; caldavUsername?: string }) =>
    request<{ ok: boolean; calendars?: Array<{ name: string; color?: string }>; warning?: string; error?: string }>(
      `/calendar/accounts/${accountId}/caldav/test`,
      { method: 'POST', body: JSON.stringify(data || {}) }
    ),

  syncAccountCalendars: (accountId: string) =>
    request<{ ok: boolean; calendars: number; events: number }>(`/calendar/accounts/${accountId}/sync`, { method: 'POST' }),

  syncAllCalendars: () =>
    request<{ ok: boolean; synced: number; results: any[] }>(`/calendar/sync`, { method: 'POST' }),

  migrateCalendar: (id: string, target: 'nextcloud' | 'local', deleteRemote = false) =>
    request<{ ok: boolean; target: string; pushed?: number; failed?: number; total?: number }>(
      `/calendar/${id}/migrate`,
      { method: 'POST', body: JSON.stringify({ target, deleteRemote }) }
    ),

  // Settings
  getSettings: () => request<any>('/settings'),
  updateSettings: (data: any) =>
    request('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request('/settings/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) }),

  // Per-user preferences (cross-device sync of localStorage settings).
  getPreferences: () =>
    request<{ items: Record<string, { value: string | null; updatedAt: string }> }>('/settings/preferences'),
  putPreferences: (items: Record<string, { value: string | null; updatedAt: string }>) =>
    request<{ accepted: number; items: Record<string, { value: string | null; updatedAt: string }> }>(
      '/settings/preferences',
      { method: 'PUT', body: JSON.stringify({ items }) }
    ),
  deletePreference: (key: string) =>
    request<{ success: boolean }>(`/settings/preferences/${encodeURIComponent(key)}`, { method: 'DELETE' }),

  // Admin
  getAdminSettings: () => request<any>('/admin/settings'),
  updateAdminSettings: (data: any) =>
    request('/admin/settings', { method: 'PUT', body: JSON.stringify(data) }),
  getAdminUsers: () => request<any[]>('/admin/users'),
  createAdminUser: (data: any) =>
    request('/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  updateAdminUser: (id: string, data: any) =>
    request(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAdminUser: (id: string) =>
    request(`/admin/users/${id}`, { method: 'DELETE' }),
  adminToggleUserActive: (id: string, isActive: boolean) =>
    request(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ isActive }) }),
  adminSetUserPassword: (id: string, password: string) =>
    request(`/admin/users/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
  adminGenerateResetLink: (id: string) =>
    request<{ resetUrl: string; expiresAt: string; email: string }>(`/admin/users/${id}/reset-link`, { method: 'POST' }),
  adminUnlockUser: (id: string) =>
    request<{ success: boolean }>(`/admin/users/${id}/unlock`, { method: 'POST' }),

  // Security settings & IP lists
  getSecuritySettings: () => request<any>('/admin/security/settings'),
  updateSecuritySettings: (data: any) =>
    request('/admin/security/settings', { method: 'PUT', body: JSON.stringify(data) }),
  getSecurityIpList: () => request<any[]>('/admin/security/ip-list'),
  addSecurityIp: (data: { ipAddress: string; listType: 'whitelist' | 'blacklist'; description?: string }) =>
    request<any>('/admin/security/ip-list', { method: 'POST', body: JSON.stringify(data) }),
  deleteSecurityIp: (id: string) =>
    request<{ success: boolean }>(`/admin/security/ip-list/${id}`, { method: 'DELETE' }),
  getLoginAttempts: (limit = 100) =>
    request<any[]>(`/admin/security/login-attempts?limit=${limit}`),

  getAdminGroups: () => request<any[]>('/admin/groups'),
  createAdminGroup: (data: any) =>
    request('/admin/groups', { method: 'POST', body: JSON.stringify(data) }),
  updateAdminGroup: (id: string, data: any) =>
    request(`/admin/groups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAdminGroup: (id: string) =>
    request(`/admin/groups/${id}`, { method: 'DELETE' }),
  testNextcloud: (url: string, username: string, password: string) =>
    request<any>('/admin/nextcloud/test', { method: 'POST', body: JSON.stringify({ url, username, password }) }),
  getNextcloudStatus: () => request<any>('/admin/nextcloud/status'),
  saveNextcloudConfig: (data: {
    enabled?: boolean; url?: string; adminUsername?: string; adminPassword?: string;
    autoProvision?: boolean; autoCreateCalendars?: boolean; syncIntervalMinutes?: number;
  }) => request('/admin/nextcloud/config', { method: 'PUT', body: JSON.stringify(data) }),
  testSavedNextcloud: () => request<any>('/admin/nextcloud/test', { method: 'POST', body: JSON.stringify({}) }),
  getNextcloudUsers: () => request<any[]>('/admin/nextcloud/users'),
  provisionNextcloudUser: (userId: string) =>
    request<any>(`/admin/nextcloud/users/${userId}/provision`, { method: 'POST' }),
  linkNextcloudUser: (userId: string, ncUsername: string, ncPassword: string) =>
    request(`/admin/nextcloud/users/${userId}/link`, {
      method: 'POST',
      body: JSON.stringify({ ncUsername, ncPassword }),
    }),
  unlinkNextcloudUser: (userId: string) =>
    request(`/admin/nextcloud/users/${userId}`, { method: 'DELETE' }),
  syncNextcloudUser: (userId: string) =>
    request<any>(`/admin/nextcloud/users/${userId}/sync`, { method: 'POST' }),

  // Per-user NextCloud Files (save mail attachments to user's NC drive)
  nextcloudFilesStatus: () =>
    request<{ linked: boolean }>('/nextcloud/files/status'),
  nextcloudFilesList: (path: string = '/') =>
    request<{ path: string; items: Array<{ name: string; path: string; isFolder: boolean; size?: number; contentType?: string }> }>(
      `/nextcloud/files/list?path=${encodeURIComponent(path)}`
    ),
  nextcloudFilesMkdir: (path: string) =>
    request<{ ok: boolean; path: string }>('/nextcloud/files/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  nextcloudFilesGet: (path: string) =>
    request<{ filename: string; contentType: string; contentBase64: string }>(
      `/nextcloud/files/get?path=${encodeURIComponent(path)}`
    ),
  nextcloudFilesUpload: (data: {
    folderPath: string;
    filename: string;
    contentType?: string;
    contentBase64: string;
    overwrite?: boolean;
    ensureFolder?: boolean;
  }) =>
    request<{ ok: boolean; path: string }>('/nextcloud/files/upload', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Calendar sharing / publishing
  shareCalendar: (calendarId: string, payload: { userId?: string; email?: string; permission?: 'read' | 'write' | 'busy' | 'titles' }) =>
    request<any>(`/calendar/${calendarId}/share`, { method: 'POST', body: JSON.stringify(payload) }),
  revokeShareCalendar: (calendarId: string, payload: { userId?: string; email?: string }) =>
    request<any>(`/calendar/${calendarId}/share`, { method: 'DELETE', body: JSON.stringify(payload) }),
  listCalendarShares: (calendarId: string) =>
    request<{ internal: any[]; external: any[] }>(`/calendar/${calendarId}/shares`),
  publishCalendar: (calendarId: string, permission: 'busy' | 'titles' | 'read' = 'read') =>
    request<{ success: boolean; publicUrl: string; htmlUrl: string; icsUrl: string; token: string; permission: string }>(
      `/calendar/${calendarId}/publish`,
      { method: 'POST', body: JSON.stringify({ permission }) }
    ),
  updatePublicLinkPermission: (calendarId: string, permission: 'busy' | 'titles' | 'read') =>
    request<{ success: boolean; htmlUrl: string; icsUrl: string; permission: string; token: string }>(
      `/calendar/${calendarId}/publish`,
      { method: 'PATCH', body: JSON.stringify({ permission }) }
    ),
  unpublishCalendar: (calendarId: string) =>
    request(`/calendar/${calendarId}/publish`, { method: 'DELETE' }),

  // Admin calendars
  getAdminCalendars: () => request<any[]>('/admin/calendars'),
  updateAdminCalendar: (id: string, data: { name?: string; color?: string; isVisible?: boolean; isShared?: boolean; userId?: string }) =>
    request(`/admin/calendars/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAdminCalendar: (id: string) =>
    request(`/admin/calendars/${id}`, { method: 'DELETE' }),
  addAdminCalendarAssignment: (calendarId: string, userId: string, permission: string) =>
    request(`/admin/calendars/${calendarId}/assignments`, { method: 'POST', body: JSON.stringify({ userId, permission }) }),
  updateAdminCalendarAssignment: (calendarId: string, userId: string, permission: string) =>
    request(`/admin/calendars/${calendarId}/assignments/${userId}`, { method: 'PUT', body: JSON.stringify({ permission }) }),
  removeAdminCalendarAssignment: (calendarId: string, userId: string) =>
    request(`/admin/calendars/${calendarId}/assignments/${userId}`, { method: 'DELETE' }),
  exportAdminCalendarIcs: async (id: string) => {
    const token = localStorage.getItem('auth_token');
    const res = await fetch(`${API_BASE}/admin/calendars/${id}/export.ics`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Export échoué');
    return res.blob();
  },
  backupAdminCalendars: async () => {
    const token = localStorage.getItem('auth_token');
    const res = await fetch(`${API_BASE}/admin/calendars/backup`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Sauvegarde échouée');
    return res.blob();
  },
  restoreAdminCalendars: (payload: any, strategy: 'merge' | 'replace' = 'merge') =>
    request<{ ok: boolean; calendars: number; events: number; shares: number }>(
      '/admin/calendars/restore',
      { method: 'POST', body: JSON.stringify({ payload, strategy }) }
    ),
  importAdminCalendarCaldav: (data: { url: string; ownerId: string; username?: string; password?: string; color?: string }) =>
    request<{ ok: boolean; calendars: number; events: number; needsAuth?: boolean }>(
      '/admin/calendars/import-caldav',
      { method: 'POST', body: JSON.stringify(data) }
    ),
  pushAdminCalendarToCaldav: (id: string, mailAccountId: string) =>
    request<{ ok: boolean; url: string; events: number }>(`/admin/calendars/${id}/push-to-caldav`, {
      method: 'POST',
      body: JSON.stringify({ mailAccountId }),
    }),

  // Branding
  getBranding: () => request<{
    app_name: string;
    icons: { favicon: string; icon192: string; icon512: string; apple: string };
    custom: { favicon: boolean; icon192: boolean; icon512: boolean; apple: boolean };
    login_appearance: {
      title: string | null;
      subtitle: string | null;
      backgroundColor: string | null;
      backgroundImage: string | null;
      backgroundBlur: number;
      backgroundOverlay: string | null;
      cardBgColor: string | null;
      cardTextColor: string | null;
      accentColor: string | null;
      accentHoverColor: string | null;
      showRegister: boolean;
      showPasskeyButton: boolean;
      showForgotPassword: boolean;
    };
  }>('/branding'),
  uploadBrandingIcon: async (type: 'favicon' | 'icon192' | 'icon512' | 'apple', file: File) => {
    const token = localStorage.getItem('auth_token');
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/admin/branding/${type}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || `Erreur ${res.status}`);
    }
    return res.json();
  },
  resetBrandingIcon: (type: 'favicon' | 'icon192' | 'icon512' | 'apple') =>
    request(`/admin/branding/${type}`, { method: 'DELETE' }),

  uploadLoginBackground: async (file: File) => {
    const token = localStorage.getItem('auth_token');
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/admin/branding/login-background/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || `Erreur ${res.status}`);
    }
    return res.json() as Promise<{ success: boolean; filename: string }>;
  },
  deleteLoginBackground: () =>
    request<{ success: boolean }>('/admin/branding/login-background', { method: 'DELETE' }),

  // Admin Mail Accounts
  getAdminMailAccounts: () => request<any[]>('/admin/mail-accounts'),
  createAdminMailAccount: (data: any) =>
    request('/admin/mail-accounts', { method: 'POST', body: JSON.stringify(data) }),
  updateAdminMailAccount: (id: string, data: any) =>
    request(`/admin/mail-accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAdminMailAccount: (id: string) =>
    request(`/admin/mail-accounts/${id}`, { method: 'DELETE' }),
  testAdminMailAccount: (id: string) =>
    request<{ success: boolean; error?: string }>(`/admin/mail-accounts/${id}/test`, { method: 'POST' }),
  startAdminMailAccountOAuth: (provider: 'microsoft', loginHint?: string, forceConsent?: boolean) =>
    request<{ url: string; state: string }>(`/admin/mail-accounts/oauth/${provider}/start`, {
      method: 'POST',
      body: JSON.stringify({ loginHint, forceConsent }),
    }),
  getMicrosoftOAuthSettings: () =>
    request<{
      configured: boolean;
      clientId: string;
      hasClientSecret: boolean;
      tenant: string;
      redirectUri: string;
      sources: {
        clientId: 'env' | 'db' | 'none';
        clientSecret: 'env' | 'db' | 'none';
        tenant: 'env' | 'db' | 'default';
        redirectUri: 'env' | 'db' | 'default';
      };
      db: { clientId: string; hasClientSecret: boolean; tenant: string; redirectUri: string };
    }>('/admin/oauth-settings/microsoft'),
  saveMicrosoftOAuthSettings: (data: {
    clientId?: string;
    clientSecret?: string;
    clearClientSecret?: boolean;
    tenant?: string;
    redirectUri?: string;
  }) =>
    request('/admin/oauth-settings/microsoft', { method: 'PUT', body: JSON.stringify(data) }),
  getMailAccountAssignments: (accountId: string) =>
    request<any[]>(`/admin/mail-accounts/${accountId}/assignments`),
  createMailAccountAssignment: (accountId: string, data: any) =>
    request(`/admin/mail-accounts/${accountId}/assignments`, { method: 'POST', body: JSON.stringify(data) }),
  updateMailAccountAssignment: (accountId: string, assignmentId: string, data: any) =>
    request(`/admin/mail-accounts/${accountId}/assignments/${assignmentId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMailAccountAssignment: (accountId: string, assignmentId: string) =>
    request(`/admin/mail-accounts/${accountId}/assignments/${assignmentId}`, { method: 'DELETE' }),

  // Plugins
  getPlugins: () => request<any[]>('/plugins'),
  getPluginConfig: (pluginId: string) => request<any>(`/plugins/${pluginId}/config`),
  executePlugin: (pluginId: string, action: string, data: any) =>
    request(`/plugins/${pluginId}/execute`, { method: 'POST', body: JSON.stringify({ action, data }) }),

  getAllPlugins: () => request<any[]>('/plugins/admin/all'),
  installPlugin: (data: any) =>
    request('/plugins/admin/install', { method: 'POST', body: JSON.stringify(data) }),
  togglePlugin: (pluginId: string) =>
    request(`/plugins/admin/${pluginId}/toggle`, { method: 'PUT' }),
  deletePlugin: (pluginId: string) =>
    request(`/plugins/admin/${pluginId}`, { method: 'DELETE' }),
  assignPlugin: (pluginId: string, data: any) =>
    request(`/plugins/admin/${pluginId}/assign`, { method: 'POST', body: JSON.stringify(data) }),

  // Search
  search: (q: string, opts?: {
    type?: string;
    folder?: string;
    accountId?: string;
    dateFrom?: string;
    dateTo?: string;
    from?: string;
    hasAttachment?: 'true' | 'false';
    isRead?: 'true' | 'false';
    calendarId?: string;
    limit?: number;
    offset?: number;
  }) => {
    const params = new URLSearchParams({ q });
    if (opts?.type) params.set('type', opts.type);
    if (opts?.folder) params.set('folder', opts.folder);
    if (opts?.accountId) params.set('accountId', opts.accountId);
    if (opts?.dateFrom) params.set('dateFrom', opts.dateFrom);
    if (opts?.dateTo) params.set('dateTo', opts.dateTo);
    if (opts?.from) params.set('from', opts.from);
    if (opts?.hasAttachment) params.set('hasAttachment', opts.hasAttachment);
    if (opts?.isRead) params.set('isRead', opts.isRead);
    if (opts?.calendarId) params.set('calendarId', opts.calendarId);
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    return request<{ emails: any[]; contacts: any[]; events: any[]; totals: { emails: number; contacts: number; events: number } }>(`/search?${params.toString()}`);
  },

  // Admin Dashboard
  getAdminDashboard: () => request<any>('/admin/dashboard'),

  // Admin Logs
  getAdminLogs: (params?: { category?: string; action?: string; userId?: string; from?: string; to?: string; page?: number; limit?: number; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.category) query.set('category', params.category);
    if (params?.action) query.set('action', params.action);
    if (params?.userId) query.set('userId', params.userId);
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    if (params?.page) query.set('page', params.page.toString());
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.search) query.set('search', params.search);
    return request<{ logs: any[]; total: number; page: number; totalPages: number }>(`/admin/logs?${query}`);
  },
  getAdminLogCategories: () => request<string[]>('/admin/logs/categories'),
  exportAdminLogs: (params?: { format?: string; category?: string; action?: string; userId?: string; from?: string; to?: string; search?: string }) => {
    const q = new URLSearchParams();
    if (params?.format) q.set('format', params.format);
    if (params?.category) q.set('category', params.category);
    if (params?.action) q.set('action', params.action);
    if (params?.userId) q.set('userId', params.userId);
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    if (params?.search) q.set('search', params.search);
    return `/admin/logs/export?${q}`;
  },
  emailAdminLogs: (data: { to: string; category?: string; action?: string; userId?: string; from?: string; dateTo?: string; search?: string; limit?: number }) =>
    request<{ success: boolean; count: number }>('/admin/logs/email', { method: 'POST', body: JSON.stringify(data) }),

  // Log Alert Rules
  getLogAlerts: () => request<any[]>('/admin/log-alerts'),
  createLogAlert: (data: any) => request<any>('/admin/log-alerts', { method: 'POST', body: JSON.stringify(data) }),
  updateLogAlert: (id: string, data: any) => request<any>(`/admin/log-alerts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLogAlert: (id: string) => request(`/admin/log-alerts/${id}`, { method: 'DELETE' }),

  // SMTP Configuration
  getSmtpConfig: () => request<any>('/admin/smtp'),
  updateSmtpConfig: (data: any) => request<{ success: boolean }>('/admin/smtp', { method: 'PUT', body: JSON.stringify(data) }),
  testSmtpConfig: (data: any) => request<{ success: boolean; message: string }>('/admin/smtp/test', { method: 'POST', body: JSON.stringify(data) }),

  // System Email Templates
  getSystemTemplates: () => request<any[]>('/admin/system-templates'),
  createSystemTemplate: (data: any) => request<any>('/admin/system-templates', { method: 'POST', body: JSON.stringify(data) }),
  updateSystemTemplate: (id: string, data: any) => request<any>(`/admin/system-templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSystemTemplate: (id: string) => request(`/admin/system-templates/${id}`, { method: 'DELETE' }),
  testSystemTemplate: (id: string, data: { testTo: string; variables?: Record<string, string> }) =>
    request<{ success: boolean; message: string }>(`/admin/system-templates/${id}/test`, { method: 'POST', body: JSON.stringify(data) }),

  // O2Switch
  getO2SwitchAccounts: () => request<any[]>('/admin/o2switch/accounts'),
  createO2SwitchAccount: (data: any) =>
    request('/admin/o2switch/accounts', { method: 'POST', body: JSON.stringify(data) }),
  updateO2SwitchAccount: (id: string, data: any) =>
    request(`/admin/o2switch/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteO2SwitchAccount: (id: string) =>
    request(`/admin/o2switch/accounts/${id}`, { method: 'DELETE' }),
  testO2SwitchConnection: (id: string) =>
    request<{ success: boolean; error?: string }>(`/admin/o2switch/accounts/${id}/test`, { method: 'POST' }),
  getO2SwitchEmails: (id: string) => request<any[]>(`/admin/o2switch/accounts/${id}/emails`),
  getO2SwitchDomains: (id: string) => request<any[]>(`/admin/o2switch/accounts/${id}/domains`),
  createO2SwitchEmail: (id: string, data: any) =>
    request(`/admin/o2switch/accounts/${id}/emails`, { method: 'POST', body: JSON.stringify(data) }),
  updateO2SwitchEmail: (id: string, email: string, data: any) =>
    request(`/admin/o2switch/accounts/${id}/emails/${encodeURIComponent(email)}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteO2SwitchEmail: (id: string, email: string) =>
    request(`/admin/o2switch/accounts/${id}/emails/${encodeURIComponent(email)}`, { method: 'DELETE' }),
  syncO2Switch: (id: string) =>
    request<{ success: boolean; created: number; skipped: number; total: number }>(`/admin/o2switch/accounts/${id}/sync`, { method: 'POST' }),
  linkO2SwitchEmail: (id: string, data: any) =>
    request(`/admin/o2switch/accounts/${id}/link`, { method: 'POST', body: JSON.stringify(data) }),
  getO2SwitchLinks: (id: string) => request<any[]>(`/admin/o2switch/accounts/${id}/links`),
  getO2SwitchDisk: (id: string) => request<any>(`/admin/o2switch/accounts/${id}/disk`),

  // Auto-responder (vacation responder)
  getAutoResponder: (accountId: string) =>
    request<{
      accountId: string;
      enabled: boolean;
      subject: string;
      bodyHtml: string;
      bodyText: string;
      scheduled: boolean;
      startAt: string | null;
      endAt: string | null;
      onlyContacts: boolean;
      forwardTo: string[];
      updatedAt: string | null;
    }>(`/auto-responder/account/${accountId}`),

  saveAutoResponder: (accountId: string, data: {
    enabled: boolean;
    subject: string;
    bodyHtml: string;
    bodyText?: string;
    scheduled: boolean;
    startAt: string | null;
    endAt: string | null;
    onlyContacts: boolean;
    forwardTo: string[];
  }) =>
    request<{ success: boolean }>(`/auto-responder/account/${accountId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // Auto-responder admin endpoints
  adminListAutoResponders: (activeOnly = false) =>
    request<Array<{
      id: string;
      accountId: string;
      accountEmail: string;
      accountName: string;
      userId: string;
      userEmail: string;
      userDisplayName: string | null;
      enabled: boolean;
      subject: string;
      scheduled: boolean;
      startAt: string | null;
      endAt: string | null;
      onlyContacts: boolean;
      createdAt: string | null;
      updatedAt: string | null;
    }>>(`/admin/auto-responders${activeOnly ? '?activeOnly=1' : ''}`),

  adminListAutoResponderCandidates: (q?: string) =>
    request<Array<{
      accountId: string;
      accountEmail: string;
      accountName: string;
      userId: string;
      userEmail: string;
      userDisplayName: string | null;
    }>>(`/admin/auto-responders/candidates${q ? `?q=${encodeURIComponent(q)}` : ''}`),

  adminGetAutoResponder: (accountId: string) =>
    request<{
      accountId: string;
      enabled: boolean;
      subject: string;
      bodyHtml: string;
      bodyText: string;
      scheduled: boolean;
      startAt: string | null;
      endAt: string | null;
      onlyContacts: boolean;
      forwardTo: string[];
      updatedAt: string | null;
    }>(`/admin/auto-responders/account/${accountId}`),

  adminSaveAutoResponder: (accountId: string, data: {
    enabled: boolean;
    subject: string;
    bodyHtml: string;
    bodyText?: string;
    scheduled: boolean;
    startAt: string | null;
    endAt: string | null;
    onlyContacts: boolean;
    forwardTo: string[];
  }) =>
    request<{ success: boolean }>(`/admin/auto-responders/account/${accountId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  adminDisableAutoResponder: (accountId: string) =>
    request<{ success: boolean }>(`/admin/auto-responders/account/${accountId}`, {
      method: 'DELETE',
    }),

  // Auto-responder feature settings (read for any user, write admin-only)
  getAutoResponderFeatureSettings: () =>
    request<{ enabled: boolean; defaultIntervalMinutes: number; cooldownDays?: number }>(`/auto-responder/feature-settings`),

  adminGetAutoResponderFeatureSettings: () =>
    request<{ enabled: boolean; defaultIntervalMinutes: number; cooldownDays: number }>(`/admin/auto-responders/feature-settings`),

  adminSaveAutoResponderFeatureSettings: (data: { enabled?: boolean; defaultIntervalMinutes?: number; cooldownDays?: number }) =>
    request<{ success: boolean }>(`/admin/auto-responders/feature-settings`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  adminResetAutoResponderCounters: (accountId?: string) =>
    request<{ success: boolean; affected: number }>(`/admin/auto-responders/reset-counters`, {
      method: 'POST',
      body: JSON.stringify(accountId ? { accountId } : {}),
    }),

  // ─── Mail templates ─────────────────────────────────────────────────────
  // Reusable subject + body presets. The picker in the ribbon's "Insérer"
  // tab lists everything accessible to the user (owned, global, shared).
  listMailTemplates: () => request<Array<MailTemplate>>('/mail-templates'),
  createMailTemplate: (data: { name: string; subject: string; bodyHtml: string }) =>
    request<MailTemplate>('/mail-templates', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateMailTemplate: (id: string, data: { name: string; subject: string; bodyHtml: string }) =>
    request<MailTemplate>(`/mail-templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteMailTemplate: (id: string) =>
    request<{ success: boolean }>(`/mail-templates/${id}`, { method: 'DELETE' }),
  listMailTemplateShares: (id: string) =>
    request<Array<MailTemplateShare>>(`/mail-templates/${id}/shares`),
  shareMailTemplate: (id: string, data: { userId?: string | null; groupId?: string | null }) =>
    request<{ id: string }>(`/mail-templates/${id}/shares`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  unshareMailTemplate: (id: string, shareId: string) =>
    request<{ success: boolean }>(`/mail-templates/${id}/shares/${shareId}`, { method: 'DELETE' }),

  // Admin-side: every template, ability to mark global, edit any.
  adminListMailTemplates: () => request<Array<MailTemplate>>('/admin/mail-templates'),
  adminCreateMailTemplate: (data: {
    name: string; subject: string; bodyHtml: string;
    isGlobal?: boolean; ownerUserId?: string | null;
  }) =>
    request<MailTemplate>('/admin/mail-templates', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  adminUpdateMailTemplate: (id: string, data: {
    name: string; subject: string; bodyHtml: string;
    isGlobal?: boolean; ownerUserId?: string | null;
  }) =>
    request<MailTemplate>(`/admin/mail-templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  adminDeleteMailTemplate: (id: string) =>
    request<{ success: boolean }>(`/admin/mail-templates/${id}`, { method: 'DELETE' }),
  adminListMailTemplateShares: (id: string) =>
    request<Array<MailTemplateShare>>(`/admin/mail-templates/${id}/shares`),
  adminShareMailTemplate: (id: string, data: { userId?: string | null; groupId?: string | null }) =>
    request<{ id: string }>(`/admin/mail-templates/${id}/shares`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  adminUnshareMailTemplate: (id: string, shareId: string) =>
    request<{ success: boolean }>(`/admin/mail-templates/${id}/shares/${shareId}`, { method: 'DELETE' }),

  // ─── Mail rules (Outlook-style) ────────────────────────────────────────
  listMailRules: () => request<Array<MailRule>>('/rules'),
  createMailRule: (data: MailRuleUpsert) =>
    request<MailRule>('/rules', { method: 'POST', body: JSON.stringify(data) }),
  updateMailRule: (id: string, data: MailRuleUpsert) =>
    request<MailRule>(`/rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMailRule: (id: string) =>
    request<{ success: boolean }>(`/rules/${id}`, { method: 'DELETE' }),
  toggleMailRule: (id: string, enabled?: boolean) =>
    request<{ success: boolean; enabled: boolean }>(`/rules/${id}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  renameMailRule: (id: string, name: string) =>
    request<{ success: boolean }>(`/rules/${id}/rename`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  reorderMailRules: (ids: string[]) =>
    request<{ success: boolean }>(`/rules/reorder`, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  listMailRuleShares: (id: string) =>
    request<Array<MailRuleShare>>(`/rules/${id}/shares`),
  shareMailRule: (id: string, data: { userId?: string | null; groupId?: string | null }) =>
    request<{ id: string }>(`/rules/${id}/shares`, { method: 'POST', body: JSON.stringify(data) }),
  unshareMailRule: (id: string, shareId: string) =>
    request<{ success: boolean }>(`/rules/${id}/shares/${shareId}`, { method: 'DELETE' }),

  // Admin
  adminListMailRules: (params: { view?: 'all' | 'user' | 'group'; q?: string; userId?: string; groupId?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.view) q.set('view', params.view);
    if (params.q) q.set('q', params.q);
    if (params.userId) q.set('userId', params.userId);
    if (params.groupId) q.set('groupId', params.groupId);
    const qs = q.toString();
    return request<AdminMailRulesResponse>(`/admin/rules${qs ? `?${qs}` : ''}`);
  },
  adminUpdateMailRule: (id: string, data: MailRuleUpsert) =>
    request<MailRule>(`/admin/rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  adminToggleMailRule: (id: string, enabled?: boolean) =>
    request<{ success: boolean; enabled: boolean }>(`/admin/rules/${id}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  adminDeleteMailRule: (id: string) =>
    request<{ success: boolean }>(`/admin/rules/${id}`, { method: 'DELETE' }),
  adminMailRulesDirectory: () =>
    request<{
      users: Array<{ id: string; email: string; displayName: string | null; isAdmin: boolean }>;
      groups: Array<{ id: string; name: string }>;
    }>(`/admin/rules/directory`),
};

// ─── Mail rules types (mirrors server/src/services/mailRules.ts) ───────
export type MailRuleConditionType =
  | 'fromContains' | 'toContains' | 'ccContains'
  | 'subjectContains' | 'subjectOrBodyContains' | 'bodyContains'
  | 'recipientAddressContains' | 'senderAddressContains' | 'headerContains'
  | 'hasAttachment' | 'importance' | 'sensitivity'
  | 'sentOnlyToMe' | 'myNameInTo' | 'myNameInCc' | 'myNameInToOrCc' | 'myNameNotInTo'
  | 'flagged' | 'sizeAtLeast';

export type MailRuleActionType =
  | 'moveToFolder' | 'copyToFolder' | 'delete' | 'permanentlyDelete'
  | 'markAsRead' | 'markAsUnread' | 'flag' | 'unflag'
  | 'forwardTo' | 'redirectTo' | 'replyWithTemplate'
  | 'assignCategory'
  | 'stopProcessingMoreRules';

export interface MailRuleCondition {
  type: MailRuleConditionType;
  value?: string;
  headerName?: string;
  level?: string;
  bytes?: number;
}
export interface MailRuleAction {
  type: MailRuleActionType;
  folder?: string;
  to?: string;
  templateId?: string;
  /** Local category id (client-side localStorage) for `assignCategory`. */
  categoryId?: string;
  /** Category display name, used as a fallback if the id is unknown locally. */
  categoryName?: string;
}

export interface MailRule {
  id: string;
  userId: string;
  accountId: string | null;
  name: string;
  enabled: boolean;
  position: number;
  matchType: 'all' | 'any';
  stopProcessing: boolean;
  conditions: MailRuleCondition[];
  exceptions: MailRuleCondition[];
  actions: MailRuleAction[];
  createdAt: string | null;
  updatedAt: string | null;
  // Listing extras
  sharedIn?: boolean;
  ownerDisplayName?: string | null;
  ownerEmail?: string | null;
  // Admin extras
  userEmail?: string;
  userDisplayName?: string | null;
  groupIds?: string[];
  groupNames?: string[];
}

export interface MailRuleUpsert {
  name: string;
  enabled?: boolean;
  matchType?: 'all' | 'any';
  stopProcessing?: boolean;
  accountId?: string | null;
  conditions?: MailRuleCondition[];
  exceptions?: MailRuleCondition[];
  actions: MailRuleAction[];
}

export interface MailRuleShare {
  id: string;
  userId: string | null;
  groupId: string | null;
  userEmail: string | null;
  userDisplayName: string | null;
  groupName: string | null;
}

export type AdminMailRulesResponse =
  | { view: 'all'; rules: MailRule[] }
  | { view: 'user'; groups: Array<{ kind: 'user'; userId: string; userEmail: string; userDisplayName: string | null; rules: MailRule[] }> }
  | { view: 'group'; groups: Array<{ kind: 'group'; groupId: string; groupName: string; rules: MailRule[] }> };


export interface MailTemplate {
  id: string;
  ownerUserId: string | null;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  name: string;
  subject: string;
  bodyHtml: string;
  isGlobal: boolean;
  /** 'owned' | 'global' | 'shared' — only meaningful for the user-side list. */
  scope: 'owned' | 'global' | 'shared';
  createdAt: string;
  updatedAt: string;
}

export interface MailTemplateShare {
  id: string;
  userId: string | null;
  groupId: string | null;
  userEmail: string | null;
  userDisplayName: string | null;
  groupName: string | null;
}
