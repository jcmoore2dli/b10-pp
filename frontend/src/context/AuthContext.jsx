
import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../services/firebase";

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(undefined);
  const [claims, setClaims] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const tokenResult = await user.getIdTokenResult();
        setClaims(tokenResult.claims);
      } else {
        setClaims(null);
      }
      setCurrentUser(user ?? null);
    });
    return unsubscribe;
  }, []);

  async function refreshClaims() {
    if (auth.currentUser) {
      await auth.currentUser.getIdToken(true);
      const fresh = await auth.currentUser.getIdTokenResult();
      setClaims(fresh.claims);
      return fresh.claims;
    }
    return null;
  }

  const value = { currentUser, claims, refreshClaims };

  if (currentUser === undefined) return null;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
