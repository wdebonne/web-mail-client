import { pool } from '../database/connection';
import { logger } from '../utils/logger';
import path from 'path';
import fs from 'fs';

interface PluginDefinition {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  entryPoint: string;
  config: Record<string, any>;
  isActive: boolean;
}

interface PluginInstance {
  definition: PluginDefinition;
  module: any;
}

export class PluginManager {
  private static instance: PluginManager;
  private plugins: Map<string, PluginInstance> = new Map();

  static getInstance(): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager();
    }
    return PluginManager.instance;
  }

  async loadPlugins() {
    try {
      const result = await pool.query('SELECT * FROM plugins WHERE is_active = true');
      
      this.plugins.clear();

      for (const row of result.rows) {
        try {
          const pluginDir = path.join(process.cwd(), 'plugins', row.name);
          
          if (row.entry_point && fs.existsSync(path.join(pluginDir, row.entry_point))) {
            const module = require(path.join(pluginDir, row.entry_point));
            
            if (module.initialize) {
              await module.initialize(row.config);
            }

            this.plugins.set(row.id, {
              definition: {
                id: row.id,
                name: row.name,
                displayName: row.display_name,
                description: row.description,
                version: row.version,
                entryPoint: row.entry_point,
                config: row.config,
                isActive: row.is_active,
              },
              module,
            });

            logger.info(`Plugin loaded: ${row.display_name || row.name}`);
          }
        } catch (error) {
          logger.error(error as Error, `Failed to load plugin ${row.name}`);
        }
      }
    } catch (error) {
      logger.error(error as Error, 'Failed to load plugins');
    }
  }

  async executeAction(pluginId: string, action: string, data: any, userId: string): Promise<any> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error('Plugin non trouvé ou non actif');
    }

    if (!plugin.module[action]) {
      throw new Error(`Action '${action}' non trouvée dans le plugin`);
    }

    // Check user access
    const access = await pool.query(
      `SELECT pa.id FROM plugin_assignments pa
       LEFT JOIN user_groups ug ON ug.group_id = pa.group_id
       WHERE pa.plugin_id = $1 AND (pa.user_id = $2 OR ug.user_id = $2)
       LIMIT 1`,
      [pluginId, userId]
    );

    // If no assignments exist, plugin is available to all
    const hasAssignments = await pool.query(
      'SELECT COUNT(*) FROM plugin_assignments WHERE plugin_id = $1',
      [pluginId]
    );

    if (parseInt(hasAssignments.rows[0].count) > 0 && access.rows.length === 0) {
      throw new Error('Accès non autorisé à ce plugin');
    }

    return await plugin.module[action](data, userId, plugin.definition.config);
  }

  getPlugin(pluginId: string): PluginInstance | undefined {
    return this.plugins.get(pluginId);
  }

  getAllPlugins(): PluginDefinition[] {
    return Array.from(this.plugins.values()).map(p => p.definition);
  }
}
