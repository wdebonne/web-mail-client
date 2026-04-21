import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User } from '../types';
import { api } from '../api';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  updateUser: (updates: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: false,

      login: async (email: string, password: string) => {
        set({ isLoading: true });
        try {
          const response = await api.login(email, password);
          localStorage.setItem('auth_token', response.token);
          set({ user: response.user, token: response.token, isLoading: false });
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      register: async (email: string, password: string, displayName: string) => {
        set({ isLoading: true });
        try {
          const response = await api.register(email, password, displayName);
          localStorage.setItem('auth_token', response.token);
          set({ user: response.user, token: response.token, isLoading: false });
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      logout: async () => {
        try {
          await api.logout();
        } catch {}
        localStorage.removeItem('auth_token');
        set({ user: null, token: null });
      },

      checkAuth: async () => {
        const token = get().token;
        if (!token) {
          set({ user: null, isLoading: false });
          return;
        }

        if (!localStorage.getItem('auth_token')) {
          localStorage.setItem('auth_token', token);
        }

        set({ isLoading: true });
        try {
          const user = await api.getMe();
          set({ user, isLoading: false });
        } catch {
          // If offline, keep the cached user
          const currentUser = get().user;
          if (currentUser && !navigator.onLine) {
            set({ isLoading: false });
          } else {
            localStorage.removeItem('auth_token');
            set({ user: null, token: null, isLoading: false });
          }
        }
      },

      updateUser: (updates: Partial<User>) => {
        const user = get().user;
        if (user) {
          set({ user: { ...user, ...updates } });
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);
