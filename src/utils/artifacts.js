import { pipelineAgents } from "../data/apps.js";
import {
  adaptProfileForArtifactIntent,
  inferConditionProfile,
  isEducationOnlyArtifactRequest,
  summarizeConditionProfile
} from "../config/clinical.js";

export function toPublicSpec(app) {
  return {
    id: app.id,
    projectId: app.projectId,
    title: app.title,
    condition: app.condition,
    artifactType: app.artifactType,
    distribution: app.visibility,
    audience: app.audience,
    modules: app.modules,
    observability: app.observability,
    education: app.education,
    delivery: app.delivery,
    sourceMaterial: app.sourceMaterial,
    toolCapabilities: getArtifactToolCapabilities(app),
    permissions: getArtifactPermissions(app),
    releaseGates: app.guardrails,
    buildPlan: app.codePlan
  };
}

export function makeArtifactCode(app) {
  if (isChatbotApp(app)) {
    const runtime = getChatbotRuntime(app);
    const quickReplies = runtime.quickReplies
      .map((reply) => JSON.stringify(reply))
      .join(",\n    ");

    return `// artifact ${app.id}
// project ${app.projectId || "unassigned"}
function ${pascalCase(app.title)}Artifact() {
  const llmEnabled = ${JSON.stringify(isArtifactLlmEnabled(app))};
  const [messages, setMessages] = useState([
    ${JSON.stringify({
      role: "assistant",
      text: runtime.openingMessage
    })}
  ]);

  const quickReplies = [
    ${quickReplies}
  ];

  function sendMessage(text) {
    const escalation = ${JSON.stringify(runtime.escalationKeywords)}.some((keyword) =>
      text.toLowerCase().includes(keyword)
    );
    const reply = llmEnabled && !escalation
      ? askArtifactRuntimeLlm(text)
      : Promise.resolve(
          escalation
            ? ${JSON.stringify(runtime.escalationResponse)}
            : ${JSON.stringify(runtime.freeTextFallback)}
        );

    reply.then((assistantText) => {
      setMessages((current) => [
        ...current,
        { role: "patient", text },
        { role: "assistant", text: assistantText, escalation }
      ]);
    });
  }

  return (
    <ChatbotRuntime
      title={${JSON.stringify(app.title)}}
      messages={messages}
      quickReplies={quickReplies}
      onSend={sendMessage}
    />
  );
}`;
  }

  const lessons = app.education.lessons
    .slice(0, 4)
    .map((lesson) => JSON.stringify(lesson))
    .join(", ");
  const metrics = app.observability.metrics
    .slice(0, 3)
    .map((metric) => JSON.stringify(metric))
    .join(", ");
  const tools = getArtifactToolCapabilities(app)
    .filter((tool) => tool.enabled)
    .map((tool) =>
      JSON.stringify({
        id: tool.id,
        endpoint: tool.runtimeEndpoint,
        purpose: tool.purpose
      })
    )
    .join(", ");

  return `// artifact ${app.id}
// project ${app.projectId || "unassigned"}
function ${pascalCase(app.title)}Artifact() {
  const panels = [${lessons}];
  const metrics = [${metrics}];
  const tools = [${tools}];
  const [activePanel, setActivePanel] = useState(panels[0] || "");

  return (
    <main className="patient-artifact generated-artifact">
      <header>
        <p>{${JSON.stringify(app.audience)}}</p>
        <h1>{${JSON.stringify(app.preview.headline || app.title)}}</h1>
        <span>{${JSON.stringify(app.visibility)}}</span>
      </header>

      <section className="artifact-explorer">
        <nav aria-label="Artifact panels">
          {panels.map((panel) => (
            <button
              className={panel === activePanel ? "active" : ""}
              key={panel}
              onClick={() => setActivePanel(panel)}
              type="button"
            >
              {panel}
            </button>
          ))}
        </nav>
        <article>
          <h2>{activePanel}</h2>
          <p>{${JSON.stringify(app.preview.nextAction)}}</p>
        </article>
      </section>

      {tools.length ? (
        <aside className="artifact-tools">
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => runArtifactTool(tool.endpoint, { artifactId: ${JSON.stringify(
                app.id
              )}, query: activePanel })}
              type="button"
            >
              {tool.purpose}
            </button>
          ))}
        </aside>
      ) : null}

      <section className="artifact-metrics">
        {metrics.map((metric) => (
          <label key={metric}>
            {metric}
            <input aria-label={metric} />
          </label>
        ))}
      </section>
    </main>
  );
}`;
}

