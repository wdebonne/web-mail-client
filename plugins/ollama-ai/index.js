const http = require('http');
const https = require('https');

class OllamaAIPlugin {
  constructor() {
    this.name = 'ollama-ai';
    this.config = {};
  }

  init(config) {
    this.config = config || {};
    this.ollamaUrl = this.config.ollamaUrl || 'http://localhost:11434';
    this.model = this.config.model || 'llama3';
    this.language = this.config.language || 'fr';
  }

  async executeAction(action, data) {
    const handlers = {
      summarize: () => this.summarize(data),
      reply_suggest: () => this.replySuggest(data),
      translate: () => this.translate(data),
      improve: () => this.improve(data),
    };

    const handler = handlers[action];
    if (!handler) {
      throw new Error(`Action inconnue: ${action}`);
    }

    return handler();
  }

  async summarize(data) {
    const { subject, bodyText } = data;
    const prompt = `Résume cet email de manière concise en ${this.language === 'fr' ? 'français' : 'anglais'}.

Objet: ${subject}
Contenu: ${bodyText}

Résumé:`;

    const response = await this.callOllama(prompt);
    return { result: response, type: 'summary' };
  }

  async replySuggest(data) {
    const { subject, bodyText, senderName, tone } = data;
    const toneLabel = tone === 'formal' ? 'formel' : tone === 'friendly' ? 'amical' : 'professionnel';
    
    const prompt = `Propose une réponse ${toneLabel} en ${this.language === 'fr' ? 'français' : 'anglais'} à cet email.

De: ${senderName}
Objet: ${subject}
Contenu: ${bodyText}

Réponse suggérée:`;

    const response = await this.callOllama(prompt);
    return { result: response, type: 'reply' };
  }

  async translate(data) {
    const { text, targetLanguage } = data;
    const langNames = { fr: 'français', en: 'anglais', de: 'allemand', es: 'espagnol', it: 'italien' };
    const targetName = langNames[targetLanguage] || targetLanguage;

    const prompt = `Traduis le texte suivant en ${targetName}. Ne fournis que la traduction, sans commentaire.

Texte: ${text}

Traduction:`;

    const response = await this.callOllama(prompt);
    return { result: response, type: 'translation' };
  }

  async improve(data) {
    const { text, style } = data;
    const styleLabel = style === 'formal' ? 'plus formel' : style === 'concise' ? 'plus concis' : 'plus professionnel';

    const prompt = `Améliore le texte suivant pour le rendre ${styleLabel}. Corrige les fautes et améliore la formulation. Fournis uniquement le texte amélioré.

Texte original: ${text}

Texte amélioré:`;

    const response = await this.callOllama(prompt);
    return { result: response, type: 'improved' };
  }

  async callOllama(prompt) {
    const url = new URL('/api/generate', this.ollamaUrl);
    const payload = JSON.stringify({
      model: this.model,
      prompt,
      stream: false,
      options: {
        temperature: 0.7,
        num_predict: 512,
      },
    });

    return new Promise((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;
      const req = client.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 60000,
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(data.response || '');
          } catch (e) {
            reject(new Error('Réponse Ollama invalide'));
          }
        });
      });

      req.on('error', (e) => {
        reject(new Error(`Impossible de contacter Ollama: ${e.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Ollama timeout'));
      });

      req.write(payload);
      req.end();
    });
  }
}

module.exports = OllamaAIPlugin;
