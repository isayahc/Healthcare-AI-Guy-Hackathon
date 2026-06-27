import { useEffect, useMemo, useState } from "react";
import {
  SignInButton,
  SignUpButton,
  UserButton,
  useClerk,
  useUser
} from "@clerk/react";
import {
  CheckCircle2,
  LogOut,
  ShieldCheck,
  UserPlus,
  UserRound
} from "lucide-react";
import { getAuthConfig } from "../api.js";
import { platformPositioning } from "../config/clinical.js";
import {
  createClerkAuthSession,
  createDemoAuthSession,
  readStoredAuthSession,
  storeAuthSession
} from "../utils/auth.js";

const fallbackTerms = {
  version: "local-demo-tools",
  title: "Clinical App Studio Terms of Use",
  summary:
    "Use Clinical App Studio for clinician-reviewed health literacy and patient-reported metric tracking.",
  items: [
    "Generated artifacts are education and collection tools, not diagnosis, treatment, prescribing, or emergency monitoring.",
    "Practitioners are responsible for reviewing clinical content and metric thresholds before use.",
    "Use only patient information you are authorized to handle.",
    "OpenAI is used to generate clinician-reviewed artifact specs; Baseten multimodal runtime LLM calls are enabled by default for patient education and check-in support unless a practitioner disables them.",
    "LLM, voice, Firecrawl web extraction, approved-link, public-link, and mobile-sharing integrations must be enabled only when appropriate for your organization and patient consent model.",
    "Firecrawl, when enabled, may send clinician-requested search terms or source URLs to retrieve public web context for clinician-reviewed artifacts.",
    "Usage telemetry records link opens, artifact views, interaction counts, assistant use, and check-in submissions without storing free-text answers, metric values, images, or raw patient identifiers by default.",
    "Artifact APIs and patient-reported data use no-store cache headers; browsers may cache static app assets that do not contain patient data."
  ]
};

export function AuthGate({ clerkEnabled, onAuthenticated }) {
  if (clerkEnabled) {
    return <ClerkAuthGate onAuthenticated={onAuthenticated} />;
  }

  return <DemoAuthGate onAuthenticated={onAuthenticated} />;
}

function ClerkAuthGate({ onAuthenticated }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const { status, terms, error } = useTermsConfig();
  const [termsAccepted, setTermsAccepted] = useTermsAcceptance(terms.version);

  useEffect(() => {
    if (
      status !== "ready" ||
      !termsAccepted ||
      !isLoaded ||
      !isSignedIn ||
      !user
    ) {
      return;
    }

    const session = createClerkAuthSession(user, terms.version);
    storeAuthSession(session);
    onAuthenticated(session);
  }, [
    isLoaded,
    isSignedIn,
    onAuthenticated,
    status,
    terms.version,
    termsAccepted,
    user
  ]);

  return (
    <AuthShell
      error={error}
      status={status}
      terms={terms}
      termsAccepted={termsAccepted}
      onTermsAcceptedChange={setTermsAccepted}
    >
      {!isLoaded ? (
        <span className="auth-muted">Loading Clerk sign-in...</span>
      ) : null}

      {isLoaded && isSignedIn ? (
        <span className="auth-muted">
          {termsAccepted ? "Finishing sign-in..." : "Accept the terms to continue."}
        </span>
      ) : null}

      {isLoaded && !isSignedIn ? (
        termsAccepted ? (
          <div className="clerk-login-slot">
            <SignInButton mode="modal">
              <button className="clerk-login-button" type="button">
                <UserRound size={17} aria-hidden="true" />
                Sign in with Clerk
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="clerk-login-button secondary" type="button">
                <UserPlus size={17} aria-hidden="true" />
                Create account
              </button>
            </SignUpButton>
          </div>
        ) : (
          <span className="auth-muted">Accept the terms to continue with Clerk.</span>
        )
      ) : null}
    </AuthShell>
  );
}

function DemoAuthGate({ onAuthenticated }) {
  const { status, terms, error } = useTermsConfig();
  const [termsAccepted, setTermsAccepted] = useTermsAcceptance(terms.version);

  function handleDemoSignIn() {
    if (!termsAccepted) return;
    const session = createDemoAuthSession(terms.version);
    storeAuthSession(session);
    onAuthenticated(session);
  }

  return (
    <AuthShell
      error={error}
      status={status}
      terms={terms}
      termsAccepted={termsAccepted}
      onTermsAcceptedChange={setTermsAccepted}
    >
      <button
        className="demo-login-button"
        disabled={!termsAccepted || status === "loading"}
        onClick={handleDemoSignIn}
        type="button"
      >
        <UserRound size={17} aria-hidden="true" />
        Continue in demo mode
      </button>
      {status === "loading" ? (
        <span className="auth-muted">Loading sign-in...</span>
      ) : null}
    </AuthShell>
  );
}