export function pascalCase(value) {
  return value
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("");
}

export function getSourceLabel(source) {
  if (source === "openai") return "OpenAI";
  if (source === "baseten") return "Baseten";
  if (source === "demo") return "Demo";
  if (source === "running") return "Running";
  if (source === "error") return "Blocked";
  if (source === "shared") return "Shared link";
  if (source === "restore") return "Restored";
  return "Local";
}

export function buildOpenEndedPayload(currentForm, buildMode, speedMode) {
  const brief = currentForm.brief.trim();
  const educationOnly = isEducationOnlyArtifactRequest(brief);
  const conditionProfile = adaptProfileForArtifactIntent(
    inferConditionProfile({
      brief,
      specialty: currentForm.specialty
    }),
    brief
  );
  const publicRequested = /\b(public|publish|publicly|open access)\b/i.test(brief);
  const voiceRequested = /\b(voice|audio|narration|narrate|elevenlabs)\b/i.test(
    brief
  );
  const spanishRequested = /\b(spanish|espanol|español)\b/i.test(brief);
  const englishRequested = /\benglish\b/i.test(brief);
  const language =
    spanishRequested && englishRequested
      ? "English and Spanish"
      : spanishRequested
        ? "Spanish"
        : currentForm.language;

  return {
    ...currentForm,
    brief: [
      brief,
      currentForm.sourceMaterial?.trim()
        ? `Clinician source material: ${currentForm.sourceMaterial.trim()}`
        : "",
      `Clinical focus: ${conditionProfile.label}.`,
      `${
        educationOnly ? "Education engagement metrics" : "Required patient metrics"
      }: ${conditionProfile.metrics.join(", ")}.`,
      `Health literacy lessons: ${conditionProfile.lessons.join(", ")}.`,
      `Agent mode: ${buildMode}. Generation pace: ${speedMode}.`
    ].join("\n"),
    condition: conditionProfile.label,
    conditionProfile: summarizeConditionProfile(conditionProfile),
    distribution: publicRequested ? "public" : currentForm.distribution,
    patientGroups: currentForm.patientGroups?.length
      ? currentForm.patientGroups
      : conditionProfile.patientGroups,
    specialty:
      currentForm.specialty === "Primary care"
        ? conditionProfile.specialty
        : currentForm.specialty,
    language,
    observabilityGoal: conditionProfile.observabilityGoal,
    voiceEnabled: currentForm.voiceEnabled || voiceRequested
  };
}

export function createProjectId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (value) =>
    (
      Number(value) ^
      (Math.floor(Math.random() * 16) >> (Number(value) / 4))
    ).toString(16)
  );
}

export function inferClientArtifactType(prompt = "") {
  const text = String(prompt).toLowerCase();

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

export function makeGeneratedAppCodePreview(project, artifactType) {
  const prompt = project.prompt.replace(/`/g, "'").slice(0, 220);
  const componentName = getGeneratedComponentName(artifactType);

  if (artifactType === "chatbot") {
    return `// project ${project.id}
export function ${componentName}() {
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Hi, tell me what is going on." }
  ]);

  function sendMessage(text) {
    const escalation = /chest pain|trouble breathing|severe|911/i.test(text);
    setMessages((current) => [
      ...current,
      { role: "patient", text },
      {
        role: "assistant",
        text: escalation
          ? "This may need urgent attention. If symptoms feel severe, call emergency services."
          : "Thanks. I captured that for the care team to review.",
        escalation
      }
    ]);
  }

  return <ChatbotRuntime messages={messages} onSend={sendMessage} />;
}

// prompt: ${prompt}`;
  }

  return `// project ${project.id}
export function ${componentName}() {
  const [state, setState] = useState({
    lessons: {},
    checkIn: {},
    saved: false
  });

  function submitCheckIn(values) {
    setState((current) => ({
      ...current,
      checkIn: values,
      saved: true
    }));
  }

  return (
    <PatientArtifactRuntime
      prompt={${JSON.stringify(prompt)}}
      state={state}
      onSubmit={submitCheckIn}
    />
  );
}`;
}

