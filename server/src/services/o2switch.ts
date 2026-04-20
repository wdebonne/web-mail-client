import { logger } from '../utils/logger';

interface O2SwitchConfig {
  apiToken: string;
  hostname: string;  // e.g. colorant.o2switch.net
  username: string;  // cPanel username
}

interface CpanelEmailAccount {
  email: string;
  domain: string;
  user: string;
  diskUsed: number;      // bytes
  diskQuota: number;     // MB, 0 = unlimited
  suspended: boolean;
}

interface CpanelDomain {
  domain: string;
  type: 'main' | 'addon' | 'parked' | 'sub';
}

export class O2SwitchService {
  private config: O2SwitchConfig;

  constructor(config: O2SwitchConfig) {
    this.config = config;
  }

  private async cpanelRequest(module: string, func: string, params: Record<string, string> = {}): Promise<any> {
    const url = new URL(`https://${this.config.hostname}:2083/execute/${module}/${func}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `cpanel ${this.config.username}:${this.config.apiToken}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`cPanel API error (${response.status}): ${text}`);
    }

    const data: any = await response.json();
    if (data.status === 0 || data.errors?.length) {
      throw new Error(data.errors?.join(', ') || 'cPanel API returned an error');
    }

    return data;
  }

  // UAPI v3 format
  private async cpanelUAPIRequest(module: string, func: string, params: Record<string, string> = {}): Promise<any> {
    return this.cpanelRequest(module, func, params);
  }

  /**
   * Test the connection to cPanel
   */
  async testConnection(): Promise<{ success: boolean; hostname?: string; version?: string; error?: string }> {
    try {
      // Use the Email module to list email accounts as a connectivity test
      const result = await this.cpanelRequest('Email', 'list_pops');
      return {
        success: true,
        hostname: this.config.hostname,
        version: 'cPanel UAPI',
      };
    } catch (error: any) {
      logger.error(error, 'O2Switch connection test failed');
      return { success: false, error: error.message };
    }
  }

  /**
   * List all email accounts on the cPanel
   */
  async listEmailAccounts(): Promise<CpanelEmailAccount[]> {
    try {
      const result = await this.cpanelRequest('Email', 'list_pops');
      const accounts: CpanelEmailAccount[] = [];

      for (const acc of result.data || []) {
        // Skip the main cPanel account
        if (acc.login === this.config.username) continue;

        const parts = (acc.email || acc.login || '').split('@');
        accounts.push({
          email: acc.email || acc.login,
          domain: parts[1] || '',
          user: parts[0] || acc.login,
          diskUsed: parseInt(acc.humandiskused || '0') || 0,
          diskQuota: parseInt(acc.humandiskquota || '0') || 0,
          suspended: acc.suspended_login === 1,
        });
      }

      return accounts;
    } catch (error: any) {
      logger.error(error, 'Failed to list O2Switch email accounts');
      throw error;
    }
  }

  /**
   * List domains on the cPanel
   */
  async listDomains(): Promise<CpanelDomain[]> {
    try {
      const result = await this.cpanelRequest('DomainInfo', 'list_domains');
      const domains: CpanelDomain[] = [];
      const data = result.data || {};

      if (data.main_domain) {
        domains.push({ domain: data.main_domain, type: 'main' });
      }
      for (const d of data.addon_domains || []) {
        domains.push({ domain: d, type: 'addon' });
      }
      for (const d of data.parked_domains || []) {
        domains.push({ domain: d, type: 'parked' });
      }
      for (const d of data.sub_domains || []) {
        domains.push({ domain: d, type: 'sub' });
      }

      return domains;
    } catch (error: any) {
      logger.error(error, 'Failed to list O2Switch domains');
      throw error;
    }
  }

  /**
   * Create an email account
   */
  async createEmailAccount(email: string, password: string, quotaMB: number = 1024): Promise<boolean> {
    const parts = email.split('@');
    if (parts.length !== 2) throw new Error('Invalid email format');

    await this.cpanelRequest('Email', 'add_pop', {
      email: parts[0],
      domain: parts[1],
      password: password,
      quota: quotaMB.toString(),
    });

    return true;
  }

  /**
   * Update email account password
   */
  async changePassword(email: string, newPassword: string): Promise<boolean> {
    const parts = email.split('@');
    if (parts.length !== 2) throw new Error('Invalid email format');

    await this.cpanelRequest('Email', 'passwd_pop', {
      email: parts[0],
      domain: parts[1],
      password: newPassword,
    });

    return true;
  }

  /**
   * Update email account quota
   */
  async changeQuota(email: string, quotaMB: number): Promise<boolean> {
    const parts = email.split('@');
    if (parts.length !== 2) throw new Error('Invalid email format');

    await this.cpanelRequest('Email', 'edit_pop_quota', {
      email: parts[0],
      domain: parts[1],
      quota: quotaMB.toString(),
    });

    return true;
  }

  /**
   * Suspend an email account
   */
  async suspendAccount(email: string): Promise<boolean> {
    const parts = email.split('@');
    if (parts.length !== 2) throw new Error('Invalid email format');

    await this.cpanelRequest('Email', 'suspend_login', {
      email: parts[0],
      domain: parts[1],
    });

    return true;
  }

  /**
   * Unsuspend an email account
   */
  async unsuspendAccount(email: string): Promise<boolean> {
    const parts = email.split('@');
    if (parts.length !== 2) throw new Error('Invalid email format');

    await this.cpanelRequest('Email', 'unsuspend_login', {
      email: parts[0],
      domain: parts[1],
    });

    return true;
  }

  /**
   * Delete an email account
   */
  async deleteEmailAccount(email: string): Promise<boolean> {
    const parts = email.split('@');
    if (parts.length !== 2) throw new Error('Invalid email format');

    await this.cpanelRequest('Email', 'delete_pop', {
      email: parts[0],
      domain: parts[1],
    });

    return true;
  }

  /**
   * Get disk usage stats for cPanel
   */
  async getDiskUsage(): Promise<{ used: number; available: number; total: number }> {
    try {
      const result = await this.cpanelRequest('Quota', 'get_local_quota_info');
      const data = result.data || {};
      return {
        used: parseInt(data.megabytes_used || '0'),
        available: parseInt(data.megabytes_remain || '0'),
        total: parseInt(data.megabyte_limit || '0'),
      };
    } catch (error: any) {
      logger.error(error, 'Failed to get O2Switch disk usage');
      return { used: 0, available: 0, total: 0 };
    }
  }

  /**
   * Get mail-specific stats
   */
  async getMailStats(): Promise<{ totalAccounts: number; totalDiskUsed: number }> {
    const accounts = await this.listEmailAccounts();
    const totalDiskUsed = accounts.reduce((sum, acc) => sum + acc.diskUsed, 0);
    return {
      totalAccounts: accounts.length,
      totalDiskUsed,
    };
  }
}
