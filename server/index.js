import "dotenv/config";
import express from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  adaptProfileForArtifactIntent,
  defaultCreateForm,
  inferConditionProfile,
  isEducationOnlyArtifactRequest,
  platformPositioning,
  summarizeConditionProfile
} from "../src/config/clinical.js";
import { starterApps } from "../src/data/apps.js";

const app = express();
const PORT = Number(process.env.PORT || 8787);
const BASETEN_CHAT_URL =
  process.env.BASETEN_CHAT_URL ||
  "https://inference.baseten.co/v1/chat/completions";
const BASETEN_MODEL =
  process.env.BASETEN_MULTIMODAL_MODEL ||
  process.env.BASETEN_MODEL ||
  "moonshotai/Kimi-K2.6";
const RUNTIME_LLM_MODALITIES = ["text", "image"];
const OPENAI_RESPONSES_URL =
  process.env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1";
const ELEVENLABS_API_KEY =
  process.env.ELEVENLABS_API_KEY || process.env.ELELVEN_LABS_API_KEY;
const ELEVENLABS_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
const ELEVENLABS_MODEL_ID =
  process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const FIRECRAWL_API_KEY =
  process.env.FIRECRAWL_API_KEY || process.env.FIRECRAWL_API || "";
const FIRECRAWL_BASE_URL =
  process.env.FIRECRAWL_BASE_URL || "https://api.firecrawl.dev";
const termsOfUse = {
  version: "2026-06-27.7",
  title: "Clinical App Studio Terms of Use",
  updatedAt: "2026-06-27",
  summary:
    "Use Clinical App Studio for clinician-reviewed health literacy and patient-reported metric tracking.",
  items: [
    "Generated artifacts are education and collection tools, not diagnosis, treatment, prescribing, or emergency monitoring.",
    "Practitioners are responsible for reviewing clinical content, patient assignments, metric thresholds, and escalation copy before use.",
    "Use the minimum necessary patient information and only for patients or populations you are authorized to support.",
    "Patient-reported metrics may be incomplete or inaccurate and require clinician judgment before action.",
    "OpenAI is used to generate clinician-reviewed artifact specs; Baseten multimodal runtime LLM calls are enabled by default for patient education and check-in support unless a practitioner disables them.",
    "Public artifacts can be opened by anyone with the patient link; assigned-patient artifacts require clinician-approved access links.",
    "LLM, voice, Firecrawl web extraction, approved-link, public-link, and mobile-sharing integrations must be enabled only when appropriate for your organization and patient consent model.",
    "Firecrawl, when enabled, may send clinician-requested search terms or source URLs to retrieve public web context for clinician-reviewed artifacts.",
    "Usage telemetry records link opens, artifact views, interaction counts, assistant use, and check-in submissions without storing free-text answers, metric values, images, or raw patient identifiers by default.",
    "Artifact APIs and patient-reported data use no-store cache headers; browsers may cache static app assets that do not contain patient data."
  ]
};
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const SQLITE_DB_PATH =
  process.env.SQLITE_DB_PATH ||
  path.join(DATA_DIR, "clinical-app-studio.sqlite");
const artifactDb = openArtifactDatabase(SQLITE_DB_PATH);
const VOICE_STREAM_REQUEST_TTL_MS = 2 * 60 * 1000;
const voiceStreamRequests = new Map();

seedArtifactsIfEmpty(starterApps);

app.use(applyDynamicCacheHeaders);
app.use(express.json({ limit: "4mb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    artifactGenerationProvider: "openai",
    artifactGenerationModel: OPENAI_MODEL,
    runtimeLlmProvider: "baseten",
    runtimeLlmModel: BASETEN_MODEL,
    runtimeLlmMultimodal: true,
    runtimeLlmModalities: RUNTIME_LLM_MODALITIES,
    model: OPENAI_MODEL,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    basetenConfigured: Boolean(process.env.BASETEN_API_KEY),
    elevenLabsConfigured: Boolean(ELEVENLABS_API_KEY),
    firecrawlConfigured: Boolean(FIRECRAWL_API_KEY)
  });
});

app.get("/api/public-url", async (_request, response) => {
  const publicUrl = await readNgrokPublicUrl();
  response.json({
    publicUrl,
    source: publicUrl ? "ngrok" : "origin"
  });
});

app.get("/api/auth/config", (_request, response) => {
  response.json({
    clerkConfigured: Boolean(process.env.VITE_CLERK_PUBLISHABLE_KEY),
    terms: termsOfUse
  });
});

app.get("/api/artifacts", (_request, response) => {
  response.json({ artifacts: listStoredArtifacts() });
});

app.get("/api/artifacts/:id", (request, response) => {
  const id = sanitizeArtifactId(request.params.id);
  const artifact = getStoredArtifact(id);

  if (!artifact) {
    response.status(404).json({ error: "Artifact not found." });
    return;
  }

  response.json({ artifact });
});

app.get("/api/patient-artifacts/:id", (request, response) => {
  const id = sanitizeArtifactId(request.params.id);
  const artifact = getStoredArtifact(id);

  if (!artifact) {
    response.status(404).json({ error: "Artifact not found." });
    return;
  }

  const access = verifyArtifactPatientAccess(
    artifact,
    request.query.access || request.query.token
  );

  if (!access.allowed) {
    response.status(403).json({
      error: "This private artifact requires an approved patient link."
    });
    return;
  }

  response.json({ artifact, access });
});

app.get("/api/artifacts/:id/access-tokens", (request, response) => {
  const id = sanitizeArtifactId(request.params.id);

  if (!artifactExists(id)) {
    response.status(404).json({ error: "Artifact not found." });
    return;
  }

  response.json({ links: listArtifactAccessTokens(id) });
});

app.post("/api/artifacts/:id/access-tokens", (request, response) => {
  const id = sanitizeArtifactId(request.params.id);

  if (!artifactExists(id)) {
    response.status(404).json({ error: "Artifact not found." });
    return;
  }

  const link = createArtifactAccessToken(
    id,
    sanitizeRecipientLabel(request.body?.recipientLabel)
  );

  response.json({
    link,
    links: listArtifactAccessTokens(id)
  });
});

app.delete("/api/artifacts/:id/access-tokens/:tokenId", (request, response) => {
  const id = sanitizeArtifactId(request.params.id);
  const tokenId = sanitizeArtifactId(request.params.tokenId);

  if (!artifactExists(id)) {
    response.status(404).json({ error: "Artifact not found." });
    return;
  }

  const revoked = revokeArtifactAccessToken(id, tokenId);

  if (!revoked) {
    response.status(404).json({ error: "Approved link not found." });
    return;
  }

  response.json({
    revoked: true,
    links: listArtifactAccessTokens(id)
  });
});

app.get("/api/artifacts/:id/versions", (request, response) => {
  const id = sanitizeArtifactId(request.params.id);
  const artifact = getStoredArtifact(id);

  if (!artifact) {
    response.status(404).json({ error: "Artifact not found." });
    return;
  }

  response.json({ versions: listArtifactVersions(id) });
});

app.get("/api/artifacts/:id/telemetry", (request, response) => {
  const id = sanitizeArtifactId(request.params.id);

  if (!artifactExists(id)) {
    response.status(404).json({ error: "Artifact not found." });
    return;
  }

  response.json({ telemetry: getArtifactTelemetry(id) });
});

app.post("/api/telemetry", (request, response) => {
  const event = sanitizeTelemetryEvent(request.body);

  if (!event.artifactId || !event.eventType) {
    response.status(400).json({ error: "Artifact ID and event type are required." });
    return;
  }

  if (!artifactExists(event.artifactId)) {
    response.status(404).json({ error: "Artifact not found." });
    return;
  }

  const storedEvent = recordTelemetryEvent(event);
  response.json({
    event: storedEvent,
    telemetry: getArtifactTelemetry(event.artifactId).summary
  });
});

app.post("/api/artifacts", (request, response) => {
  const artifact = normalizeStoredArtifact(request.body?.artifact);

  if (!artifact) {
    response.status(400).json({ error: "Valid artifact is required." });
    return;
  }

  const stored = storeArtifact(artifact);
  response.json({ artifact: stored });
});

app.delete("/api/artifacts/:id", (request, response) => {
  const id = sanitizeArtifactId(request.params.id);
  const deleted = deleteStoredArtifact(id);

  if (!deleted) {
    response.status(404).json({ error: "Artifact not found." });
    return;
  }

  response.json({ deleted: true, id });
});

app.post("/api/artifacts/:id/versions", (request, response) => {
  const id = sanitizeArtifactId(request.params.id);
  const artifact = getStoredArtifact(id);

  if (!artifact) {
    response.status(404).json({ error: "Artifact not found." });
    return;
  }

  const version = createArtifactVersion(artifact, {
    allowDuplicate: true,
    label: sanitizeVersionLabel(request.body?.label) || "Manual snapshot",
    source: "manual"
  });
  const versionedArtifact = {
    ...artifact,
    currentVersion: version.versionNumber,
    versionId: version.id,
    updatedAt: new Date().toISOString()
  };
  saveArtifactRecord(versionedArtifact);
  response.json({ version, versions: listArtifactVersions(id) });
});

