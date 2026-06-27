import { recordArtifactTelemetry } from "../api.js";

const TELEMETRY_SESSION_KEY = "clinical-app-telemetry-session";

export function emitArtifactTelemetry(artifactId, eventType, metadata = {}) {
  if (!artifactId || typeof window === "undefined") return;

  recordArtifactTelemetry({
    artifactId,
    eventType,
    sessionId: getTelemetrySessionId(),
    patientId: getPatientTelemetryId(),
    source: metadata.source || "artifact",
    metadata: {
      ...metadata,
      mode: metadata.mode || getTelemetryMode()
    }
  }).catch(() => {});
}

export function getTelemetrySessionId() {
  try {
    const existing = window.sessionStorage.getItem(TELEMETRY_SESSION_KEY);
    if (existing) return existing;

    const nextValue =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.sessionStorage.setItem(TELEMETRY_SESSION_KEY, nextValue);
    return nextValue;
  } catch {
    return "anonymous-session";
  }
}

function getPatientTelemetryId() {
  const params = new URLSearchParams(window.location.search);
  return (
    params.get("patientId") ||
    params.get("pid") ||
    (params.get("patient") === "1" ? "shared-link-patient" : "")
  );
}

function getTelemetryMode() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("patient") === "1" || params.get("role") === "patient") {
    return "patient";
  }

  return "practitioner";
}