function AuthShell({
  children,
  error,
  onTermsAcceptedChange,
  status,
  terms,
  termsAccepted
}) {
  return (
    <main className="auth-page" aria-labelledby="auth-title">
      <section className="auth-card">
        <div className="auth-brand">
          <span className="auth-brand-mark">
            <ShieldCheck size={22} aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">Practitioner access</p>
            <h1 id="auth-title">{platformPositioning.productName}</h1>
            <p>{platformPositioning.corePurpose}</p>
          </div>
        </div>

        <TermsPanel
          accepted={termsAccepted}
          onAcceptedChange={onTermsAcceptedChange}
          terms={terms}
        />

        <div className="auth-actions">
          {children}
          {status === "error" && error ? <p className="auth-error">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}

function TermsPanel({ accepted, onAcceptedChange, terms }) {
  return (
    <section className="terms-panel" aria-labelledby="terms-title">
      <div className="terms-heading">
        <div>
          <p className="eyebrow">Terms</p>
          <h2 id="terms-title">{terms.title}</h2>
        </div>
        <span>{terms.version}</span>
      </div>
      <p>{terms.summary}</p>
      <ul>
        {terms.items.map((item) => (
          <li key={item}>
            <CheckCircle2 size={15} aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <label className="terms-acceptance">
        <input
          checked={accepted}
          onChange={(event) => onAcceptedChange(event.target.checked)}
          type="checkbox"
        />
        <span>I agree to these Terms of Use.</span>
      </label>
    </section>
  );
}

export function AuthStatus({ clerkEnabled, session, onSignOut }) {
  if (!session) return null;

  if (clerkEnabled) {
    return <ClerkAuthStatus session={session} onSignOut={onSignOut} />;
  }

  return <SessionStatus session={session} onSignOut={onSignOut} />;
}

function ClerkAuthStatus({ session, onSignOut }) {
  const { signOut } = useClerk();
  const { isLoaded, isSignedIn, user } = useUser();
  const displaySession = useMemo(
    () => ({
      ...session,
      email:
        user?.primaryEmailAddress?.emailAddress ||
        user?.emailAddresses?.[0]?.emailAddress ||
        session.email,
      name: user?.fullName || user?.username || session.name,
      picture: user?.imageUrl || session.picture,
      provider: "clerk"
    }),
    [session, user]
  );

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      onSignOut();
    }
  }, [isLoaded, isSignedIn, onSignOut]);

  async function handleClerkSignOut() {
    await signOut();
    onSignOut();
  }

  return (
    <SessionStatus
      extraControl={<UserButton afterSignOutUrl="/" />}
      session={displaySession}
      onSignOut={handleClerkSignOut}
    />
  );
}

function SessionStatus({ extraControl, session, onSignOut }) {
  const initials = getInitials(session?.name || session?.email || "User");

  return (
    <div className="auth-status" aria-label="Signed-in user">
      {session.picture ? (
        <img alt="" src={session.picture} />
      ) : (
        <span className="auth-avatar">{initials}</span>
      )}
      <div>
        <strong>{session.name || session.email}</strong>
        <span>{getProviderLabel(session.provider)} login</span>
      </div>
      {extraControl}
      <button aria-label="Sign out" onClick={onSignOut} type="button">
        <LogOut size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

function useTermsConfig() {
  const [config, setConfig] = useState({
    status: "loading",
    terms: fallbackTerms,
    error: ""
  });

  useEffect(() => {
    let isMounted = true;

    getAuthConfig()
      .then((authConfig) => {
        if (!isMounted) return;
        setConfig({
          status: "ready",
          terms: authConfig.terms || fallbackTerms,
          error: ""
        });
      })
      .catch((authError) => {
        if (!isMounted) return;
        setConfig({
          status: "error",
          terms: fallbackTerms,
          error: authError.message
        });
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return config;
}

function useTermsAcceptance(termsVersion) {
  const [termsAccepted, setTermsAccepted] = useState(false);

  useEffect(() => {
    const storedSession = readStoredAuthSession();
    setTermsAccepted(storedSession?.termsVersion === termsVersion);
  }, [termsVersion]);

  return [termsAccepted, setTermsAccepted];
}

function getProviderLabel(provider) {
  if (provider === "clerk") return "Clerk";
  return "Demo";
}

function getInitials(value) {
  return String(value || "User")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";
}