export function getGeneratedComponentName(artifactType) {
  if (artifactType === "chatbot") return "GeneratedChatbotApp";
  if (artifactType === "tracker") return "GeneratedTrackerApp";
  if (artifactType === "quiz") return "GeneratedQuizApp";
  if (artifactType === "check-in") return "GeneratedCheckInApp";
  return "GeneratedPatientArtifact";
}

export function createArtifactRuntimeState(app) {
  const lessons = app.education.lessons.slice(0, 4);
  const metrics = app.observability.metrics.slice(0, 3);

  return {
    appId: app.id,
    completedLessons: lessons.reduce(
      (values, lesson) => ({ ...values, [lesson]: false }),
      {}
    ),
    checkInValues: metrics.reduce(
      (values, metric, index) => ({
        ...values,
        [metric]: index === 0 ? app.preview.primaryMetricValue : ""
      }),
      {}
    ),
    note: "",
    lastSubmittedAt: "",
    submissions: 0,
    status: "idle"
  };
}

export function isChatbotApp(app) {
  const type = String(app.artifactType || app.appRuntime?.kind || "").toLowerCase();
  const moduleTypes = (app.modules || []).map((module) =>
    String(module.type || "").toLowerCase()
  );
  const text = `${app.title} ${app.description}`.toLowerCase();

  return (
    type === "chatbot" ||
    type === "chat" ||
    moduleTypes.includes("chatbot") ||
    /\b(chatbot|chat bot|conversation|conversational|triage bot)\b/.test(text)
  );
}

export function getArtifactPermissions(app) {
  const llm = app.permissions?.llm || {};
  const explicitlyDisabled = llm.enabled === false && Boolean(llm.disabledBy || llm.disabledAt);

  return {
    sandboxedRuntime: app.permissions?.sandboxedRuntime !== false,
    externalNetwork: Boolean(app.permissions?.externalNetwork),
    llm: {
      enabled: !explicitlyDisabled,
      provider: llm.provider || "baseten",
      model: normalizeClientLlmModel(llm.model),
      multimodal: llm.multimodal !== false,
      modalities: Array.isArray(llm.modalities) && llm.modalities.length
        ? llm.modalities
        : ["text", "image"],
      allowedFor: llm.allowedFor || "patient education and check-in support",
      approvedBy: llm.approvedBy || "",
      approvedAt: llm.approvedAt || "",
      disabledBy: llm.disabledBy || "",
      disabledAt: llm.disabledAt || ""
    }
  };
}

export function isArtifactLlmEnabled(app) {
  return Boolean(getArtifactPermissions(app).llm.enabled);
}