app.post("/api/artifacts/:id/versions/:versionId/restore", (request, response) => {
  const id = sanitizeArtifactId(request.params.id);
  const versionId = String(request.params.versionId || "");
  const version = findArtifactVersion(id, versionId);

  if (!version) {
    response.status(404).json({ error: "Artifact version not found." });
    return;
  }

  const restored = storeArtifact(
    {
      ...version.artifact,
      id,
      restoredFromVersion: version.versionNumber
    },
    {
      label: `Restored v${version.versionNumber}`,
      source: "restore",
      allowDuplicateVersion: true
    }
  );

  response.json({
    artifact: restored,
    restoredFrom: version,
    versions: listArtifactVersions(id)
  });
});

app.post("/api/generate-app", async (request, response) => {
  let payload = sanitizeBuildRequest(request.body);

  if (!payload.brief) {
    response.status(400).json({ error: "Clinical brief is required." });
    return;
  }

  try {
    payload = await enrichBuildRequestWithFirecrawl(payload);
    const appSpec = await generateWithOpenAI(payload);
    const normalizedSpec = normalizeAppSpec(appSpec, payload);
    const artifact = storeArtifact(normalizedSpec, {
      uniqueOnConflict: true
    });
    response.json({
      source: "openai",
      model: OPENAI_MODEL,
      app: artifact,
      agents: buildAgentReport("complete")
    });
  } catch (error) {
    console.warn("OpenAI generation failed:", error.message);
    response.status(502).json({
      error: "Artifact generation failed.",
      model: OPENAI_MODEL,
      message: error.message,
      agents: buildAgentReport("blocked")
    });
  }
});

app.post("/api/artifact-tools/firecrawl", async (request, response) => {
  const payload = sanitizeFirecrawlToolRequest(request.body);

  if (!payload.artifactId) {
    response.status(400).json({ error: "Artifact ID is required." });
    return;
  }

  if (!artifactExists(payload.artifactId)) {
    response.status(404).json({ error: "Artifact not found." });
    return;
  }

  if (!FIRECRAWL_API_KEY) {
    response.status(503).json({
      error: "Firecrawl is not configured. Set FIRECRAWL_API_KEY to use this tool."
    });
    return;
  }

  try {
    const result = await runFirecrawlTool(payload);
    response.json(result);
  } catch (error) {
    console.warn("Firecrawl tool failed:", error.message);
    response.status(502).json({ error: error.message });
  }
});

app.post("/api/artifact-llm", async (request, response) => {
  const payload = sanitizeArtifactLlmRequest(request.body);
  const artifact = getStoredArtifact(payload.artifactId);

  if (!payload.message) {
    response.status(400).json({ error: "Message is required." });
    return;
  }

  if (!artifact) {
    response.status(404).json({ error: "Artifact not found." });
    return;
  }

  if (!artifact.permissions?.llm?.enabled) {
    response.status(403).json({
      error: "LLM access is disabled for this artifact."
    });
    return;
  }

  if (!process.env.BASETEN_API_KEY) {
    response.status(503).json({
      error: "Baseten is not configured. Set BASETEN_API_KEY to use artifact LLMs."
    });
    return;
  }

  try {
    const reply = await generateArtifactReplyWithBaseten(artifact, payload);
    response.json({
      source: "baseten",
      model: BASETEN_MODEL,
      reply,
      escalation: hasEscalationText(payload.message, artifact)
    });
  } catch (error) {
    console.warn("Artifact LLM failed:", error.message);
    response.status(502).json({ error: error.message });
  }
});

app.post("/api/voice-preview", async (request, response) => {
  const payload = sanitizeVoiceRequest(request.body);

  if (!payload.text) {
    response.status(400).json({ error: "Narration text is required." });
    return;
  }

  if (!ELEVENLABS_API_KEY) {
    response.status(503).json({
      error:
        "ElevenLabs is not configured. Set ELEVENLABS_API_KEY or ELELVEN_LABS_API_KEY."
    });
    return;
  }

  try {
    const audio = await generateVoiceWithElevenLabs(payload.text);
    response.json({
      source: "elevenlabs",
      voiceId: ELEVENLABS_VOICE_ID,
      modelId: ELEVENLABS_MODEL_ID,
      text: payload.text,
      audioContent: audio.toString("base64"),
      mimeType: "audio/mpeg"
    });
  } catch (error) {
    console.warn("ElevenLabs voice generation failed:", error.message);
    response.status(502).json({ error: error.message });
  }
});

app.post("/api/artifact-tools/elevenlabs/stream", (request, response) => {
  const payload = sanitizeVoiceStreamRequest(request.body);
  const artifact = getStoredArtifact(payload.artifactId);

  if (!payload.artifactId) {
    response.status(400).json({ error: "Artifact ID is required." });
    return;
  }

  if (!artifact) {
    response.status(404).json({ error: "Artifact not found." });
    return;
  }

  if (!payload.text) {
    response.status(400).json({ error: "Narration text is required." });
    return;
  }

  if (!ELEVENLABS_API_KEY) {
    response.status(503).json({
      error:
        "ElevenLabs is not configured. Set ELEVENLABS_API_KEY or ELELVEN_LABS_API_KEY."
    });
    return;
  }

  cleanupExpiredVoiceStreamRequests();
  const streamId = randomUUID();
  const expiresAt = Date.now() + VOICE_STREAM_REQUEST_TTL_MS;
  voiceStreamRequests.set(streamId, {
    artifactId: artifact.id,
    text: payload.text,
    expiresAt
  });

  response.json({
    source: "elevenlabs",
    streamId,
    streamUrl: `/api/artifact-tools/elevenlabs/stream/${streamId}`,
    expiresAt: new Date(expiresAt).toISOString()
  });
});

app.get("/api/artifact-tools/elevenlabs/stream/:streamId", async (request, response) => {
  cleanupExpiredVoiceStreamRequests();
  const streamId = sanitizeArtifactId(request.params.streamId);
  const streamRequest = voiceStreamRequests.get(streamId);

  if (!streamRequest) {
    response.status(404).json({ error: "Narration stream expired or was not found." });
    return;
  }

  if (!artifactExists(streamRequest.artifactId)) {
    voiceStreamRequests.delete(streamId);
    response.status(404).json({ error: "Artifact not found." });
    return;
  }

  if (!ELEVENLABS_API_KEY) {
    response.status(503).json({
      error:
        "ElevenLabs is not configured. Set ELEVENLABS_API_KEY or ELELVEN_LABS_API_KEY."
    });
    return;
  }

  try {
    await streamVoiceWithElevenLabs(streamRequest.text, response);
  } catch (error) {
    console.warn("ElevenLabs streaming failed:", error.message);
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    response.status(502).json({ error: error.message });
  }
});

app.use("/api", (request, response) => {
  response.status(404).json({
    error: "API route not found.",
    path: request.originalUrl
  });
});

