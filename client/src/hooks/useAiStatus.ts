import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

const DISABLED = {
  enabled: false,
  model: null,
  language: 'fr',
  features: { summarize: false, reply: false, improve: false },
};

/**
 * État de l'assistant IA, tel que le serveur l'autorise pour cet utilisateur.
 *
 * Partagé entre la lecture d'un message et la fenêtre de rédaction : une seule
 * requête pour toute la session. Une erreur (assistant absent, serveur en
 * vieille version) est traitée comme « désactivé » — les boutons disparaissent
 * au lieu de faire échouer l'écran.
 */
export function useAiStatus() {
  const { data } = useQuery({
    queryKey: ['ai-status'],
    queryFn: api.getAiStatus,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return data ?? DISABLED;
}
