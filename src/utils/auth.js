const AUTH_STORAGE_KEY = "clinical-app-studio-auth";

export function readStoredAuthSession() {
  if (typeof window === "undefined") return null;

  try {
    const rawSession = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!rawSession) return null;

    const session = JSON.parse(rawSession);
    if (!session?.email || !session?.termsVersion) return null;
    return session;
  } catch {
    return null;
  }
}

export function storeAuthSession(session) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredAuthSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function createDemoAuthSession(termsVersion) {
  return {
    id: createClientId(),
    provider: "demo",
    subject: "demo-practitioner",
    email: "demo.practitioner@clinicalstudio.local",
    name: "Demo Practitioner",
    picture: "",
    hostedDomain: "",
    termsAcceptedAt: new Date().toISOString(),
    termsVersion,
    authenticatedAt: new Date().toISOString()
  };
}

export function createClerkAuthSession(user, termsVersion) {
  const primaryEmail =
    user?.primaryEmailAddress?.emailAddress ||
    user?.emailAddresses?.[0]?.emailAddress ||
    "";

  return {
    id: createClientId(),
    provider: "clerk",
    subject: user?.id || "",
    email: primaryEmail,
    name: user?.fullName || user?.username || primaryEmail || "Practitioner",
    picture: user?.imageUrl || "",
    hostedDomain: "",
    termsAcceptedAt: new Date().toISOString(),
    termsVersion,
    authenticatedAt: new Date().toISOString()
  };
}

function createClientId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `auth-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
