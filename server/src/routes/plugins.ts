import { Router } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../database/connection';
import { PluginManager } from '../plugins/manager';
import { adminMiddleware } from '../middleware/auth';

export const pluginRouter = Router();

// Get available plugins for current user
pluginRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT p.* FROM plugins p
       LEFT JOIN plugin_assignments pa ON pa.plugin_id = p.id
       LEFT JOIN user_groups ug ON ug.group_id = pa.group_id AND ug.user_id = $1
       WHERE p.is_active = true AND (
         pa.user_id = $1 OR 
         ug.user_id = $1 OR 
         pa.id IS NULL
       )
       ORDER BY p.display_name`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get plugin config for current user
pluginRouter.get('/:pluginId/config', async (req: AuthRequest, res) => {
  try {
    // User-specific config
    const userConfig = await pool.query(
      'SELECT config FROM plugin_assignments WHERE plugin_id = $1 AND user_id = $2',
      [req.params.pluginId, req.userId]
    );

    // Global config
    const globalConfig = await pool.query(
      'SELECT config FROM plugins WHERE id = $1',
      [req.params.pluginId]
    );

    res.json({
      global: globalConfig.rows[0]?.config || {},
      user: userConfig.rows[0]?.config || {},
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Execute plugin action
pluginRouter.post('/:pluginId/execute', async (req: AuthRequest, res) => {
  try {
    const { action, data } = req.body;
    const pluginManager = PluginManager.getInstance();
    const result = await pluginManager.executeAction(req.params.pluginId, action, data, req.userId!);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Admin plugin management ----

// List all plugins (admin)
pluginRouter.get('/admin/all', adminMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, 
        COUNT(DISTINCT CASE WHEN pa.user_id IS NOT NULL THEN pa.id END) as user_assignments,
        COUNT(DISTINCT CASE WHEN pa.group_id IS NOT NULL THEN pa.id END) as group_assignments
       FROM plugins p
       LEFT JOIN plugin_assignments pa ON pa.plugin_id = p.id
       GROUP BY p.id
       ORDER BY p.name`
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Install plugin (admin)
pluginRouter.post('/admin/install', adminMiddleware, async (req: AuthRequest, res) => {
  try {
    const { name, displayName, description, version, author, icon, entryPoint, config } = req.body;

    const result = await pool.query(
      `INSERT INTO plugins (name, display_name, description, version, author, icon, entry_point, config, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
       ON CONFLICT (name) DO UPDATE SET 
         display_name = $2, description = $3, version = $4, author = $5, 
         icon = $6, entry_point = $7, config = $8, updated_at = NOW()
       RETURNING *`,
      [name, displayName, description, version, author, icon, entryPoint, JSON.stringify(config || {})]
    );

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle plugin active state (admin)
pluginRouter.put('/admin/:pluginId/toggle', adminMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'UPDATE plugins SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1 RETURNING *',
      [req.params.pluginId]
    );
    
    if (result.rows.length === 0) return res.status(404).json({ error: 'Plugin non trouvé' });

    // Reload plugins
    const pluginManager = PluginManager.getInstance();
    await pluginManager.loadPlugins();

    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update plugin config (admin)
pluginRouter.put('/admin/:pluginId/config', adminMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'UPDATE plugins SET config = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [JSON.stringify(req.body.config), req.params.pluginId]
    );
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete plugin (admin)
pluginRouter.delete('/admin/:pluginId', adminMiddleware, async (req: AuthRequest, res) => {
  try {
    await pool.query('DELETE FROM plugins WHERE id = $1 AND is_system = false', [req.params.pluginId]);
    
    const pluginManager = PluginManager.getInstance();
    await pluginManager.loadPlugins();

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Assign plugin to user(s) or group(s) (admin)
pluginRouter.post('/admin/:pluginId/assign', adminMiddleware, async (req: AuthRequest, res) => {
  try {
    const { userIds, groupIds, config } = req.body;
    const pluginId = req.params.pluginId;

    if (userIds?.length) {
      for (const userId of userIds) {
        await pool.query(
          `INSERT INTO plugin_assignments (plugin_id, user_id, config)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [pluginId, userId, JSON.stringify(config || {})]
        );
      }
    }

    if (groupIds?.length) {
      for (const groupId of groupIds) {
        await pool.query(
          `INSERT INTO plugin_assignments (plugin_id, group_id, config)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [pluginId, groupId, JSON.stringify(config || {})]
        );
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Remove plugin assignment (admin)
pluginRouter.delete('/admin/:pluginId/assign/:assignmentId', adminMiddleware, async (req: AuthRequest, res) => {
  try {
    await pool.query('DELETE FROM plugin_assignments WHERE id = $1 AND plugin_id = $2', [req.params.assignmentId, req.params.pluginId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