export function getArtifactToolCapabilities(app) {
  const tools = Array.isArray(app.toolCapabilities) ? app.toolCapabilities : [];
  const integrations = (app.codePlan?.integrations || []).join(" ").toLowerCase();
  const hasFirecrawl = integrations.includes("firecrawl");
  const hasElevenLabs =
    integrations.includes("elevenlabs") ||
    integrations.includes("narration") ||
    Boolean(app.delivery?.voiceNarration);
  const defaults = [
    hasFirecrawl
      ? {
          id: "firecrawl",
          provider: "firecrawl",
          enabled: true,
          runtimeEndpoint: "/api/artifact-tools/firecrawl",
          purpose: "Web research and source extraction"
        }
      : null,
    hasElevenLabs
      ? {
          id: "elevenlabs",
          provider: "elevenlabs",
          enabled: true,
          runtimeEndpoint: "/api/artifact-tools/elevenlabs/stream",
          purpose: "Patient-friendly streaming narration"
        }
      : null
  ].filter(Boolean);

  return (tools.length ? tools : defaults)
    .map((tool) => {
      const id = String(tool.id || tool.name || tool.provider || "").toLowerCase();
      const provider = String(tool.provider || tool.id || "").toLowerCase();
      const runtimeEndpoint =
        id === "firecrawl" || provider === "firecrawl"
          ? "/api/artifact-tools/firecrawl"
          : id === "elevenlabs" || provider === "elevenlabs"
            ? "/api/artifact-tools/elevenlabs/stream"
            : tool.runtimeEndpoint || tool.endpoint || "";

      return {
        id,
        provider,
        enabled: tool.enabled !== false,
        runtimeEndpoint,
        purpose: tool.purpose || tool.description || ""
      };
    })
    .filter((tool) => tool.id && tool.provider);
}

function normalizeClientLlmModel(model) {
  const value = String(model || "").trim();

  if (
    !value ||
    /^(configured server model|server-configured model|server-configured multimodal model|configured server runtime)$/i.test(value) ||
    value === "deepseek-ai/DeepSeek-V4-Pro"
  ) {
    return "server-configured multimodal model";
  }

  return value;
}

export function withArtifactLlmPermission(app, enabled) {
  const permissions = getArtifactPermissions(app);
  return {
    ...app,
    permissions: {
      ...permissions,
      llm: {
        ...permissions.llm,
        enabled,
        provider: "baseten",
        model: "server-configured multimodal model",
        multimodal: true,
        modalities: ["text", "image"],
        approvedBy: enabled ? "Practitioner demo" : "",
        approvedAt: enabled ? new Date().toISOString() : "",
        disabledBy: enabled ? "" : "Practitioner demo",
        disabledAt: enabled ? "" : new Date().toISOString()
      }
    },
    codePlan: {
      ...app.codePlan,
      integrations: updateLlmIntegrationList(
        app.codePlan?.integrations || [],
        enabled
      )
    }
  };
}

export function getChatbotRuntime(app) {
  const chatbot = app.appRuntime?.chatbot || {};
  return {
    openingMessage:
      chatbot.openingMessage ||
      "Hi, I can help capture what is going on and share it with your care team.",
    quickReplies: ensureClientArray(chatbot.quickReplies, [
      {
        label: "I have a symptom",
        response:
          "Tell me what you are feeling, when it started, and whether it is getting better or worse."
      },
      {
        label: "I have a question",
        response:
          "Share your question in your own words. I will save it for the care team to review."
      },
      {
        label: "When should I get help?",
        response:
          "If symptoms feel severe, sudden, or dangerous, use emergency services. Otherwise, describe what changed."
      }
    ])
      .map((reply) => ({
        label: String(reply.label || "").slice(0, 48),
        response: String(reply.response || "").slice(0, 360)
      }))
      .filter((reply) => reply.label && reply.response)
      .slice(0, 4),
    freeTextFallback:
      chatbot.freeTextFallback ||
      "Thanks. I captured that for clinician review. Add anything else that would help your care team understand the situation.",
    escalationKeywords: ensureClientArray(chatbot.escalationKeywords, [
      "chest pain",
      "cannot breathe",
      "trouble breathing",
      "severe",
      "faint",
      "911",
      "emergency"
    ]).map((keyword) => String(keyword).toLowerCase()),
    escalationResponse:
      chatbot.escalationResponse ||
      "This may need urgent attention. If you feel in danger or symptoms are severe, call emergency services now. I will still capture this for the care team."
  };
}

export function createChatRuntimeState(app) {
  const runtime = getChatbotRuntime(app);
  return {
    appId: app.id,
    messages: [
      {
        id: "opening",
        role: "assistant",
        text: runtime.openingMessage,
        escalation: false
      }
    ],
    lastUpdatedAt: ""
  };
}

