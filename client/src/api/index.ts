const API_BASE = '/api';

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
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
    localStorage.removeItem('auth_token');
    window.location.href = '/';
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

  sendMail: (data: any) =>
    request('/mail/send', { method: 'POST', body: JSON.stringify(data) }),

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

  searchContacts: (q: string) =>
    request<{ contacts: any[]; distributionLists: any[] }>(`/contacts/search/autocomplete?q=${encodeURIComponent(q)}`),

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

  shareCalendar: (id: string, userId: string, permission: string) =>
    request(`/calendar/${id}/share`, { method: 'POST', body: JSON.stringify({ userId, permission }) }),

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
