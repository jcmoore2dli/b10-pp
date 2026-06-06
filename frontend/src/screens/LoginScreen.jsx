import { useState } from "react";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "../services/firebase";

// B10 ID is the only identifier. No email address is collected or stored.
// Firebase Auth requires an email format internally — we construct a synthetic
// address from the B10 ID that is never shown or communicated to the user.
function toSyntheticEmail(b10Id) {
  const val = b10Id.trim();
  // If input already looks like a real email, use it as-is (admin accounts)
  if (val.includes('@') && val.includes('.')) return val;
  return val.toLowerCase().replace(/[^a-z0-9-]/g, '-') + '@b10pp.local';
}

export default function LoginScreen() {
  const [mode, setMode] = useState("signin"); // "signin" | "register"
  const [b10Id, setB10Id] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  function switchMode(newMode) {
    setMode(newMode);
    setError(null);
    setB10Id("");
    setPassword("");
    setConfirm("");
  }

  async function handleSignIn() {
    setError(null);
    if (!b10Id || !password) {
      setError("Please enter your B10 ID and password.");
      return;
    }
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, toSyntheticEmail(b10Id), password);
    } catch (err) {
      if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found") {
        setError("B10 ID or password is incorrect.");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister() {
    setError(null);
    if (!b10Id || !password || !confirm) {
      setError("Please fill in all fields.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, toSyntheticEmail(b10Id), password);
      // Auth state change handled by App.jsx — will route to EntryScreen automatically
    } catch (err) {
      if (err.code === "auth/email-already-in-use") {
        setError("An account with this B10 ID already exists. Please sign in.");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 py-12">
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold mb-2" style={{ color: '#1e3a5f' }}>
          B10 Practice Platform
        </h1>
        <p className="text-gray-500 text-base">ILR 2→2+ Listening Practice</p>
      </div>

      {/* Mode toggle */}
      <div className="w-full max-w-sm flex rounded-xl overflow-hidden border border-gray-200 mb-6">
        <button
          onClick={() => switchMode("signin")}
          className="flex-1 py-2 text-sm font-semibold transition-colors"
          style={{
            backgroundColor: mode === "signin" ? '#1e3a5f' : '#f9fafb',
            color: mode === "signin" ? '#ffffff' : '#6b7280',
          }}
        >
          Sign In
        </button>
        <button
          onClick={() => switchMode("register")}
          className="flex-1 py-2 text-sm font-semibold transition-colors"
          style={{
            backgroundColor: mode === "register" ? '#1e3a5f' : '#f9fafb',
            color: mode === "register" ? '#ffffff' : '#6b7280',
          }}
        >
          New Student
        </button>
      </div>

      {/* Form */}
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-md p-8 flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-gray-700">B10 ID</label>
          <input
            type="text"
            placeholder="e.g. 26-001-1"
            value={b10Id}
            onChange={(e) => setB10Id(e.target.value)}
            className="border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-gray-700">Password</label>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
        </div>

        {mode === "register" && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700">Confirm Password</label>
            <input
              type="password"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
          </div>
        )}

        {error && (
          <p role="alert" className="text-red-600 text-sm font-medium">{error}</p>
        )}

        <button
          onClick={mode === "signin" ? handleSignIn : handleRegister}
          disabled={loading}
          className="w-full py-3 rounded-xl text-white font-semibold text-base mt-1"
          style={{ backgroundColor: loading ? '#7a9bbf' : '#1e3a5f' }}
        >
          {loading
            ? (mode === "signin" ? "Signing in…" : "Creating account…")
            : (mode === "signin" ? "Sign In" : "Create Account")}
        </button>

        {mode === "signin" && (
          <p className="text-xs text-gray-400 text-center">
            First time?{" "}
            <button
              onClick={() => switchMode("register")}
              className="text-blue-600 underline"
            >
              Create an account
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
