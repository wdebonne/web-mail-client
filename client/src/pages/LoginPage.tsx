import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { Mail, Lock, User, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function LoginPage() {
  const { login, register, isLoading } = useAuthStore();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      if (isRegister) {
        await register(email, password, displayName);
      } else {
        await login(email, password);
      }
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue');
    }
  };

  return (
    <div className="h-full flex items-center justify-center bg-gradient-to-br from-outlook-blue to-outlook-blue-dark">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="bg-white rounded-lg shadow-2xl w-full max-w-md p-8">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-outlook-blue rounded-xl flex items-center justify-center mx-auto mb-4">
            <Mail size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-outlook-text-primary">WebMail</h1>
          <p className="text-outlook-text-secondary text-sm mt-1">
            {isRegister ? 'Créer un compte' : 'Connectez-vous à votre messagerie'}
          </p>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: 'auto', marginBottom: 16 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-red-50 border border-red-200 rounded-md p-3 flex items-center gap-2 overflow-hidden"
            >
              <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
              <span className="text-red-700 text-sm">{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
            <div>
              <label className="block text-sm font-medium text-outlook-text-primary mb-1">
                Nom d'affichage
              </label>
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Votre nom"
                  required
                  className="w-full pl-10 pr-4 py-2.5 border border-outlook-border rounded-md text-sm focus:outline-none focus:border-outlook-blue focus:ring-1 focus:ring-outlook-blue"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-outlook-text-primary mb-1">
              Adresse e-mail
            </label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="votre@email.com"
                required
                autoComplete="email"
                className="w-full pl-10 pr-4 py-2.5 border border-outlook-border rounded-md text-sm focus:outline-none focus:border-outlook-blue focus:ring-1 focus:ring-outlook-blue"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-outlook-text-primary mb-1">
              Mot de passe
            </label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={isRegister ? 8 : 6}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                className="w-full pl-10 pr-4 py-2.5 border border-outlook-border rounded-md text-sm focus:outline-none focus:border-outlook-blue focus:ring-1 focus:ring-outlook-blue"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-outlook-blue hover:bg-outlook-blue-hover text-white py-2.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Chargement...' : isRegister ? 'Créer le compte' : 'Se connecter'}
          </button>
        </form>

        <div className="text-center mt-6">
          <button
            onClick={() => { setIsRegister(!isRegister); setError(''); }}
            className="text-outlook-blue hover:text-outlook-blue-hover text-sm"
          >
            {isRegister ? 'Déjà un compte ? Se connecter' : 'Créer un compte'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
