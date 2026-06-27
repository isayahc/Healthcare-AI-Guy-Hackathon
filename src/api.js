export async function generateAppSpec(payload) {
  const response = await fetch("/api/generate-app", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return readApiJson(response, "Unable to generate app.");
}

export async function generateVoicePreview(payload) {
  const response = await fetch("/api/voice-preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return readApiJson(response, "Unable to generate narration.");
}

export async function askArtifactLlm(payload) {
  const response = await fetch("/api/artifact-llm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return readApiJson(response, "Unable to ask artifact LLM.");
}

export async function runFirecrawlTool(payload) {
  const response = await fetch("/api/artifact-tools/firecrawl", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return readApiJson(response, "Unable to run Firecrawl.");
}

export async function createElevenLabsStream(payload) {
  const response = await fetch("/api/artifact-tools/elevenlabs/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return readApiJson(response, "Unable to create narration stream.");
}

export async function storeArtifact(artifact) {
  const response = await fetch("/api/artifacts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ artifact })
  });

  const data = await readApiJson(response, "Unable to store artifact.");

  return data.artifact;
}

export async function listArtifacts() {
  const response = await fetch("/api/artifacts");
  const data = await readApiJson(response, "Unable to load artifacts.");

  return data.artifacts || [];
}

export async function getArtifact(id) {
  const response = await fetch(`/api/artifacts/${encodeURIComponent(id)}`);
  const data = await readApiJson(response, "Unable to load artifact.");

  return data.artifact;
}

export async function getPatientArtifact(id, accessToken = "") {
  const url = new URL(
    `/api/patient-artifacts/${encodeURIComponent(id)}`,
    window.location.origin
  );

  if (accessToken) {
    url.searchParams.set("access", accessToken);
  }

  const response = await fetch(`${url.pathname}${url.search}`);
  const data = await readApiJson(response, "Unable to load patient artifact.");

  return data;
}

export async function getArtifactAccessTokens(id) {
  const response = await fetch(
    `/api/artifacts/${encodeURIComponent(id)}/access-tokens`
  );
  const data = await readApiJson(response, "Unable to load approved links.");

  return data.links || [];
}

export async function createArtifactAccessToken(id, recipientLabel) {
  const response = await fetch(
    `/api/artifacts/${encodeURIComponent(id)}/access-tokens`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ recipientLabel })
    }
  );
  return readApiJson(response, "Unable to create approved link.");
}

export async function revokeArtifactAccessToken(id, tokenId) {
  const response = await fetch(
    `/api/artifacts/${encodeURIComponent(id)}/access-tokens/${encodeURIComponent(
      tokenId
    )}`,
    {
      method: "DELETE"
    }
  );
  return readApiJson(response, "Unable to revoke approved link.");
}

export async function getArtifactVersions(id) {
  const response = await fetch(
    `/api/artifacts/${encodeURIComponent(id)}/versions`
  );
  const data = await readApiJson(response, "Unable to load versions.");

  return data.versions || [];
}

export async function getArtifactTelemetry(id) {
  const response = await fetch(
    `/api/artifacts/${encodeURIComponent(id)}/telemetry`
  );
  const data = await readApiJson(response, "Unable to load telemetry.");

  return data.telemetry;
}

export async function recordArtifactTelemetry(payload) {
  const response = await fetch("/api/telemetry", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return readApiJson(response, "Unable to record telemetry.");
}

export async function saveArtifactVersion(id, label) {
  const response = await fetch(
    `/api/artifacts/${encodeURIComponent(id)}/versions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ label })
    }
  );
  return readApiJson(response, "Unable to save version.");
}

export async function restoreArtifactVersion(id, versionId) {
  const response = await fetch(
    `/api/artifacts/${encodeURIComponent(id)}/versions/${encodeURIComponent(
      versionId
    )}/restore`,
    {
      method: "POST"
    }
  );
  return readApiJson(response, "Unable to restore version.");
}

export async function getPublicUrl() {
  const response = await fetch("/api/public-url");
  const data = await readApiJson(response, "Unable to resolve public URL.");

  return data.publicUrl || "";
}

export async function getAuthConfig() {
  const response = await fetch("/api/auth/config");
  return readApiJson(response, "Unable to load auth configuration.");
}

async function readApiJson(response, fallbackMessage) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  const isJson = contentType.toLowerCase().includes("application/json");

  if (!isJson) {
    const bodyPreview = text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
    const error = new Error(
      `${fallbackMessage} Server returned ${response.status} ${
        response.statusText || ""
      } as ${contentType || "unknown content type"} instead of JSON.${
        bodyPreview ? ` Body: ${bodyPreview}` : ""
      }`
    );
    error.details = {
      error: error.message,
      status: response.status,
      contentType,
      bodyPreview
    };
    throw error;
  }

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (parseError) {
    const error = new Error(`${fallbackMessage} API returned malformed JSON.`);
    error.details = {
      error: error.message,
      status: response.status,
      parseError: parseError.message,
      bodyPreview: text.slice(0, 220)
    };
    throw error;
  }

  if (!response.ok) {
    const error = new Error(data.message || data.error || fallbackMessage);
    error.details = data;
    throw error;
  }

  return data;
}
