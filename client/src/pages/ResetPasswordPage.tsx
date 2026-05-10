import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Lock, CheckCircle, AlertCircle } from 'lucide-react';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const mismatch = confirm.length > 0 && password !== confirm;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismatch || password.length < 8) return;
    setLoading(true);
    setError('');
    try {
      await api.authResetPassword(token, password);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-outlook-bg-primary flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-outlook-blue/10 flex items-center justify-center">
            <Lock size={20} className="text-outlook-blue" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Nouveau mot de passe</h1>
            <p className="text-xs text-outlook-text-secondary">Choisissez un mot de passe sécurisé</p>
          </div>
        </div>

        {!token && (
          <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg p-3">
            <AlertCircle size={16} />
            <span>Lien invalide ou incomplet.</span>
          </div>
        )}

        {success ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-600 text-sm bg-green-50 rounded-lg p-3">
              <CheckCircle size={16} />
              <span>Mot de passe mis à jour avec succès !</span>
            </div>
            <button
              onClick={() => navigate('/', { replace: true })}
              className="w-full bg-outlook-blue hover:bg-outlook-blue-hover text-white py-2 rounded-lg text-sm font-medium"
            >
              Se connecter
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg p-3">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}
            <div>
              <label className="text-xs text-outlook-text-secondary block mb-1">Nouveau mot de passe</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                disabled={!token}
                className="w-full border border-outlook-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-outlook-blue/30"
                placeholder="8 caractères minimum"
              />
            </div>
            <div>
              <label className="text-xs text-outlook-text-secondary block mb-1">Confirmer</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                disabled={!token}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-outlook-blue/30 ${mismatch ? 'border-red-400' : 'border-outlook-border'}`}
              />
              {mismatch && <p className="text-xs text-red-500 mt-1">Les mots de passe ne correspondent pas</p>}
            </div>
            <button
              type="submit"
              disabled={loading || !token || mismatch || password.length < 8}
              className="w-full bg-outlook-blue hover:bg-outlook-blue-hover text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'Mise à jour...' : 'Mettre à jour le mot de passe'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