const distPath = path.join(process.cwd(), "dist");
if (fs.existsSync(distPath)) {
  app.use(
    express.static(distPath, {
      setHeaders: setStaticCacheHeaders
    })
  );
  app.get("*", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.sendFile(path.join(distPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Clinical App Studio API listening on http://localhost:${PORT}`);
});

function applyDynamicCacheHeaders(request, response, next) {
  if (request.path.startsWith("/api/")) {
    response.set("Cache-Control", "no-store");
  }

  next();
}

function setStaticCacheHeaders(response, filePath) {
  const normalizedPath = filePath.split(path.sep).join("/");

  if (normalizedPath.endsWith(".html")) {
    response.setHeader("Cache-Control", "no-store");
    return;
  }

  if (normalizedPath.includes("/assets/")) {
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return;
  }

  response.setHeader("Cache-Control", "no-cache");
}

function openArtifactDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const database = new DatabaseSync(dbPath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      condition TEXT,
      specialty TEXT,
      status TEXT,
      visibility TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      content_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifact_versions (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      label TEXT NOT NULL,
      source TEXT NOT NULL,
      project_id TEXT,
      created_at TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      artifact_json TEXT NOT NULL,
      UNIQUE (artifact_id, version_number),
      FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS artifact_events (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      patient_key TEXT,
      event_type TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS artifact_access_tokens (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      recipient_label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_artifacts_updated_at
      ON artifacts(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact
      ON artifact_versions(artifact_id, version_number DESC);
    CREATE INDEX IF NOT EXISTS idx_artifact_events_artifact
      ON artifact_events(artifact_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_artifact_events_type
      ON artifact_events(artifact_id, event_type);
    CREATE INDEX IF NOT EXISTS idx_artifact_access_tokens_artifact
      ON artifact_access_tokens(artifact_id, created_at DESC);
  `);

  return database;
}

function seedArtifactsIfEmpty(seedArtifacts) {
  const row = artifactDb.prepare("SELECT COUNT(*) AS count FROM artifacts").get();
  if (Number(row?.count || 0) > 0) return;

  seedArtifacts.forEach((artifact) => {
    storeArtifact(artifact, {
      label: "Seed artifact",
      source: "seed"
    });
  });
}

function listStoredArtifacts() {
  return artifactDb
    .prepare("SELECT content_json FROM artifacts ORDER BY updated_at DESC")
    .all()
    .map((row) => parseStoredJson(row.content_json))
    .map((artifact) => normalizeStoredArtifact(artifact))
    .filter(Boolean);
}

function getStoredArtifact(id) {
  const row = artifactDb
    .prepare("SELECT content_json FROM artifacts WHERE id = ?")
    .get(sanitizeArtifactId(id));

  return row ? normalizeStoredArtifact(parseStoredJson(row.content_json)) : null;
}

function artifactExists(id) {
  const row = artifactDb
    .prepare("SELECT 1 AS exists_flag FROM artifacts WHERE id = ?")
    .get(sanitizeArtifactId(id));
  return Boolean(row?.exists_flag);
}

function isPublicArtifact(artifact) {
  return String(artifact?.visibility || "").toLowerCase() === "public";
}

function verifyArtifactPatientAccess(artifact, rawToken) {
  if (isPublicArtifact(artifact)) {
    return {
      allowed: true,
      mode: "public"
    };
  }

  const token = String(rawToken || "").trim();
  if (!token) {
    return {
      allowed: false,
      mode: "approved"
    };
  }

  const tokenHash = hashAccessToken(token);
  const row = artifactDb
    .prepare(`
      SELECT id, artifact_id, recipient_label, created_at, last_used_at, revoked_at
      FROM artifact_access_tokens
      WHERE artifact_id = ? AND token_hash = ? AND revoked_at IS NULL
    `)
    .get(artifact.id, tokenHash);

  if (!row) {
    return {
      allowed: false,
      mode: "approved"
    };
  }

  const now = new Date().toISOString();
  artifactDb
    .prepare("UPDATE artifact_access_tokens SET last_used_at = ? WHERE id = ?")
    .run(now, row.id);

  return {
    allowed: true,
    mode: "approved",
    linkId: row.id,
    recipientLabel: row.recipient_label,
    lastUsedAt: now
  };
}

function createArtifactAccessToken(artifactId, recipientLabel) {
  const token = randomBytes(24).toString("base64url");
  const now = new Date().toISOString();
  const link = {
    id: randomUUID(),
    artifactId,
    token,
    recipientLabel,
    createdAt: now,
    lastUsedAt: "",
    revokedAt: "",
    status: "active"
  };

  artifactDb
    .prepare(`
      INSERT INTO artifact_access_tokens (
        id,
        artifact_id,
        token_hash,
        recipient_label,
        created_at,
        last_used_at,
        revoked_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      link.id,
      artifactId,
      hashAccessToken(token),
      link.recipientLabel,
      link.createdAt,
      null,
      null
    );

  return link;
}

function listArtifactAccessTokens(artifactId) {
  return artifactDb
    .prepare(`
      SELECT
        id,
        artifact_id,
        recipient_label,
        created_at,
        last_used_at,
        revoked_at
      FROM artifact_access_tokens
      WHERE artifact_id = ?
      ORDER BY created_at DESC
    `)
    .all(sanitizeArtifactId(artifactId))
    .map(hydrateAccessToken);
}

function hydrateAccessToken(row) {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    recipientLabel: row.recipient_label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || "",
    revokedAt: row.revoked_at || "",
    status: row.revoked_at ? "revoked" : "active"
  };
}

function revokeArtifactAccessToken(artifactId, tokenId) {
  const result = artifactDb
    .prepare(`
      UPDATE artifact_access_tokens
      SET revoked_at = ?
      WHERE artifact_id = ? AND id = ? AND revoked_at IS NULL
    `)
    .run(new Date().toISOString(), sanitizeArtifactId(artifactId), tokenId);
  return result.changes > 0;
}

function hashAccessToken(value) {
  return createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

function deleteStoredArtifact(id) {
  const result = artifactDb
    .prepare("DELETE FROM artifacts WHERE id = ?")
    .run(sanitizeArtifactId(id));
  return result.changes > 0;
}

function saveArtifactRecord(artifact) {
  const normalized = normalizeStoredArtifact(artifact);
  const existing = getStoredArtifact(normalized.id);
  const now = new Date().toISOString();
  const stored = {
    ...normalized,
    createdAt: existing?.createdAt || normalized.createdAt || now,
    updatedAt: normalized.updatedAt || now
  };

  upsertArtifactRecord(stored);
  return stored;
}

function upsertArtifactRecord(artifact) {
  artifactDb
    .prepare(`
      INSERT INTO artifacts (
        id,
        project_id,
        title,
        condition,
        specialty,
        status,
        visibility,
        created_at,
        updated_at,
        content_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        title = excluded.title,
        condition = excluded.condition,
        specialty = excluded.specialty,
        status = excluded.status,
        visibility = excluded.visibility,
        updated_at = excluded.updated_at,
        content_json = excluded.content_json
    `)
    .run(
      artifact.id,
      artifact.projectId || "",
      artifact.title || "Untitled artifact",
      artifact.condition || "",
      artifact.specialty || "",
      artifact.status || "",
      artifact.visibility || "",
      artifact.createdAt || artifact.updatedAt || new Date().toISOString(),
      artifact.updatedAt || new Date().toISOString(),
      JSON.stringify(artifact)
    );
}

function recordTelemetryEvent(event) {
  const storedEvent = {
    id: randomUUID(),
    artifactId: event.artifactId,
    sessionId: event.sessionId,
    patientKey: event.patientKey,
    eventType: event.eventType,
    source: event.source,
    createdAt: new Date().toISOString(),
    metadata: event.metadata || {}
  };

  artifactDb
    .prepare(`
      INSERT INTO artifact_events (
        id,
        artifact_id,
        session_id,
        patient_key,
        event_type,
        source,
        created_at,
        metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      storedEvent.id,
      storedEvent.artifactId,
      storedEvent.sessionId,
      storedEvent.patientKey,
      storedEvent.eventType,
      storedEvent.source,
      storedEvent.createdAt,
      JSON.stringify(storedEvent.metadata)
    );

  return storedEvent;
}

function getArtifactTelemetry(id) {
  const artifactId = sanitizeArtifactId(id);
  const countRows = artifactDb
    .prepare(`
      SELECT event_type, COUNT(*) AS count
      FROM artifact_events
      WHERE artifact_id = ?
      GROUP BY event_type
    `)
    .all(artifactId);
  const counts = Object.fromEntries(
    countRows.map((row) => [row.event_type, Number(row.count || 0)])
  );
  const distinctRow = artifactDb
    .prepare(`
      SELECT
        COUNT(DISTINCT session_id) AS sessions,
        COUNT(DISTINCT NULLIF(patient_key, '')) AS patients,
        MAX(created_at) AS last_event_at
      FROM artifact_events
      WHERE artifact_id = ?
    `)
    .get(artifactId);
  const events = artifactDb
    .prepare(`
      SELECT
        id,
        artifact_id,
        session_id,
        patient_key,
        event_type,
        source,
        created_at,
        metadata_json
      FROM artifact_events
      WHERE artifact_id = ?
      ORDER BY created_at DESC
      LIMIT 80
    `)
    .all(artifactId)
    .map(hydrateTelemetryEvent);
  const interactionTypes = [
    "lesson_complete",
    "checkin_submit",
    "assistant_query",
    "chat_message",
    "quick_reply"
  ];
  const interactions = interactionTypes.reduce(
    (total, type) => total + Number(counts[type] || 0),
    0
  );
  const totalEvents = Object.values(counts).reduce(
    (total, count) => total + Number(count || 0),
    0
  );

  return {
    summary: {
      totalEvents,
      linkOpens: Number(counts.share_link_open || 0),
      artifactViews: Number(counts.artifact_view || 0),
      interactions,
      checkIns: Number(counts.checkin_submit || 0),
      assistantUses: Number(counts.assistant_query || 0),
      activeSessions: Number(distinctRow?.sessions || 0),
      patientKeys: Number(distinctRow?.patients || 0),
      lastEventAt: distinctRow?.last_event_at || ""
    },
    counts,
    events
  };
}

function hydrateTelemetryEvent(row) {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    sessionId: row.session_id,
    patientKey: row.patient_key || "",
    eventType: row.event_type,
    source: row.source || "",
    createdAt: row.created_at,
    metadata: parseStoredJson(row.metadata_json) || {}
  };
}

function parseStoredJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sanitizeBuildRequest(input = {}) {
  const brief = String(input.brief || "").trim().slice(0, 2400);
  const educationOnly = isEducationOnlyArtifactRequest(brief);
  const sourceMaterial = sanitizeSourceMaterial(input.sourceMaterial);
  const requestedSpecialty = String(
    input.specialty || defaultCreateForm.specialty
  ).slice(0, 80);
  const inferredProfile = adaptProfileForArtifactIntent(
    inferConditionProfile({
      brief,
      specialty: requestedSpecialty
    }),
    brief
  );
  const conditionProfile = input.conditionProfile?.key
    ? {
        ...summarizeConditionProfile(inferredProfile),
        ...input.conditionProfile
      }
    : summarizeConditionProfile(inferredProfile);
  const patientGroups =
    Array.isArray(input.patientGroups) && input.patientGroups.length
      ? input.patientGroups.map((group) => String(group).slice(0, 80)).slice(0, 8)
      : conditionProfile.patientGroups;

  return {
    projectId: isUuid(input.projectId) ? input.projectId : randomUUID(),
    brief,
    condition: String(input.condition || conditionProfile.label).slice(0, 80),
    conditionProfile,
    artifactIntent: educationOnly ? "education" : "tracking",
    distribution:
      input.distribution === "public" ? "public" : "assigned patients",
    patientGroups,
    specialty: String(
      input.specialty || conditionProfile.specialty || defaultCreateForm.specialty
    ).slice(0, 80),
    literacy: String(input.literacy || defaultCreateForm.literacy).slice(0, 40),
    language: String(input.language || defaultCreateForm.language).slice(0, 40),
    sourceMaterial,
    observabilityGoal: String(
      input.observabilityGoal || conditionProfile.observabilityGoal
    ).slice(0, 160),
    voiceEnabled: Boolean(input.voiceEnabled)
  };
}

function sanitizeSourceMaterial(value) {
  const text = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, 3600);
  const urls = [...text.matchAll(/https?:\/\/[^\s)]+/gi)]
    .map((match) => match[0].replace(/[.,;]+$/g, ""))
    .slice(0, 8);

  return {
    text,
    urls,
    hasMaterial: Boolean(text),
    note: text
      ? "Clinician-provided offboarding/discharge/reference material. Use only as context for clinician-reviewed education and telemetry design."
      : ""
  };
}

function sanitizeFirecrawlToolRequest(input = {}) {
  const url = String(input.url || "")
    .trim()
    .slice(0, 500);
  const query = String(input.query || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);

  return {
    artifactId: sanitizeArtifactId(input.artifactId),
    mode: url ? "scrape" : "search",
    url,
    query,
    limit: Math.min(Math.max(Number(input.limit || 3), 1), 5)
  };
}

function sanitizeVoiceRequest(input = {}) {
  const app = input.app || {};
  const lessons = Array.isArray(app?.education?.lessons)
    ? app.education.lessons.slice(0, 3).join(", ")
    : "";
  const rawText =
    input.text ||
    [
      app.preview?.headline || app.title,
      app.description,
      lessons ? `This artifact includes lessons on ${lessons}.` : "",
      app.preview?.nextAction ? `Next step: ${app.preview.nextAction}.` : ""
    ]
      .filter(Boolean)
      .join(" ");

  return {
    text: String(rawText).replace(/\s+/g, " ").trim().slice(0, 1200)
  };
}

function sanitizeVoiceStreamRequest(input = {}) {
  return {
    artifactId: sanitizeArtifactId(input.artifactId || input.id),
    text: String(input.text || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1200)
  };
}

function cleanupExpiredVoiceStreamRequests() {
  const now = Date.now();
  for (const [streamId, streamRequest] of voiceStreamRequests.entries()) {
    if (streamRequest.expiresAt <= now) {
      voiceStreamRequests.delete(streamId);
    }
  }
}

function sanitizeArtifactLlmRequest(input = {}) {
  return {
    artifactId: sanitizeArtifactId(input.artifactId),
    message: String(input.message || "").replace(/\s+/g, " ").trim().slice(0, 900),
    attachments: Array.isArray(input.attachments)
      ? input.attachments
          .slice(0, 2)
          .map((attachment) => ({
            type: String(attachment?.type || "image").slice(0, 24),
            mimeType: String(attachment?.mimeType || "image/png").slice(0, 80),
            url: String(attachment?.url || attachment?.dataUrl || "").trim().slice(0, 1200000)
          }))
          .filter((attachment) => /^data:image\/|^https?:\/\//i.test(attachment.url))
      : [],
    transcript: Array.isArray(input.transcript)
      ? input.transcript
          .slice(-8)
          .map((message) => ({
            role: message?.role === "user" ? "user" : "assistant",
            text: String(message?.text || "").replace(/\s+/g, " ").trim().slice(0, 500)
          }))
          .filter((message) => message.text)
      : []
  };
}

function sanitizeTelemetryEvent(input = {}) {
  const eventType = String(input.eventType || input.type || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .slice(0, 40);
  const allowedTypes = new Set([
    "share_link_open",
    "share_link_copy",
    "artifact_view",
    "lesson_complete",
    "checkin_submit",
    "assistant_query",
    "chat_message",
    "quick_reply",
    "chat_reset",
    "voice_preview"
  ]);

  return {
    artifactId: sanitizeArtifactId(input.artifactId),
    eventType: allowedTypes.has(eventType) ? eventType : "",
    sessionId: hashTelemetryIdentifier(input.sessionId || "anonymous-session"),
    patientKey: input.patientId ? hashTelemetryIdentifier(input.patientId) : "",
    source: String(input.source || "artifact")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .slice(0, 32),
    metadata: sanitizeTelemetryMetadata(input.metadata)
  };
}

function sanitizeTelemetryMetadata(metadata = {}) {
  const allowedKeys = new Set([
    "mode",
    "source",
    "signal",
    "metricCount",
    "lessonIndex",
    "completed",
    "hasAttachment",
    "multimodal",
    "artifactType",
    "llmEnabled",
    "escalation",
    "channel"
  ]);
  const safeMetadata = {};

  Object.entries(metadata || {}).forEach(([key, value]) => {
    if (!allowedKeys.has(key)) return;

    if (typeof value === "boolean") {
      safeMetadata[key] = value;
      return;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      safeMetadata[key] = value;
      return;
    }

    safeMetadata[key] = String(value || "").slice(0, 80);
  });

  return safeMetadata;
}

function hashTelemetryIdentifier(value) {
  return createHash("sha256")
    .update(String(value || "anonymous"))
    .digest("hex")
    .slice(0, 24);
}

async function readNgrokPublicUrl() {
  try {
    const response = await fetch("http://127.0.0.1:4040/api/tunnels");
    if (!response.ok) return "";

    const data = await response.json();
    const tunnel = data.tunnels?.find(
      (item) =>
        item.proto === "https" &&
        (item.config?.addr?.includes("8787") ||
          item.config?.addr?.includes("5173"))
    );
    return tunnel?.public_url || "";
  } catch {
    return "";
  }
}

async function generateArtifactReplyWithBaseten(artifact, payload) {
  const basetenResponse = await fetch(BASETEN_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.BASETEN_API_KEY}`
    },
    body: JSON.stringify({
      model: BASETEN_MODEL,
      temperature: 0.25,
      max_tokens: 420,
      messages: [
        {
          role: "system",
          content:
            "You are the multimodal LLM runtime for a clinician-approved patient education artifact. Be concise, empathetic, and plain-language. Use attached images only to support education or check-in context. Do not diagnose, prescribe, change medications, or claim to monitor emergencies. If the patient describes severe, sudden, or dangerous symptoms, tell them to use emergency services and still summarize what was captured for the care team."
        },
        {
          role: "user",
          content: buildBasetenMultimodalMessageContent(artifact, payload)
        }
      ]
    })
  });

  if (!basetenResponse.ok) {
    const details = await basetenResponse.text();
    throw new Error(
      `Baseten artifact LLM failed with ${basetenResponse.status}: ${details.slice(0, 180)}`
    );
  }

  const data = await basetenResponse.json();
  return readAssistantContent(data)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

async function generateVoiceWithElevenLabs(text) {
  const elevenLabsResponse = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL_ID,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0,
          use_speaker_boost: true
        }
      })
    }
  );

  if (!elevenLabsResponse.ok) {
    const details = await elevenLabsResponse.text();
    throw new Error(
      `ElevenLabs request failed with ${elevenLabsResponse.status}: ${details.slice(0, 180)}`
    );
  }

  const arrayBuffer = await elevenLabsResponse.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function streamVoiceWithElevenLabs(text, response) {
  const elevenLabsResponse = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL_ID,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0,
          use_speaker_boost: true
        }
      })
    }
  );

  if (!elevenLabsResponse.ok || !elevenLabsResponse.body) {
    const details = await elevenLabsResponse.text();
    throw new Error(
      `ElevenLabs stream failed with ${elevenLabsResponse.status}: ${details.slice(0, 180)}`
    );
  }

  response.status(200);
  response.set({
    "Content-Type": elevenLabsResponse.headers.get("content-type") || "audio/mpeg",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });

  const reader = elevenLabsResponse.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!response.write(Buffer.from(value))) {
        await new Promise((resolve) => response.once("drain", resolve));
      }
    }
  } finally {
    response.end();
    reader.releaseLock();
  }
}

