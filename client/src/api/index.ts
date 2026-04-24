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
    const error = await response.json().catch(() => ({ error: 'Erreur réseau' }));
    throw new Error(error.error || `Erreur ${response.status}`);
  }

  return response.json();
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<{ token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (email: string, password: string, displayName: string) =>
    request<{ token: string; user: any }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    }),

  logout: () => request('/auth/logout', { method: 'POST' }),

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
  search: (q: string, type?: string) =>
    request<any>(`/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`),

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
};
