import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { shopApi, type User } from './api';
interface AuthValue {
  user: User | null;
  loaded: boolean;
  login: (email: string, password?: string) => Promise<void>;
  signup: (name: string, email: string, password?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}
const AuthContext = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const res = await shopApi.getMe();
      setUser(res.user);
    } catch {
      setUser(null);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const login = useCallback(async (email: string, password?: string) => {
    const res = await shopApi.login(email, password);
    setUser(res.user);
  }, []);
  const signup = useCallback(async (name: string, email: string, password?: string) => {
    const res = await shopApi.signup(name, email, password);
    setUser(res.user);
  }, []);
  const logout = useCallback(async () => {
    await shopApi.logout();
    setUser(null);
  }, []);
  const value = useMemo<AuthValue>(
    () => ({
      user,
      loaded,
      login,
      signup,
      logout,
      refresh,
    }),
    [user, loaded, login, signup, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}