async function enrichBuildRequestWithFirecrawl(payload) {
  if (!shouldUseFirecrawlForBuild(payload)) {
    return payload;
  }

  if (!FIRECRAWL_API_KEY) {
    throw new Error("Firecrawl was requested, but FIRECRAWL_API_KEY is not configured.");
  }

  const result = await runFirecrawlTool({
    artifactId: payload.projectId,
    mode: payload.sourceMaterial?.urls?.[0] ? "scrape" : "search",
    url: payload.sourceMaterial?.urls?.[0] || "",
    query: cleanFirecrawlQuery(payload.brief),
    limit: 3
  });
  const researchText = [
    payload.sourceMaterial?.text || "",
    "Firecrawl research context:",
    result.summary,
    ...(result.sources || []).map((source) =>
      [source.title, source.url, source.description].filter(Boolean).join(" - ")
    )
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 3600);

  return {
    ...payload,
    sourceMaterial: {
      ...(payload.sourceMaterial || {}),
      text: researchText,
      urls: mergeUniqueStrings([
        ...(payload.sourceMaterial?.urls || []),
        ...(result.sources || []).map((source) => source.url)
      ]).slice(0, 8),
      hasMaterial: true,
      note: "Includes Firecrawl-retrieved web context for clinician review.",
      firecrawl: {
        used: true,
        mode: result.mode,
        query: result.query || "",
        url: result.url || ""
      }
    }
  };
}

