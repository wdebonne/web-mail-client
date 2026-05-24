import { Router, Request, Response } from 'express';

const router = Router();

const LIBRETRANSLATE_URL = (process.env.LIBRETRANSLATE_URL || 'https://libretranslate.com').replace(/\/$/, '');
const LIBRETRANSLATE_API_KEY = process.env.LIBRETRANSLATE_API_KEY || '';
const MAX_CHARS = 10_000;

router.post('/', async (req: Request, res: Response) => {
  const { text, targetLang, sourceLang } = req.body as {
    text?: unknown;
    targetLang?: unknown;
    sourceLang?: unknown;
  };

  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Missing text' });
    return;
  }
  if (typeof targetLang !== 'string' || !targetLang) {
    res.status(400).json({ error: 'Missing targetLang' });
    return;
  }

  const payload: Record<string, string> = {
    q: text.slice(0, MAX_CHARS),
    source: typeof sourceLang === 'string' && sourceLang ? sourceLang : 'auto',
    target: targetLang,
    format: 'text',
  };
  if (LIBRETRANSLATE_API_KEY) payload.api_key = LIBRETRANSLATE_API_KEY;

  try {
    const upstream = await fetch(`${LIBRETRANSLATE_URL}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    const data = await upstream.json().catch(() => null) as {
      translatedText?: string;
      detectedLanguage?: { language: string; confidence: number };
      error?: string;
    } | null;

    if (!upstream.ok || !data) {
      res.status(502).json({ error: data?.error || `LibreTranslate returned ${upstream.status}` });
      return;
    }
    if (data.error) {
      res.status(502).json({ error: data.error });
      return;
    }

    res.json({
      translatedText: data.translatedText ?? '',
      detectedLanguage: data.detectedLanguage?.language ?? null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Translation failed';
    res.status(502).json({ error: msg });
  }
});

export { router as translateRouter };
