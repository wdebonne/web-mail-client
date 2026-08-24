import { Router } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  getAiConfig, runAction, AiError, logAiFailure, type AiAction,
} from '../services/aiService';

export const aiRouter = Router();

const ACTIONS: AiAction[] = ['summarize', 'reply', 'improve'];

/**
 * État de l'assistant tel que le front doit l'afficher. Aucune information de
 * connexion ne sort d'ici : l'URL et la clé d'API restent côté serveur, seuls
 * le nom du modèle et les fonctions actives sont utiles à l'interface.
 */
aiRouter.get('/status', async (_req: AuthRequest, res) => {
  try {
    const cfg = await getAiConfig();
    res.json({
      enabled: cfg.enabled,
      model: cfg.enabled ? cfg.model : null,
      language: cfg.language,
      features: cfg.enabled ? cfg.features : { summarize: false, reply: false, improve: false },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

aiRouter.post('/:action', async (req: AuthRequest, res) => {
  const action = req.params.action as AiAction;

  if (!ACTIONS.includes(action)) {
    return res.status(404).json({ error: `Action IA inconnue : ${req.params.action}` });
  }

  try {
    const cfg = await getAiConfig();
    if (!cfg.enabled) {
      return res.status(503).json({ error: "L'assistant IA est désactivé. Un administrateur peut l'activer dans Administration → Assistant IA." });
    }
    if (!cfg.features[action]) {
      return res.status(403).json({ error: 'Cette fonction IA a été désactivée par un administrateur.' });
    }

    const body = req.body ?? {};
    const source = action === 'improve' ? body.text : body.body;
    if (typeof source !== 'string' || !source.trim()) {
      return res.status(400).json({ error: 'Aucun texte à traiter.' });
    }

    const result = await runAction(cfg, action, body);
    res.json({ result, model: cfg.model });
  } catch (e: any) {
    logAiFailure(action, e);
    const status = e instanceof AiError ? e.status : 500;
    res.status(status).json({ error: e.message ?? 'Erreur IA' });
  }
});