function shouldUseFirecrawlForBuild(payload) {
  return /\bfirecrawl|web research|research the web|crawl|scrape\b/i.test(
    `${payload.brief} ${payload.sourceMaterial?.text || ""}`
  );
}

function cleanFirecrawlQuery(value = "") {
  return String(value)
    .replace(/\b(use|with|via)\s+firecrawl\b/gi, " ")
    .replace(/\b(ro|to)\s+generate\b/gi, " generate")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

async function runFirecrawlTool(payload) {
  if (payload.mode === "scrape" && payload.url) {
    return scrapeWithFirecrawl(payload.url);
  }

  if (!payload.query) {
    throw new Error("Firecrawl search query or URL is required.");
  }

  return searchWithFirecrawl(payload.query, payload.limit);
}

async function searchWithFirecrawl(query, limit = 3) {
  const data = await callFirecrawlApi("/v2/search", {
    query,
    limit,
    scrapeOptions: {
      formats: ["markdown"]
    }
  });
  const rows = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.data?.web)
      ? data.data.web
      : Array.isArray(data?.web)
        ? data.web
        : [];
  const sources = rows.slice(0, limit).map(normalizeFirecrawlSource);
  const summary = sources
    .map((source) =>
      [source.title, source.description || source.markdown].filter(Boolean).join(": ")
    )
    .filter(Boolean)
    .join("\n")
    .slice(0, 1800);

  return {
    source: "firecrawl",
    mode: "search",
    query,
    summary,
    sources
  };
}

async function scrapeWithFirecrawl(url) {
  const data = await callFirecrawlApi("/v2/scrape", {
    url,
    formats: ["markdown"]
  });
  const page = data?.data || data || {};
  const source = normalizeFirecrawlSource(page);
  const summary = String(page.markdown || page.content || source.description || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1800);

  return {
    source: "firecrawl",
    mode: "scrape",
    url,
    summary,
    sources: [source]
  };
}