export function readChatRuntimeState(app) {
  const baseState = createChatRuntimeState(app);

  if (typeof window === "undefined") {
    return baseState;
  }

  try {
    const rawValue = window.localStorage.getItem(getChatRuntimeStorageKey(app.id));
    if (!rawValue) return baseState;

    const savedState = JSON.parse(rawValue);
    if (savedState?.appId !== app.id || !Array.isArray(savedState.messages)) {
      return baseState;
    }

    return {
      ...baseState,
      ...savedState,
      messages: savedState.messages
        .map((message) => ({
          id: String(message.id || randomClientId()),
          role: message.role === "user" ? "user" : "assistant",
          text: String(message.text || "").slice(0, 600),
          escalation: Boolean(message.escalation)
        }))
        .filter((message) => message.text)
    };
  } catch {
    return baseState;
  }
}

export function getChatRuntimeStorageKey(id) {
  return `clinical-artifact-chat:${id}`;
}

export function isEscalationText(value, runtime) {
  const text = String(value || "").toLowerCase();
  return runtime.escalationKeywords.some((keyword) => text.includes(keyword));
}

export function ensureClientArray(value, fallback) {
  return Array.isArray(value) && value.length ? value : fallback;
}

export function randomClientId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function readArtifactRuntimeState(app) {
  const baseState = createArtifactRuntimeState(app);

  if (typeof window === "undefined") {
    return baseState;
  }

  try {
    const rawValue = window.localStorage.getItem(
      getArtifactRuntimeStorageKey(app.id)
    );
    if (!rawValue) return baseState;

    const savedState = JSON.parse(rawValue);
    if (savedState?.appId !== app.id) return baseState;

    return {
      ...baseState,
      ...savedState,
      completedLessons: {
        ...baseState.completedLessons,
        ...(savedState.completedLessons || {})
      },
      checkInValues: {
        ...baseState.checkInValues,
        ...(savedState.checkInValues || {})
      },
      note: String(savedState.note || ""),
      submissions: Number(savedState.submissions || 0)
    };
  } catch {
    return baseState;
  }
}

export function writeArtifactRuntimeState(storageKey, runtimeState) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(runtimeState));
  } catch {
    // Storage is best-effort for demo artifacts.
  }
}

export function getArtifactRuntimeStorageKey(id) {
  return `clinical-artifact-runtime:${id}`;
}

export function assessArtifactSignal(app, runtimeState) {
  if (!runtimeState.lastSubmittedAt) {
    return {
      level: "low",
      label: "Ready",
      detail: "Waiting for first check-in.",
      summary: "Complete the check-in when ready.",
      guidance: "This artifact is education and collection only."
    };
  }

  const checkInText = [
    ...Object.values(runtimeState.checkInValues),
    runtimeState.note
  ]
    .join(" ")
    .toLowerCase();
  const highWords = [
    "severe",
    "red",
    "911",
    "emergency",
    "cannot breathe",
    "trouble breathing",
    "chest pain",
    "faint",
    "worse"
  ];
  const watchWords = [
    "moderate",
    "yellow",
    "concern",
    "pain",
    "dizzy",
    "missed",
    "high",
    "swelling"
  ];
  const hasHighWord = highWords.some((word) => checkInText.includes(word));
  const hasWatchWord = watchWords.some((word) => checkInText.includes(word));
  const hasHighNumber = Object.entries(runtimeState.checkInValues).some(
    ([metric, value]) => isConcerningMetricValue(metric, value)
  );

  if (hasHighWord || hasHighNumber) {
    return {
      level: "high",
      label: "High",
      detail: "Potential alert for clinician review.",
      summary: "Flagged for prompt clinician review.",
      guidance:
        "If symptoms feel severe or emergent, call emergency services. This artifact does not diagnose or treat."
    };
  }

  if (hasWatchWord) {
    return {
      level: "watch",
      label: "Watch",
      detail: "Check-in has something for the care team to review.",
      summary: "Saved with a watch signal for clinician review.",
      guidance:
        "Your care team can review this context. Use urgent care or emergency services for severe symptoms."
    };
  }

  return {
    level: "low",
    label: "Captured",
    detail: `${app.observability.metrics.length} tracked metrics available.`,
    summary: "Saved for routine clinician review.",
    guidance: "Responses are patient-reported and do not replace clinical advice."
  };
}

