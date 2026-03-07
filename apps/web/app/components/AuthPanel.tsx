import { FormEvent, useEffect, useRef, useState } from "react";

type AuthMode = "login" | "register";

type GoogleCredentialResponse = {
  credential?: string;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (options: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (
            element: HTMLElement,
            options: Record<string, unknown>,
          ) => void;
        };
      };
    };
  }
}

type AuthPanelProps = {
  darkMode: boolean;
  loading: boolean;
  error: string | null;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onSubmit: (input: {
    mode: AuthMode;
    email: string;
    password: string;
    fullName?: string;
  }) => Promise<void>;
  googleClientId?: string | null;
  onGoogleSubmit?: (idToken: string) => Promise<void>;
};

export function AuthPanel({
  darkMode,
  loading,
  error,
  mode,
  onModeChange,
  onSubmit,
  googleClientId,
  onGoogleSubmit,
}: AuthPanelProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const googleSubmitRef = useRef(onGoogleSubmit);

  useEffect(() => {
    googleSubmitRef.current = onGoogleSubmit;
  }, [onGoogleSubmit]);

  useEffect(() => {
    if (!googleClientId || !onGoogleSubmit || !googleButtonRef.current) return;

    let disposed = false;
    const scriptId = "google-gsi-client";

    const initializeGoogleButton = () => {
      if (disposed || !googleButtonRef.current) return;
      const googleId = window.google?.accounts?.id;
      if (!googleId) return;

      googleId.initialize({
        client_id: googleClientId,
        callback: async (response: GoogleCredentialResponse) => {
          const token = response.credential;
          if (!token || !googleSubmitRef.current) return;
          await googleSubmitRef.current(token);
        },
      });

      googleButtonRef.current.innerHTML = "";
      googleId.renderButton(googleButtonRef.current, {
        theme: darkMode ? "filled_black" : "outline",
        size: "large",
        shape: "pill",
        text: "continue_with",
        width: 280,
      });
    };

    const existingScript = document.getElementById(
      scriptId,
    ) as HTMLScriptElement | null;
    const onLoad = () => initializeGoogleButton();

    if (window.google?.accounts?.id) {
      initializeGoogleButton();
      return () => {
        disposed = true;
      };
    }

    if (!existingScript) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => {
        script.dataset.loaded = "true";
        initializeGoogleButton();
      };
      document.head.appendChild(script);
    } else {
      if (existingScript.dataset.loaded === "true") {
        initializeGoogleButton();
      } else {
        existingScript.addEventListener("load", onLoad, { once: true });
      }
    }

    return () => {
      disposed = true;
      if (existingScript) {
        existingScript.removeEventListener("load", onLoad);
      }
    };
  }, [darkMode, googleClientId, onGoogleSubmit]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit({
      mode,
      email: email.trim(),
      password,
      fullName: fullName.trim() || undefined,
    });
  };

  return (
    <section className={`auth-card ${darkMode ? "dark" : ""}`}>
      <div className="auth-tabs" role="tablist" aria-label="Auth mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "login"}
          className={mode === "login" ? "active" : ""}
          onClick={() => onModeChange("login")}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "register"}
          className={mode === "register" ? "active" : ""}
          onClick={() => onModeChange("register")}
        >
          Create account
        </button>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label htmlFor="auth-email">Email</label>
        <input
          id="auth-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        {mode === "register" && (
          <>
            <label htmlFor="auth-full-name">Full name</label>
            <input
              id="auth-full-name"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              maxLength={120}
            />
          </>
        )}

        <label htmlFor="auth-password">Password</label>
        <input
          id="auth-password"
          type="password"
          autoComplete={
            mode === "register" ? "new-password" : "current-password"
          }
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={8}
          required
        />

        <button type="submit" className="auth-submit" disabled={loading}>
          {loading
            ? "Please wait…"
            : mode === "register"
              ? "Create account"
              : "Sign in"}
        </button>

        {error && <div className="auth-error">{error}</div>}
      </form>

      {googleClientId && onGoogleSubmit && (
        <div className="auth-oauth">
          <div className="auth-oauth-divider">
            <span>or continue with</span>
          </div>
          <div className="google-signin-wrapper" ref={googleButtonRef} />
        </div>
      )}
    </section>
  );
}