async function callFirecrawlApi(pathname, body) {
  const response = await fetch(`${FIRECRAWL_BASE_URL}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(
      `Firecrawl request failed with ${response.status}: ${String(
        data.error || data.message || text
      ).slice(0, 180)}`
    );
  }

  return data;
}

function normalizeFirecrawlSource(source = {}) {
  const metadata = source.metadata || {};
  return {
    title: String(source.title || metadata.title || "").slice(0, 160),
    url: String(source.url || metadata.url || metadata.sourceURL || "").slice(0, 500),
    description: String(
      source.description || metadata.description || source.snippet || ""
    ).slice(0, 260),
    markdown: String(source.markdown || source.content || "").slice(0, 900)
  };
}

async function generateWithOpenAI(payload) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const openAIResponse = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      max_output_tokens: 3400,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You are a senior clinical product engineer. Return only valid JSON with concise string values. Create Anthropic Artifacts-style patient-facing web artifact specs for health literacy, patient-specific metric tracking, and clinician review. The artifact should be an interactive web surface that can run inside a browser canvas, not a native phone app. Include safety guardrails. Do not give diagnosis or treatment instructions beyond clinician-approved education."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildClinicalPrompt(payload)
            }
          ]
        }
      ],
      text: {
        format: buildOpenAIArtifactFormat()
      }
    })
  });

  if (!openAIResponse.ok) {
    const details = await openAIResponse.text();
    throw new Error(
      `OpenAI request failed with ${openAIResponse.status}: ${details.slice(0, 220)}`
    );
  }

  const data = await openAIResponse.json();
  const content = readOpenAIResponseText(data);
  return parseJsonObject(content);
}

function buildOpenAIArtifactFormat() {
  return {
    type: "json_schema",
    name: "clinical_artifact_spec",
    strict: false,
    schema: {
      type: "object",
      additionalProperties: true,
      properties: {
        title: { type: "string" },
        condition: { type: "string" },
        artifactType: {
          type: "string",
          enum: ["chatbot", "check-in", "tracker", "quiz", "education"]
        },
        specialty: { type: "string" },
        audience: { type: "string" },
        status: { type: "string" },
        description: { type: "string" },
        visibility: { type: "string" },
        patientGroups: {
          type: "array",
          items: { type: "string" }
        },
        modules: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true,
            properties: {
              title: { type: "string" },
              type: { type: "string" },
              detail: { type: "string" }
            }
          }
        },
        appRuntime: { type: "object", additionalProperties: true },
        observability: { type: "object", additionalProperties: true },
        education: { type: "object", additionalProperties: true },
        guardrails: {
          type: "array",
          items: { type: "string" }
        },
        codePlan: { type: "object", additionalProperties: true },
        delivery: { type: "object", additionalProperties: true },
        sourceMaterial: { type: "object", additionalProperties: true },
        toolCapabilities: {
          type: "array",
          items: { type: "object", additionalProperties: true }
        },
        permissions: { type: "object", additionalProperties: true },
        preview: { type: "object", additionalProperties: true }
      }
    }
  };
}

function buildClinicalPrompt(payload) {
  return JSON.stringify({
    platform: platformPositioning,
    task: "Generate a complete interactive web artifact specification for Clinical App Studio.",
    responseRules: [
      "Return one compact JSON object only.",
      "Do not include markdown, comments, prose, code fences, or escaped JSX.",
      "Keep arrays to 3 or 4 items and every detail under 120 characters.",
      "Choose the artifactType that best matches the clinician brief. If the brief asks for a chatbot, chat, triage bot, coach, or conversational flow, use artifactType chatbot.",
      "Always include health-literacy education written at the requested reading level.",
      "Always include metrics, alert rules, cadence, and clinician review context that are specific to the clinician's stated app goal.",
      "If the brief asks for an infographic, explainer, guide, or education artifact without asking for tracking or check-ins, use engagement, teach-back, confidence, strategy-selection, and patient-question metrics rather than clinical symptom or medication tracking.",
      "Do not invent a diagnosis, illness, medication workflow, symptom tracker, or blood-pressure tracker unless the clinician explicitly asks for it.",
      "If the clinician asks for food, meal, nutrition, diet, calorie, macro, or photo-based tracking without naming an illness, make the artifact about nutrition tracking only.",
      "Do not substitute generic metrics when the goal profile provides specific metrics.",
      "When source material is provided, adapt lessons, check-ins, guardrails, and escalation language to that material without quoting long passages.",
      "Enable Baseten runtime LLM calls by default and mark the runtime LLM as multimodal with text and image input modalities.",
      "When useful, expose Firecrawl as a backend-mediated web research/source extraction tool and ElevenLabs as a backend-mediated streaming narration tool in toolCapabilities. Do not put API keys in artifact output."
    ],
    clinicalBrief: payload.brief,
    sourceMaterial: payload.sourceMaterial,
    condition: payload.condition,
    conditionProfile: payload.conditionProfile,
    artifactIntent: payload.artifactIntent,
    distribution: payload.distribution,
    patientGroups: payload.patientGroups,
    specialty: payload.specialty,
    literacyLevel: payload.literacy,
    language: payload.language,
    observabilityGoal: payload.observabilityGoal,
    optionalIntegrations: {
      elevenLabsNarration: payload.voiceEnabled,
      mobileDelivery: ["public link", "QR code", "SMS handoff"],
      availableArtifactTools: buildArtifactToolCapabilities(payload)
    },
    requiredShape: {
      title: "short product name",
      condition: "illness, care goal, or health tracking focus",
      artifactType: "chatbot | check-in | tracker | quiz | education",
      specialty: "clinical specialty",
      audience: "patient audience",
      status: "Draft",
      description: "one sentence describing the generated web artifact",
      visibility: "Public or Assigned patients",
      patientGroups: ["group names"],
      modules: [
        {
          title: "module title",
          type: "chatbot | education | check-in | tracker | quiz | escalation",
          detail: "patient-facing web artifact module detail"
        }
      ],
      appRuntime: {
        kind: "chatbot | check-in | tracker | quiz | education",
        chatbot: {
          openingMessage: "first bot message when kind is chatbot",
          quickReplies: [
            {
              label: "button label",
              response: "bot response after the patient taps it"
            }
          ],
          freeTextFallback: "bot response for typed messages",
          escalationKeywords: ["words that should trigger urgent guidance"],
          escalationResponse: "safe clinician-approved escalation response"
        }
      },
      observability: {
        metrics: ["metric names"],
        alerts: ["alert rules"],
        cadence: "collection cadence",
        clinicianView: "what the clinician sees"
      },
      education: {
        literacy: "reading level",
        language: "language",
        lessons: ["lesson names"],
        quiz: ["short quiz prompts"]
      },
      guardrails: ["safety and privacy guardrails"],
      codePlan: {
        stack: ["artifact frontend/backend pieces"],
        components: ["React artifact component names"],
        integrations: ["integration names, including mobile delivery and voice if enabled"]
      },
      delivery: {
        mobileReady: true,
        channels: ["public link", "QR code", "SMS"],
        voiceNarration: "enabled only when requested"
      },
      sourceMaterial: {
        hasMaterial: true,
        urls: ["reference URLs from clinician source text"],
        summary: "short summary of source material used"
      },
      toolCapabilities: [
        {
          id: "firecrawl",
          provider: "firecrawl",
          enabled: true,
          runtimeEndpoint: "/api/artifact-tools/firecrawl",
          purpose: "web search and source-page extraction"
        },
        {
          id: "elevenlabs",
          provider: "elevenlabs",
          enabled: true,
          runtimeEndpoint: "/api/artifact-tools/elevenlabs/stream",
          purpose: "patient-friendly streaming narration"
        }
      ],
      permissions: {
        sandboxedRuntime: true,
        externalNetwork: false,
        llm: {
          enabled: true,
          provider: "baseten",
          model: BASETEN_MODEL,
          multimodal: true,
          modalities: RUNTIME_LLM_MODALITIES,
          allowedFor: "patient education and check-in support"
        }
      },
      preview: {
        headline: "artifact header headline",
        today: "artifact status card copy",
        primaryMetric: "metric label",
        primaryMetricValue: "metric value",
        nextAction: "next patient action"
      }
    }
  });
}

function readAssistantContent(data) {
  const message = data?.choices?.[0]?.message;
  if (typeof message?.content === "string") {
    return message.content;
  }

  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => part.text || part.content || "")
      .join("")
      .trim();
  }

  throw new Error("Baseten returned no assistant content.");
}

function readOpenAIResponseText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const outputText = (data.output || [])
    .flatMap((item) => item.content || [])
    .map((part) => part.text || part.output_text || "")
    .join("")
    .trim();

  if (outputText) {
    return outputText;
  }

  throw new Error("OpenAI returned no artifact JSON.");
}

function parseJsonObject(content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(content.slice(start, end + 1));
    }

    throw error;
  }
}

function buildBasetenMultimodalMessageContent(artifact, payload) {
  const context = JSON.stringify({
    artifact: {
      title: artifact.title,
      specialty: artifact.specialty,
      audience: artifact.audience,
      description: artifact.description,
      guardrails: artifact.guardrails,
      education: artifact.education,
      observability: artifact.observability
    },
    transcript: payload.transcript
  });
  const text = [
    `Patient message: ${payload.message}`,
    `Image attachments included: ${payload.attachments.length}`,
    "Clinical artifact context:",
    context
  ].join("\n");

  return [
    {
      type: "text",
      text
    },
    ...payload.attachments.map((attachment) => ({
      type: "image_url",
      image_url: {
        url: attachment.url,
        detail: "auto"
      }
    }))
  ];
}

function normalizeAppSpec(spec, payload) {
  const fallback = buildFallbackSpec(payload);
  const title = spec.title || fallback.title;
  const artifactType = normalizeArtifactType(
    spec.artifactType || spec.appRuntime?.kind || fallback.artifactType
  );
  return {
    id: makeArtifactId(spec.id),
    projectId: payload.projectId || spec.projectId || randomUUID(),
    title,
    condition: spec.condition || payload.condition || fallback.condition,
    artifactType,
    specialty: spec.specialty || payload.specialty,
    audience: spec.audience || fallback.audience,
    status: spec.status || "Draft",
    description: spec.description || fallback.description,
    visibility: spec.visibility || toVisibilityLabel(payload.distribution),
    patientGroups: ensureArray(spec.patientGroups, payload.patientGroups),
    modules: ensureArray(spec.modules, fallback.modules),
    appRuntime: normalizeAppRuntime(
      spec.appRuntime || spec.runtime,
      artifactType,
      fallback.appRuntime
    ),
    observability: {
      ...fallback.observability,
      ...(spec.observability || {})
    },
    education: {
      ...fallback.education,
      ...(spec.education || {})
    },
    guardrails: ensureArray(spec.guardrails, fallback.guardrails),
    codePlan: {
      ...fallback.codePlan,
      ...(spec.codePlan || {})
    },
    delivery: {
      ...fallback.delivery,
      ...(spec.delivery || {})
    },
    sourceMaterial: normalizeArtifactSourceMaterial(
      spec.sourceMaterial,
      fallback.sourceMaterial
    ),
    toolCapabilities: normalizeArtifactToolCapabilities(
      spec.toolCapabilities || spec.tools || spec.appRuntime?.tools,
      fallback.toolCapabilities
    ),
    permissions: normalizeArtifactPermissions(
      spec.permissions,
      fallback.permissions
    ),
    preview: {
      ...fallback.preview,
      ...(spec.preview || {})
    }
  };
}

function ensureArray(value, fallback) {
  return Array.isArray(value) && value.length ? value : fallback;
}

function mergeUniqueStrings(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function toVisibilityLabel(distribution) {
  return distribution === "public" ? "Public" : "Assigned patients";
}

function inferArtifactType(brief = "") {
  const text = String(brief).toLowerCase();

  if (/\b(chatbot|chat bot|chat|conversation|conversational|triage bot|coach)\b/.test(text)) {
    return "chatbot";
  }

  if (/\b(quiz|assessment|teach-back|teach back)\b/.test(text)) {
    return "quiz";
  }

  if (/\b(log|tracker|tracking|diary|journal)\b/.test(text)) {
    return "tracker";
  }

  if (/\b(check-in|check in|intake|screening)\b/.test(text)) {
    return "check-in";
  }

  return "education";
}

function normalizeArtifactType(value) {
  const type = String(value || "").toLowerCase().trim();
  if (["chatbot", "check-in", "tracker", "quiz", "education"].includes(type)) {
    return type;
  }
  if (type === "checkin" || type === "form") return "check-in";
  if (type === "chat" || type === "conversation") return "chatbot";
  return "education";
}

function buildFallbackModules(payload, artifactType, conditionProfile) {
  const profile = conditionProfile || payload.conditionProfile || inferConditionProfile({
    brief: payload.brief,
    specialty: payload.specialty
  });

  if (artifactType === "chatbot") {
    return [
      {
        title: "Conversation intake",
        type: "chatbot",
        detail: `Guided ${profile.label} conversation with quick replies and free-text capture.`
      },
      {
        title: "Metric capture",
        type: "tracker",
        detail: `Captures ${profile.metrics.slice(0, 3).join(", ")} for clinician review.`
      },
      {
        title: "Literacy support",
        type: "education",
        detail: `Explains ${profile.lessons.slice(0, 2).join(" and ")} in plain language.`
      },
      {
        title: "Safety handoff",
        type: "escalation",
        detail: "Escalates red-flag phrases to clinician-approved urgent guidance."
      }
    ];
  }

  return [
    {
      title: `${profile.label} metric check-in`,
      type: "check-in",
      detail: `Collects ${profile.metrics.slice(0, 3).join(", ")} and patient notes.`
    },
    {
      title: "Health literacy lesson",
      type: "education",
      detail: `${profile.lessons[0]} at ${payload.literacy} level in ${payload.language}.`
    },
    {
      title: "Teach-back prompt",
      type: "quiz",
      detail: profile.quiz[0]
    },
    {
      title: "Clinician metric trend",
      type: "tracker",
      detail: profile.clinicianView
    }
  ];
}

function buildFallbackRuntime(payload, artifactType, conditionProfile) {
  const kind = normalizeArtifactType(artifactType);
  const profile = conditionProfile || payload.conditionProfile || inferConditionProfile({
    brief: payload.brief,
    specialty: payload.specialty
  });

  if (kind === "chatbot") {
    return {
      kind: "chatbot",
      chatbot: {
        openingMessage:
          `Hi, I can help you track ${profile.label.toLowerCase()} updates and share them with your care team.`,
        quickReplies: [
          {
            label: `Update ${profile.metrics[0]}`,
            response:
              `Tell me your ${profile.metrics[0].toLowerCase()} today and whether it is better, worse, or unchanged.`
          },
          {
            label: "I have a question",
            response:
              "Share your question in your own words. I will save it for the care team to review."
          },
          {
            label: "Review lesson",
            response:
              `${profile.lessons[0]}: tell me what part is confusing and I will capture it for follow-up.`
          }
        ],
        freeTextFallback:
          "Thanks. I captured that for clinician review. Add anything else that would help your care team understand the situation.",
        escalationKeywords: mergeUniqueStrings(profile.escalationKeywords),
        escalationResponse:
          "This may need urgent attention. If you feel in danger or symptoms are severe, call emergency services now. I will still capture this for the care team."
      }
    };
  }

  return {
    kind,
    chatbot: {
      openingMessage: "",
      quickReplies: [],
      freeTextFallback: "",
      escalationKeywords: [],
      escalationResponse: ""
    }
  };
}

function normalizeAppRuntime(runtime, artifactType, fallbackRuntime) {
  const fallback = fallbackRuntime || buildFallbackRuntime({}, artifactType);
  const kind = normalizeArtifactType(runtime?.kind || artifactType || fallback.kind);

  if (kind === "chatbot") {
    const chatbot = runtime?.chatbot || {};
    return {
      kind,
      chatbot: {
        openingMessage: String(
          chatbot.openingMessage ||
            fallback.chatbot?.openingMessage ||
            "Hi, I can help capture what is going on for your care team."
        ).slice(0, 280),
        quickReplies: ensureArray(
          Array.isArray(chatbot.quickReplies)
            ? chatbot.quickReplies
                .map((reply) => ({
                  label: String(reply?.label || "").slice(0, 48),
                  response: String(reply?.response || "").slice(0, 320)
                }))
                .filter((reply) => reply.label && reply.response)
            : [],
          fallback.chatbot?.quickReplies || []
        ).slice(0, 4),
        freeTextFallback: String(
          chatbot.freeTextFallback ||
            fallback.chatbot?.freeTextFallback ||
            "Thanks. I captured that for clinician review."
        ).slice(0, 320),
        escalationKeywords: ensureArray(
          chatbot.escalationKeywords,
          fallback.chatbot?.escalationKeywords || []
        )
          .map((keyword) => String(keyword).slice(0, 40))
          .slice(0, 10),
        escalationResponse: String(
          chatbot.escalationResponse ||
            fallback.chatbot?.escalationResponse ||
            "If symptoms feel severe or emergent, call emergency services now."
        ).slice(0, 360)
      }
    };
  }

  return {
    ...fallback,
    ...(runtime || {}),
    kind
  };
}

function normalizeArtifactPermissions(input = {}, fallback = {}) {
  const llm = input.llm || {};
  const fallbackLlm = fallback.llm || {};
  const explicitlyDisabled = llm.enabled === false && Boolean(llm.disabledBy || llm.disabledAt);

  return {
    sandboxedRuntime:
      input.sandboxedRuntime === undefined
        ? fallback.sandboxedRuntime !== false
        : Boolean(input.sandboxedRuntime),
    externalNetwork: Boolean(input.externalNetwork || fallback.externalNetwork),
    llm: {
      enabled: explicitlyDisabled
        ? false
        : llm.enabled === undefined
          ? fallbackLlm.enabled !== false
          : Boolean(llm.enabled || fallbackLlm.enabled !== false),
      provider: String(llm.provider || fallbackLlm.provider || "baseten").slice(0, 40),
      model: normalizeRuntimeLlmModel(llm.model || fallbackLlm.model),
      multimodal:
        llm.multimodal === undefined
          ? fallbackLlm.multimodal !== false
          : Boolean(llm.multimodal),
      modalities: ensureArray(
        llm.modalities,
        fallbackLlm.modalities || RUNTIME_LLM_MODALITIES
      )
        .map((modality) => String(modality).slice(0, 24))
        .slice(0, 6),
      allowedFor: String(
        llm.allowedFor ||
          fallbackLlm.allowedFor ||
          "patient education and check-in support"
      ).slice(0, 120),
      approvedBy: String(llm.approvedBy || "").slice(0, 80),
      approvedAt: String(llm.approvedAt || "").slice(0, 40),
      disabledBy: String(llm.disabledBy || "").slice(0, 80),
      disabledAt: String(llm.disabledAt || "").slice(0, 40)
    }
  };
}

function normalizeArtifactSourceMaterial(input = {}, fallback = {}) {
  const source = input || {};
  const fallbackSource = fallback || {};
  const urls = ensureArray(source.urls, fallbackSource.urls || [])
    .map((url) => String(url).slice(0, 220))
    .filter(Boolean)
    .slice(0, 8);

  return {
    hasMaterial:
      source.hasMaterial === undefined
        ? Boolean(fallbackSource.hasMaterial || urls.length)
        : Boolean(source.hasMaterial),
    urls,
    summary: String(source.summary || fallbackSource.summary || "").slice(0, 420),
    note: String(source.note || fallbackSource.note || "").slice(0, 220)
  };
}

function normalizeArtifactToolCapabilities(input = [], fallback = []) {
  const tools = ensureArray(input, fallback || []);

  return tools
    .map((tool) => {
      const id = String(tool?.id || tool?.name || tool?.provider || "")
        .toLowerCase()
        .slice(0, 40);
      const provider = String(tool?.provider || tool?.id || "")
        .toLowerCase()
        .slice(0, 40);
      const configured =
        id === "firecrawl" || provider === "firecrawl"
          ? Boolean(FIRECRAWL_API_KEY)
          : id === "elevenlabs" || provider === "elevenlabs"
            ? Boolean(ELEVENLABS_API_KEY)
            : true;
      const runtimeEndpoint =
        id === "firecrawl" || provider === "firecrawl"
          ? "/api/artifact-tools/firecrawl"
          : id === "elevenlabs" || provider === "elevenlabs"
            ? "/api/artifact-tools/elevenlabs/stream"
            : String(tool?.runtimeEndpoint || tool?.endpoint || "").slice(0, 120);

      return {
        id,
        provider,
        enabled: configured && (tool?.enabled === undefined ? true : Boolean(tool.enabled)),
        runtimeEndpoint,
        purpose: String(tool?.purpose || tool?.description || "").slice(0, 160)
      };
    })
    .filter((tool) => tool.id && tool.provider)
    .slice(0, 8);
}

function normalizeRuntimeLlmModel(value) {
  const model = String(value || "").trim();
  const configuredModel = BASETEN_MODEL.slice(0, 80);

  if (
    !model ||
    /^(configured server model|server-configured model|server-configured multimodal model|configured server runtime)$/i.test(
      model
    )
  ) {
    return configuredModel;
  }

  return configuredModel;
}

function buildArtifactToolCapabilities() {
  return [
    {
      id: "firecrawl",
      provider: "firecrawl",
      enabled: Boolean(FIRECRAWL_API_KEY),
      runtimeEndpoint: "/api/artifact-tools/firecrawl",
      purpose: "Search the web or extract source-page context for this artifact."
    },
    {
      id: "elevenlabs",
      provider: "elevenlabs",
      enabled: Boolean(ELEVENLABS_API_KEY),
      runtimeEndpoint: "/api/artifact-tools/elevenlabs/stream",
      purpose: "Stream patient-friendly narration for this artifact."
    }
  ];
}

function buildFallbackSpec(payload) {
  const conditionProfile = payload.conditionProfile || summarizeConditionProfile(
    inferConditionProfile({
      brief: payload.brief,
      specialty: payload.specialty
    })
  );
  const patientGroup =
    payload.patientGroups[0] ||
    conditionProfile.patientGroups?.[0] ||
    "Remote monitoring enrolled patients";
  const title = inferTitle(payload.brief);
  const artifactType = inferArtifactType(payload.brief);
  const appRuntime = buildFallbackRuntime(payload, artifactType, conditionProfile);
  const sourceSummary = summarizeSourceMaterialForArtifact(payload.sourceMaterial);
  const toolCapabilities = buildArtifactToolCapabilities(payload);

  return {
    id: makeArtifactId(),
    projectId: payload.projectId || randomUUID(),
    title,
    condition: payload.condition || conditionProfile.label,
    artifactType,
    specialty: payload.specialty || conditionProfile.specialty,
    audience: patientGroup,
    status: "Draft",
    visibility: toVisibilityLabel(payload.distribution),
    description: `Plain-language ${conditionProfile.label.toLowerCase()} education with patient metric tracking for ${payload.observabilityGoal}.`,
    patientGroups: payload.patientGroups.length
      ? payload.patientGroups
      : [patientGroup],
    modules: buildFallbackModules(payload, artifactType, conditionProfile),
    appRuntime,
    observability: {
      metrics: conditionProfile.metrics,
      alerts: conditionProfile.alerts,
      cadence: conditionProfile.cadence,
      clinicianView: conditionProfile.clinicianView
    },
    education: {
      literacy: payload.literacy,
      language: payload.language,
      lessons: conditionProfile.lessons,
      quiz: conditionProfile.quiz
    },
    guardrails: [
      "Education requires clinician review before publication.",
      "No diagnosis, medication change, or emergency triage is automated.",
      "Only minimum necessary patient observations are collected.",
      "Escalation copy routes patients to approved clinical contact paths."
    ],
    codePlan: {
      stack: ["React artifact canvas", "Clinician telemetry view", "OpenAI artifact generation"],
      components: ["ArtifactShell", "CheckInPanel", "LessonPath", "RiskSignalBoard"],
      integrations: [
        "FHIR export placeholder",
        "Baseten multimodal runtime LLM",
        shouldUseFirecrawlForBuild(payload) ? "Firecrawl web research" : "",
        "Mobile share link",
        "QR code handoff",
        payload.voiceEnabled ? "ElevenLabs narration" : "Audit log"
      ].filter(Boolean)
    },
    delivery: {
      mobileReady: true,
      channels: ["public link", "QR code", "SMS"],
      voiceNarration: payload.voiceEnabled
    },
    sourceMaterial: {
      hasMaterial: Boolean(payload.sourceMaterial?.hasMaterial),
      urls: payload.sourceMaterial?.urls || [],
      summary: sourceSummary,
      note: payload.sourceMaterial?.note || ""
    },
    toolCapabilities,
    permissions: {
      sandboxedRuntime: true,
      externalNetwork: toolCapabilities.some((tool) => tool.enabled),
      llm: {
        enabled: true,
        provider: "baseten",
        model: BASETEN_MODEL,
        multimodal: true,
        modalities: RUNTIME_LLM_MODALITIES,
        allowedFor: "patient education and check-in support"
      }
    },
    preview: {
      headline: title,
      today: `${conditionProfile.label} literacy and metric check-in ready`,
      primaryMetric: conditionProfile.preview?.primaryMetric || conditionProfile.metrics[0],
      primaryMetricValue: conditionProfile.preview?.primaryMetricValue || "Not submitted",
      nextAction:
        conditionProfile.preview?.nextAction ||
        "Review lesson and send today's check-in"
    }
  };
}

function summarizeSourceMaterialForArtifact(sourceMaterial = {}) {
  if (!sourceMaterial.hasMaterial) {
    return "";
  }

  const firstLine = String(sourceMaterial.text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)[0];
  const urlCount = sourceMaterial.urls?.length || 0;
  const sourceLead = firstLine
    ? firstLine.slice(0, 220)
    : "Clinician-provided offboarding/source material";

  return `${sourceLead}${urlCount ? ` (${urlCount} reference link${urlCount === 1 ? "" : "s"})` : ""}`;
}

function normalizeStoredArtifact(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const fallback = buildFallbackSpec({
    brief: input.title || "Patient care artifact",
    condition: input.condition || "",
    distribution:
      input.visibility === "Public" ? "public" : "assigned patients",
    patientGroups: Array.isArray(input.patientGroups) ? input.patientGroups : [],
    specialty: input.specialty || "Primary care",
    literacy: input.education?.literacy || "6th grade",
    language: input.education?.language || "English",
    observabilityGoal: input.description || "patient education",
    sourceMaterial: input.sourceMaterial || {},
    voiceEnabled: Boolean(input.delivery?.voiceNarration)
  });

  return {
    ...fallback,
    ...input,
    id: makeArtifactId(input.id),
    projectId: isUuid(input.projectId) ? input.projectId : fallback.projectId,
    condition: input.condition || fallback.condition,
    artifactType: normalizeArtifactType(
      input.artifactType || input.appRuntime?.kind || fallback.artifactType
    ),
    modules: ensureArray(input.modules, fallback.modules),
    appRuntime: normalizeAppRuntime(
      input.appRuntime || input.runtime,
      normalizeArtifactType(
        input.artifactType || input.appRuntime?.kind || fallback.artifactType
      ),
      fallback.appRuntime
    ),
    patientGroups: ensureArray(input.patientGroups, fallback.patientGroups),
    guardrails: ensureArray(input.guardrails, fallback.guardrails),
    observability: {
      ...fallback.observability,
      ...(input.observability || {})
    },
    education: {
      ...fallback.education,
      ...(input.education || {})
    },
    codePlan: {
      ...fallback.codePlan,
      ...(input.codePlan || {})
    },
    delivery: {
      ...fallback.delivery,
      ...(input.delivery || {})
    },
    sourceMaterial: normalizeArtifactSourceMaterial(
      input.sourceMaterial,
      fallback.sourceMaterial
    ),
    toolCapabilities: normalizeArtifactToolCapabilities(
      input.toolCapabilities || input.tools,
      fallback.toolCapabilities
    ),
    permissions: normalizeArtifactPermissions(
      input.permissions,
      fallback.permissions
    ),
    preview: {
      ...fallback.preview,
      ...(input.preview || {})
    }
  };
}

function storeArtifact(artifact, options = {}) {
  const normalized = normalizeStoredArtifact(artifact);
  const id = options.uniqueOnConflict
    ? ensureUniqueArtifactId(normalized.id)
    : normalized.id;
  const existing = getStoredArtifact(id);
  const now = new Date().toISOString();
  const stored = {
    ...normalized,
    id,
    createdAt: existing?.createdAt || normalized.createdAt || now,
    updatedAt: now
  };

  upsertArtifactRecord(stored);

  const version = createArtifactVersion(stored, {
    allowDuplicate: Boolean(options.allowDuplicateVersion),
    label: options.label || (existing ? "Saved changes" : "Initial version"),
    source: options.source || (existing ? "save" : "create")
  });
  const versionedArtifact = {
    ...stored,
    currentVersion: version.versionNumber,
    versionId: version.id
  };

  upsertArtifactRecord(versionedArtifact);
  return versionedArtifact;
}

function ensureUniqueArtifactId(id) {
  let uniqueId = isUuid(id) ? id.toLowerCase() : randomUUID();

  while (artifactExists(uniqueId)) {
    uniqueId = randomUUID();
  }

  return uniqueId;
}

function listArtifactVersions(id) {
  return artifactDb
    .prepare(`
      SELECT
        id,
        artifact_id,
        version_number,
        label,
        source,
        project_id,
        created_at,
        content_hash,
        artifact_json
      FROM artifact_versions
      WHERE artifact_id = ?
      ORDER BY version_number DESC
    `)
    .all(sanitizeArtifactId(id))
    .map(hydrateArtifactVersion);
}

function findArtifactVersion(id, versionId) {
  const row = artifactDb
    .prepare(`
      SELECT
        id,
        artifact_id,
        version_number,
        label,
        source,
        project_id,
        created_at,
        content_hash,
        artifact_json
      FROM artifact_versions
      WHERE artifact_id = ? AND id = ?
    `)
    .get(sanitizeArtifactId(id), String(versionId || ""));

  return row ? hydrateArtifactVersion(row) : null;
}

function createArtifactVersion(artifact, options = {}) {
  const id = artifact.id;
  const snapshot = snapshotArtifact(artifact);
  const contentHash = hashArtifact(snapshot);
  const latestRow = artifactDb
    .prepare(`
      SELECT
        id,
        artifact_id,
        version_number,
        label,
        source,
        project_id,
        created_at,
        content_hash,
        artifact_json
      FROM artifact_versions
      WHERE artifact_id = ?
      ORDER BY version_number DESC
      LIMIT 1
    `)
    .get(id);
  const latest = latestRow ? hydrateArtifactVersion(latestRow) : null;

  if (!options.allowDuplicate && latest?.contentHash === contentHash) {
    return latest;
  }

  const versionNumber = (latest?.versionNumber || 0) + 1;
  const version = {
    id: randomUUID(),
    artifactId: id,
    versionNumber,
    label: options.label || `Version ${versionNumber}`,
    source: options.source || "save",
    projectId: artifact.projectId || "",
    createdAt: new Date().toISOString(),
    contentHash,
    artifact: snapshot
  };

  artifactDb
    .prepare(`
      INSERT INTO artifact_versions (
        id,
        artifact_id,
        version_number,
        label,
        source,
        project_id,
        created_at,
        content_hash,
        artifact_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      version.id,
      version.artifactId,
      version.versionNumber,
      version.label,
      version.source,
      version.projectId,
      version.createdAt,
      version.contentHash,
      JSON.stringify(version.artifact)
    );

  return version;
}

function hydrateArtifactVersion(row) {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    versionNumber: row.version_number,
    label: row.label,
    source: row.source,
    projectId: row.project_id || "",
    createdAt: row.created_at,
    contentHash: row.content_hash,
    artifact: parseStoredJson(row.artifact_json)
  };
}