export function isConcerningMetricValue(metric, value) {
  const numberMatch = String(value).match(/-?\d+(\.\d+)?/);
  if (!numberMatch) return false;

  const numberValue = Number(numberMatch[0]);
  const metricText = metric.toLowerCase();

  if (metricText.includes("pain") || metricText.includes("score")) {
    return numberValue >= 7;
  }

  if (metricText.includes("dyspnea") || metricText.includes("breath")) {
    return numberValue >= 7;
  }

  if (metricText.includes("weight") && String(value).includes("+")) {
    return numberValue >= 3;
  }

  return false;
}

export function formatSubmissionTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

export function formatVersionTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function getVersionSourceLabel(source) {
  if (source === "restore") return "Restore";
  if (source === "manual") return "Manual";
  if (source === "create") return "Created";
  return "Saved";
}

export function markAgentsComplete(status) {
  return pipelineAgents.map((agent) => ({ ...agent, status }));
}

export function upsertArtifact(artifacts, artifact) {
  const withoutArtifact = artifacts.filter((item) => item.id !== artifact.id);
  return [artifact, ...withoutArtifact];
}

export function mergeArtifacts(artifacts, incomingArtifacts) {
  const incomingIds = new Set(incomingArtifacts.map((artifact) => artifact.id));
  return [
    ...incomingArtifacts,
    ...artifacts.filter((artifact) => !incomingIds.has(artifact.id))
  ];
}

export function updateLlmIntegrationList(integrations, enabled) {
  return mergeUniqueValues([
    ...integrations.filter(
      (integration) =>
        !String(integration).toLowerCase().includes("llm runtime") &&
        !String(integration).toLowerCase().includes("artifact llm")
    ),
    enabled ? "Baseten multimodal artifact LLM runtime" : "LLM runtime disabled"
  ]);
}

export function mergeUniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

export function getArtifactIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("artifact") || "";
}

export function getArtifactAccessTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("access") || params.get("token") || "";
}

export function isPatientArtifactUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("patient") === "1" || params.get("view") === "patient";
}

export function getDemoRoleFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("role") === "patient" ? "patient" : "practitioner";
}

export function writeArtifactUrl(id) {
  if (!id) return;

  const url = new URL(window.location.href);
  url.searchParams.set("artifact", id);
  url.searchParams.delete("access");
  url.searchParams.delete("token");
  url.searchParams.delete("patient");
  url.searchParams.delete("view");
  url.hash = "artifact";
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function writeDemoRoleToUrl(role) {
  const url = new URL(window.location.href);
  if (role === "patient") {
    url.searchParams.set("role", "patient");
    url.searchParams.delete("patient");
    url.searchParams.delete("view");
    url.searchParams.delete("access");
    url.searchParams.delete("token");
    url.hash = "";
  } else {
    url.searchParams.delete("role");
    url.searchParams.delete("access");
    url.searchParams.delete("token");
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function writePatientLibraryUrl(id) {
  if (!id) return;

  const url = new URL(window.location.href);
  url.searchParams.set("artifact", id);
  url.searchParams.set("role", "patient");
  url.searchParams.delete("patient");
  url.searchParams.delete("view");
  url.searchParams.delete("access");
  url.searchParams.delete("token");
  url.hash = "";
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export function makeArtifactShareUrl(base, id, accessToken = "") {
  const url = new URL(window.location.pathname || "/", base);
  url.searchParams.set("artifact", id);
  url.searchParams.set("patient", "1");
  if (accessToken) {
    url.searchParams.set("access", accessToken);
  }
  return url.toString();
}

export function scrollRefToTop(ref, behavior) {
  const element = ref.current;
  if (!element) return;

  const top = element.getBoundingClientRect().top + window.scrollY - 96;
  window.scrollTo({ top: Math.max(0, top), behavior });
}
