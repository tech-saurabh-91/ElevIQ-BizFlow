import { create } from 'zustand';
import { User, Company } from '@/types';
import { authAPI } from '@/services/api';

interface AuthState {
  user: User | null;
  company: Company | null;
  token: string | null;
  warning: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  loadUser: () => Promise<void>;
  setUser: (user: User) => void;
  setCompany: (company: Company) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  company: null,
  token: null,
  warning: null,
  isLoading: true,
  isAuthenticated: false,

  login: async (email: string, password: string) => {
    try {
      const response = await authAPI.login({ email, password });
      const { token, user, warning } = response.data.data;

      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));

      set({
        token,
        user: user as User,
        company: user.company as Company,
        warning: warning || null,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error: any) {
      const message = error.response?.data?.message || 'Login failed';
      throw new Error(message);
    }
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    set({
      user: null,
      company: null,
      token: null,
      warning: null,
      isAuthenticated: false,
      isLoading: false,
    });
  },

  loadUser: async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        set({ isLoading: false, isAuthenticated: false });
        return;
      }

      const response = await authAPI.getMe();
      const { user, company } = response.data.data;

      localStorage.setItem('user', JSON.stringify(user));

      set({
        user,
        company,
        token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      set({
        user: null,
        company: null,
        token: null,
        warning: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  setUser: (user) => set({ user }),
  setCompany: (company) => set({ company }),
}));