function snapshotArtifact(artifact) {
  const snapshot = JSON.parse(JSON.stringify(artifact));
  delete snapshot.currentVersion;
  delete snapshot.updatedAt;
  delete snapshot.versionId;
  delete snapshot.restoredFromVersion;
  return snapshot;
}

function hashArtifact(artifact) {
  return createHash("sha256")
    .update(JSON.stringify(artifact))
    .digest("hex");
}

function sanitizeVersionLabel(value) {
  return String(value || "").trim().slice(0, 80);
}

function sanitizeRecipientLabel(value) {
  return (
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Approved patient"
  );
}

function hasEscalationText(text, artifact) {
  const runtime = normalizeAppRuntime(
    artifact.appRuntime,
    artifact.artifactType,
    buildFallbackRuntime({}, artifact.artifactType)
  );
  const keywords = ensureArray(runtime.chatbot?.escalationKeywords, [
    "chest pain",
    "cannot breathe",
    "trouble breathing",
    "severe",
    "faint",
    "911",
    "emergency"
  ]).map((keyword) => String(keyword).toLowerCase());
  const value = String(text || "").toLowerCase();
  return keywords.some((keyword) => value.includes(keyword));
}

function makeArtifactId(value) {
  const candidate = String(value || "").trim();
  return isUuid(candidate) ? candidate.toLowerCase() : randomUUID();
}

function sanitizeArtifactId(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function inferTitle(brief) {
  const words = brief
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);

  if (!words.length) {
    return "Patient Care Artifact";
  }

  return `${words
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")} Artifact`;
}

function buildAgentReport(mode) {
  const complete = mode === "complete";
  const blocked = mode === "blocked";
  return [
    {
      name: "Clinical planner",
      status: complete ? "complete" : blocked ? "blocked" : "queued",
      detail: blocked
        ? "Artifact generation failed before planning completed."
        : "Mapped the care goal to patient-safe modules."
    },
    {
      name: "Education designer",
      status: complete ? "complete" : blocked ? "blocked" : "queued",
      detail: blocked
        ? "No education artifact was generated."
        : "Drafted literacy-aware lessons and teach-back prompts."
    },
    {
      name: "Observability engineer",
      status: complete ? "complete" : blocked ? "blocked" : "queued",
      detail: blocked
        ? "No telemetry plan was generated."
        : "Selected metrics, cadence, and alert rules."
    },
    {
      name: "App builder",
      status: complete ? "complete" : blocked ? "blocked" : "queued",
      detail: blocked
        ? "No artifact was stored."
        : "Prepared component and integration plan."
    }
  ];
}
