import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Bot,
  Braces,
  Check,
  CircleGauge,
  ClipboardList,
  Code2,
  Copy,
  Eye,
  ExternalLink,
  GitBranch,
  Image as ImageIcon,
  LayoutDashboard,
  Library,
  LoaderCircle,
  MessageCircle,
  Play,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Stethoscope,
  UserCheck,
  UsersRound,
  Volume2,
  X
} from "lucide-react";
import {
  askArtifactLlm,
  createElevenLabsStream,
  runFirecrawlTool
} from "../api.js";
import {
  assessArtifactSignal,
  createArtifactRuntimeState,
  createChatRuntimeState,
  formatSubmissionTime,
  formatVersionTime,
  getArtifactPermissions,
  getArtifactRuntimeStorageKey,
  getChatbotRuntime,
  getChatRuntimeStorageKey,
  getSourceLabel,
  getArtifactToolCapabilities,
  getVersionSourceLabel,
  inferClientArtifactType,
  isArtifactLlmEnabled,
  isChatbotApp,
  isEscalationText,
  makeArtifactCode,
  makeGeneratedAppCodePreview,
  randomClientId,
  readArtifactRuntimeState,
  readChatRuntimeState,
  toPublicSpec,
  writeArtifactRuntimeState
} from "../utils/artifacts.js";
import { emitArtifactTelemetry } from "../utils/telemetry.js";

const MAX_ASSISTANT_IMAGE_BYTES = 750000;

export function ArtifactHeader({ app, artifactView, setArtifactView, source }) {
  return (
    <>
      <div className="panel-heading compact artifact-heading">
        <div>
          <p className="eyebrow">Generated artifact</p>
          <h2 id="artifact-title">{app.title}</h2>
        </div>
        <span className={`source-pill ${source}`}>{getSourceLabel(source)}</span>
      </div>

      <div className="artifact-topline">
        <div className="metadata-row">
          {app.condition ? <span>{app.condition}</span> : null}
          <span>{app.specialty}</span>
          <span>{app.visibility}</span>
          <span>{app.status}</span>
          <span>v{app.currentVersion || 1}</span>
          {isArtifactLlmEnabled(app) ? <span>LLM enabled</span> : null}
          {app.projectId ? <span>Project {app.projectId.slice(0, 8)}</span> : null}
        </div>
        <div className="artifact-tabs" role="tablist" aria-label="Artifact views">
          <button
            className={artifactView === "preview" ? "artifact-tab active" : "artifact-tab"}
            onClick={() => setArtifactView("preview")}
            type="button"
          >
            <Eye size={15} aria-hidden="true" />
            Preview
          </button>
          <button
            className={artifactView === "telemetry" ? "artifact-tab active" : "artifact-tab"}
            onClick={() => setArtifactView("telemetry")}
            type="button"
          >
            <CircleGauge size={15} aria-hidden="true" />
            Telemetry
          </button>
          <button
            className={artifactView === "spec" ? "artifact-tab active" : "artifact-tab"}
            onClick={() => setArtifactView("spec")}
            type="button"
          >
            <Braces size={15} aria-hidden="true" />
            Spec
          </button>
          <button
            className={artifactView === "code" ? "artifact-tab active" : "artifact-tab"}
            onClick={() => setArtifactView("code")}
            type="button"
          >
            <Code2 size={15} aria-hidden="true" />
            JSX
          </button>
        </div>
      </div>
    </>
  );
}

export function ArtifactWorkspace({ app, telemetryState, view }) {
  return (
    <div className="artifact-workspace">
      {view === "preview" && <ArtifactPreview app={app} />}
      {view === "telemetry" && (
        <TelemetryDashboard app={app} telemetryState={telemetryState} />
      )}
      {view === "spec" && <ArtifactSpec app={app} telemetryState={telemetryState} />}
      {view === "code" && <ArtifactCode app={app} />}
    </div>
  );
}

export function EmptyArtifactPanel() {
  return (
    <div className="artifact-empty" aria-labelledby="artifact-title">
      <span className="empty-artifact-icon">
        <Sparkles size={24} aria-hidden="true" />
      </span>
      <div>
        <p className="eyebrow">Generated artifact</p>
        <h2 id="artifact-title">No artifact selected</h2>
        <p>Create a new artifact from a prompt or choose one from the library.</p>
      </div>
    </div>
  );
}

export function CodeGenerationPanel({ agents, buildMode, project, speedMode }) {
  const artifactType = inferClientArtifactType(project.prompt);
  const codePreview = makeGeneratedAppCodePreview(project, artifactType);

  return (
    <div className="generation-panel" aria-labelledby="generation-title">
      <div className="generation-heading">
        <div>
          <p className="eyebrow">Project run</p>
          <h2 id="generation-title">
            {project.status === "blocked" ? "Generation blocked" : "Generating app"}
          </h2>
          <span>Project ID: {project.id}</span>
        </div>
        <span className={`source-pill ${project.status}`}>
          {project.status === "blocked" ? "Blocked" : "Coding"}
        </span>
      </div>

      <div className="generation-grid">
        <section className="generation-code">
          <div className="code-heading">
            <Code2 size={18} aria-hidden="true" />
            <strong>
              {artifactType === "chatbot" ? "Chatbot runtime" : "Artifact runtime"}
            </strong>
          </div>
          <pre>
            <code>{codePreview}</code>
          </pre>
        </section>

        <aside className="generation-side">
          <div className="generation-spec">
            <span>Prompt</span>
            <p>{project.prompt}</p>
          </div>
          <div className="generation-spec">
            <span>Mode</span>
            <p>
              {buildMode} / {speedMode}
            </p>
          </div>
          {project.error ? (
            <div className="generation-spec blocked">
              <span>Error</span>
              <p>{project.error}</p>
            </div>
          ) : null}
          <div className="agent-list mini">
            {agents.map((agent) => (
              <article className={`agent-item ${agent.status}`} key={agent.name}>
                <span className="agent-state" aria-hidden="true">
                  {agent.status === "running" ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : agent.status === "complete" || agent.status === "demo" ? (
                    <Check size={15} />
                  ) : agent.status === "blocked" ? (
                    <AlertTriangle size={15} />
                  ) : (
                    <Bot size={15} />
                  )}
                </span>
                <div>
                  <strong>{agent.name}</strong>
                  <p>{agent.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function PatientArtifactPage({ app, error, status }) {
  if (status === "loading") {
    return (
      <main className="patient-page patient-message-page">
        <LoaderCircle className="spin" size={28} aria-hidden="true" />
        <strong>Loading your care artifact</strong>
      </main>
    );
  }

  if (error || !app) {
    return (
      <main className="patient-page patient-message-page">
        <AlertTriangle size={30} aria-hidden="true" />
        <strong>Artifact unavailable</strong>
        <p>{error || "Select an artifact from the library."}</p>
      </main>
    );
  }

  return (
    <main className="patient-page">
      <ArtifactRuntime app={app} mode="patient" />
    </main>
  );
}

function ArtifactRuntime({ app, mode }) {
  const telemetryKeyRef = useRef("");

  useEffect(() => {
    if (mode !== "patient") return;

    const params = new URLSearchParams(window.location.search);
    const key = `${app.id}:${mode}:${params.get("patient") || params.get("role") || ""}`;
    if (telemetryKeyRef.current === key) return;

    telemetryKeyRef.current = key;
    emitArtifactTelemetry(app.id, "artifact_view", {
      mode,
      source: "patient_runtime",
      artifactType: app.artifactType
    });

    if (params.get("patient") === "1") {
      emitArtifactTelemetry(app.id, "share_link_open", {
        mode,
        source: "share_link",
        artifactType: app.artifactType,
        channel: "public_link"
      });
    }
  }, [app.artifactType, app.id, mode]);

  if (isChatbotApp(app)) {
    return <ChatbotArtifact app={app} mode={mode} />;
  }

  if (isInfographicArtifact(app)) {
    return <InfographicArtifact app={app} mode={mode} />;
  }

  return <InteractiveArtifact app={app} mode={mode} />;
}

function isInfographicArtifact(app) {
  const text = `${app.title} ${app.description} ${app.condition} ${app.artifactType}`.toLowerCase();
  const moduleTypes = (app.modules || []).map((module) =>
    String(module.type || "").toLowerCase()
  );

  return (
    String(app.artifactType || "").toLowerCase() === "education" ||
    (moduleTypes.length > 0 &&
      moduleTypes.every((type) => ["education", "quiz", "escalation"].includes(type))) ||
    /\b(infographic|visual guide|explainer|education)\b/.test(text)
  );
}

function ChatbotArtifact({ app, mode }) {
  const isPatient = mode === "patient";
  const runtime = getChatbotRuntime(app);
  const storageKey = useMemo(() => getChatRuntimeStorageKey(app.id), [app.id]);
  const [chatState, setChatState] = useState(() => readChatRuntimeState(app));
  const [draft, setDraft] = useState("");
  const [isLlmResponding, setIsLlmResponding] = useState(false);
  const hasEscalation = chatState.messages.some((message) => message.escalation);
  const llmEnabled = isArtifactLlmEnabled(app);
  const shellClass = isPatient
    ? "patient-artifact chatbot-artifact"
    : "artifact-canvas chatbot-artifact";
  const heroClass = isPatient ? "patient-artifact-header" : "artifact-hero";
  const scoreClass = isPatient ? "patient-artifact-score" : "artifact-score";
  const transcriptLabel = hasEscalation ? "Handoff flagged" : "Conversation open";

  useEffect(() => {
    setChatState(readChatRuntimeState(app));
    setDraft("");
    setIsLlmResponding(false);
  }, [app]);

  useEffect(() => {
    writeArtifactRuntimeState(storageKey, chatState);
  }, [chatState, storageKey]);

  function addExchange(userText, assistantText, escalation = false) {
    const trimmedUserText = userText.trim();
    if (!trimmedUserText) return;

    setChatState((current) => ({
      ...current,
      messages: [
        ...current.messages,
        {
          id: randomClientId(),
          role: "user",
          text: trimmedUserText
        },
        {
          id: randomClientId(),
          role: "assistant",
          text: assistantText,
          escalation
        }
      ],
      lastUpdatedAt: new Date().toISOString()
    }));
  }

  function handleQuickReply(reply) {
    emitArtifactTelemetry(app.id, "quick_reply", {
      mode,
      source: "chatbot",
      escalation: isEscalationText(reply.label, runtime),
      llmEnabled
    });
    addExchange(reply.label, reply.response, isEscalationText(reply.label, runtime));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const userText = draft.trim();
    if (!userText || isLlmResponding) return;

    const escalation = isEscalationText(userText, runtime);
    setDraft("");
    emitArtifactTelemetry(app.id, "chat_message", {
      mode,
      source: "chatbot",
      escalation,
      llmEnabled
    });

    if (!llmEnabled || escalation) {
      addExchange(
        userText,
        escalation ? runtime.escalationResponse : runtime.freeTextFallback,
        escalation
      );
      return;
    }

    setIsLlmResponding(true);
    try {
      const result = await askArtifactLlm({
        artifactId: app.id,
        message: userText,
        transcript: chatState.messages
      });
      addExchange(
        userText,
        result.reply || runtime.freeTextFallback,
        Boolean(result.escalation)
      );
    } catch {
      addExchange(userText, runtime.freeTextFallback, false);
    } finally {
      setIsLlmResponding(false);
    }
  }

  function resetChat() {
    emitArtifactTelemetry(app.id, "chat_reset", {
      mode,
      source: "chatbot"
    });
    setChatState(createChatRuntimeState(app));
    setDraft("");
  }

  return (
    <section className={shellClass} data-artifact-id={app.id} data-app-type="chatbot">
      <header className={heroClass}>
        <div>
          <span className="artifact-kicker">{app.audience}</span>
          {isPatient ? (
            <h1>{app.preview.headline || app.title}</h1>
          ) : (
            <h3>{app.preview.headline || app.title}</h3>
          )}
          <p>{app.description}</p>
        </div>
        <div className={scoreClass}>
          <span>{hasEscalation ? "Safety signal" : "Chat app"}</span>
          <strong>{hasEscalation ? "Review" : "Live"}</strong>
          <small>{transcriptLabel}</small>
        </div>
      </header>

      <section className="chatbot-layout">
        <div className="chatbot-window">
          <div className="artifact-section-heading">
            <MessageCircle size={18} aria-hidden="true" />
            <strong>Chat</strong>
            <span className="lesson-progress">{chatState.messages.length}</span>
            {llmEnabled ? <span className="llm-runtime-pill">LLM</span> : null}
          </div>

          <div className="chat-transcript" aria-live="polite">
            {chatState.messages.map((message) => (
              <article
                className={
                  message.role === "assistant"
                    ? message.escalation
                      ? "chat-message assistant escalation"
                      : "chat-message assistant"
                    : "chat-message user"
                }
                key={message.id}
              >
                <span>{message.role === "assistant" ? "Agent" : "Patient"}</span>
                <p>{message.text}</p>
              </article>
            ))}
          </div>

          <div className="chat-quick-replies" aria-label="Suggested replies">
            {runtime.quickReplies.map((reply) => (
              <button key={reply.label} onClick={() => handleQuickReply(reply)} type="button">
                {reply.label}
              </button>
            ))}
          </div>

          <form className="chat-input-row" onSubmit={handleSubmit}>
            <input
              aria-label="Message the artifact"
              disabled={isLlmResponding}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={isLlmResponding ? "Waiting for response" : "Type a message"}
              value={draft}
            />
            <button disabled={!draft.trim() || isLlmResponding} type="submit">
              {isLlmResponding ? (
                <LoaderCircle className="spin" size={16} aria-hidden="true" />
              ) : (
                <Send size={16} aria-hidden="true" />
              )}
              Send
            </button>
          </form>
        </div>

        <aside className="chatbot-side">
          <section>
            <div className="artifact-section-heading">
              <CircleGauge size={18} aria-hidden="true" />
              <strong>{isPatient ? "Status" : "Clinician view"}</strong>
            </div>
            <div className="signal-card runtime-signal">
              <span className={hasEscalation ? "signal-dot hot" : "signal-dot"} />
              <strong>{transcriptLabel}</strong>
              <p>
                {hasEscalation
                  ? "Conversation contains escalation language."
                  : llmEnabled
                    ? "LLM-assisted responses are enabled for typed patient messages."
                    : app.observability.clinicianView}
              </p>
            </div>
          </section>

          <section>
            <div className="artifact-section-heading">
              <ShieldCheck size={18} aria-hidden="true" />
              <strong>Guardrails</strong>
            </div>
            <div className="patient-guardrails">
              {hasEscalation ? (
                <p className="risk-guidance high">{runtime.escalationResponse}</p>
              ) : null}
              {app.guardrails.slice(0, 3).map((guardrail) => (
                <p key={guardrail}>{guardrail}</p>
              ))}
            </div>
          </section>

          <button className="chat-reset" onClick={resetChat} type="button">
            Reset chat
          </button>
        </aside>
      </section>
    </section>
  );
}

function InfographicArtifact({ app, mode }) {
  const isPatient = mode === "patient";
  const lessons = useMemo(() => app.education.lessons.slice(0, 4), [app]);
  const metrics = useMemo(() => app.observability.metrics.slice(0, 4), [app]);
  const tools = useMemo(() => getArtifactToolCapabilities(app), [app]);
  const firecrawlTool = tools.find(
    (tool) => tool.id === "firecrawl" && tool.enabled
  );
  const elevenLabsTool = tools.find(
    (tool) => tool.id === "elevenlabs" && tool.enabled
  );
  const storageKey = useMemo(() => getArtifactRuntimeStorageKey(app.id), [app.id]);
  const audioRef = useRef(null);
  const [runtimeState, setRuntimeState] = useState(() =>
    createArtifactRuntimeState(app)
  );
  const [activePanel, setActivePanel] = useState(0);
  const [teachBack, setTeachBack] = useState("");
  const [researchState, setResearchState] = useState({
    status: "idle",
    summary: "",
    sources: [],
    error: ""
  });
  const [audioState, setAudioState] = useState({
    status: "idle",
    audioUrl: "",
    error: ""
  });
  const selectedLesson = lessons[activePanel] || lessons[0] || app.title;
  const completedLessonCount = lessons.filter(
    (lesson) => runtimeState.completedLessons[lesson]
  ).length;
  const progress = lessons.length
    ? Math.round((completedLessonCount / lessons.length) * 100)
    : 0;
  const shellClass = isPatient
    ? "patient-artifact infographic-artifact"
    : "artifact-canvas infographic-artifact";
  const heroClass = isPatient ? "patient-artifact-header" : "artifact-hero";
  const scoreClass = isPatient ? "patient-artifact-score" : "artifact-score";
  const stageClass = isPatient
    ? "patient-panel infographic-stage"
    : "artifact-main infographic-stage";
  const toolPanelClass = isPatient
    ? "patient-panel infographic-tools"
    : "artifact-side infographic-tools";
  const bottomPanelClass = isPatient
    ? "patient-panel infographic-bottom"
    : "artifact-bottom infographic-bottom";

  useEffect(() => {
    setRuntimeState(readArtifactRuntimeState(app));
    setActivePanel(0);
    setTeachBack("");
    setResearchState({ status: "idle", summary: "", sources: [], error: "" });
    setAudioState({ status: "idle", audioUrl: "", error: "" });
  }, [app]);

  useEffect(() => {
    writeArtifactRuntimeState(storageKey, runtimeState);
  }, [runtimeState, storageKey]);

  function markPanelComplete(lesson, lessonIndex) {
    const completed = !runtimeState.completedLessons[lesson];
    emitArtifactTelemetry(app.id, "lesson_complete", {
      mode,
      source: "infographic",
      lessonIndex,
      completed
    });
    setRuntimeState((current) => ({
      ...current,
      completedLessons: {
        ...current.completedLessons,
        [lesson]: completed
      },
      status: "editing"
    }));
  }

  function saveTeachBack() {
    emitArtifactTelemetry(app.id, "checkin_submit", {
      mode,
      source: "infographic",
      metricCount: metrics.length,
      completed: Boolean(teachBack.trim())
    });
    setRuntimeState((current) => ({
      ...current,
      note: teachBack,
      lastSubmittedAt: new Date().toISOString(),
      submissions: current.submissions + 1,
      status: "saved"
    }));
  }

  async function handleFirecrawlResearch() {
    setResearchState({ status: "loading", summary: "", sources: [], error: "" });

    try {
      const result = await runFirecrawlTool({
        artifactId: app.id,
        query: `${app.title} ${app.condition} ${selectedLesson}`,
        limit: 3
      });
      emitArtifactTelemetry(app.id, "assistant_query", {
        mode,
        source: "firecrawl",
        hasAttachment: false,
        multimodal: false
      });
      setResearchState({
        status: "ready",
        summary: result.summary || "",
        sources: result.sources || [],
        error: ""
      });
    } catch (error) {
      setResearchState({
        status: "error",
        summary: "",
        sources: [],
        error: error.message
      });
    }
  }

  async function handleNarration() {
    setAudioState({ status: "loading", audioUrl: "", error: "" });

    const text = [
      app.preview.headline || app.title,
      app.description,
      selectedLesson,
      app.modules?.[activePanel]?.detail || app.preview.nextAction
    ]
      .filter(Boolean)
      .join(". ");

    try {
      const result = await createElevenLabsStream({
        artifactId: app.id,
        text
      });
      const audioUrl = result.streamUrl;

      emitArtifactTelemetry(app.id, "voice_stream_start", {
        mode,
        source: "elevenlabs",
        streaming: true
      });
      setAudioState({ status: "streaming", audioUrl, error: "" });

      window.requestAnimationFrame(() => {
        audioRef.current?.play().catch(() => {
          setAudioState((current) =>
            current.audioUrl === audioUrl
              ? { ...current, status: "ready" }
              : current
          );
        });
      });
    } catch (error) {
      setAudioState({ status: "error", audioUrl: "", error: error.message });
    }
  }

  return (
    <section className={shellClass} data-artifact-id={app.id} data-app-type="infographic">
      <header className={heroClass}>
        <div>
          <span className="artifact-kicker">{app.audience}</span>
          {isPatient ? (
            <h1>{app.preview.headline || app.title}</h1>
          ) : (
            <h3>{app.preview.headline || app.title}</h3>
          )}
          <p>{app.description}</p>
        </div>
        <div className={scoreClass}>
          <span>Interactive infographic</span>
          <strong>{progress}%</strong>
          <small>{completedLessonCount}/{lessons.length} panels complete</small>
        </div>
      </header>

      <section className={isPatient ? "patient-artifact-grid" : "artifact-grid"}>
        <div className={stageClass}>
          <div className="artifact-section-heading">
            <BookOpen size={18} aria-hidden="true" />
            <strong>Explore</strong>
            <span className="lesson-progress">{activePanel + 1}/{lessons.length}</span>
          </div>

          <div className="infographic-map">
            {lessons.map((lesson, index) => {
              const isActive = index === activePanel;
              const isComplete = Boolean(runtimeState.completedLessons[lesson]);
              return (
                <button
                  className={
                    isActive
                      ? "infographic-node active"
                      : isComplete
                        ? "infographic-node complete"
                        : "infographic-node"
                  }
                  key={lesson}
                  onClick={() => setActivePanel(index)}
                  type="button"
                >
                  <span>{index + 1}</span>
                  <strong>{lesson}</strong>
                  {isComplete ? <Check size={15} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>

          <article className="infographic-focus">
            <div>
              <span>{app.condition}</span>
              <h3>{selectedLesson}</h3>
              <p>
                {app.modules?.[activePanel]?.detail ||
                  app.education.quiz?.[activePanel] ||
                  app.preview.nextAction}
              </p>
            </div>
            <div className="infographic-visual" aria-hidden="true">
              {metrics.map((metric, index) => (
                <span
                  key={metric}
                  style={{ "--bar": `${42 + index * 14}%` }}
                >
                  {metric}
                </span>
              ))}
            </div>
          </article>

          <div className="infographic-actions">
            <button
              onClick={() => markPanelComplete(selectedLesson, activePanel)}
              type="button"
            >
              <Check size={15} aria-hidden="true" />
              {runtimeState.completedLessons[selectedLesson]
                ? "Marked complete"
                : "Mark panel complete"}
            </button>
          </div>
        </div>

        <aside className={toolPanelClass}>
          <div className="artifact-section-heading">
            <Sparkles size={18} aria-hidden="true" />
            <strong>Artifact tools</strong>
          </div>
          <div className="infographic-tool-list">
            <button
              disabled={!firecrawlTool || researchState.status === "loading"}
              onClick={handleFirecrawlResearch}
              type="button"
            >
              {researchState.status === "loading" ? (
                <LoaderCircle className="spin" size={15} aria-hidden="true" />
              ) : (
                <Search size={15} aria-hidden="true" />
              )}
              Firecrawl research
            </button>
            <button
              disabled={
                !elevenLabsTool ||
                audioState.status === "loading" ||
                audioState.status === "streaming"
              }
              onClick={handleNarration}
              type="button"
            >
              {audioState.status === "loading" ||
              audioState.status === "streaming" ? (
                <LoaderCircle className="spin" size={15} aria-hidden="true" />
              ) : (
                <Volume2 size={15} aria-hidden="true" />
              )}
              Stream narration
            </button>
          </div>
          {!firecrawlTool || !elevenLabsTool ? (
            <p className="tool-note">
              Tool availability depends on the artifact spec and configured server keys.
            </p>
          ) : null}
          {audioState.audioUrl ? (
            <audio
              controls
              onCanPlay={() =>
                setAudioState((current) =>
                  current.status === "streaming"
                    ? { ...current, status: "ready" }
                    : current
                )
              }
              onError={() =>
                setAudioState({
                  status: "error",
                  audioUrl: "",
                  error: "Unable to stream narration."
                })
              }
              ref={audioRef}
              src={audioState.audioUrl}
            />
          ) : null}
          {audioState.status === "error" ? (
            <p className="tool-error">{audioState.error}</p>
          ) : null}
          {researchState.status === "ready" ? (
            <div className="firecrawl-results">
              <strong>Firecrawl context</strong>
              <p>{researchState.summary || "Research completed."}</p>
              {researchState.sources.slice(0, 3).map((source) => (
                <a href={source.url || "#"} key={source.url || source.title} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} aria-hidden="true" />
                  {source.title || source.url || "Source"}
                </a>
              ))}
            </div>
          ) : null}
          {researchState.status === "error" ? (
            <p className="tool-error">{researchState.error}</p>
          ) : null}
        </aside>
      </section>

      <section className={bottomPanelClass}>
        <div className="artifact-section-heading">
          <MessageCircle size={18} aria-hidden="true" />
          <strong>Teach-back</strong>
        </div>
        <div className="teachback-row">
          <textarea
            onChange={(event) => setTeachBack(event.target.value)}
            placeholder="Type what you would tell a patient in your own words."
            value={teachBack}
          />
          <button disabled={!teachBack.trim()} onClick={saveTeachBack} type="button">
            Save response
          </button>
        </div>
        {runtimeState.lastSubmittedAt ? (
          <p className="checkin-note mild" role="status">
            Saved {formatSubmissionTime(runtimeState.lastSubmittedAt)}.
          </p>
        ) : null}
      </section>
    </section>
  );
}

function InteractiveArtifact({ app, mode }) {
  const isPatient = mode === "patient";
  const lessons = useMemo(() => app.education.lessons.slice(0, 4), [app]);
  const metrics = useMemo(() => app.observability.metrics.slice(0, 3), [app]);
  const storageKey = useMemo(() => getArtifactRuntimeStorageKey(app.id), [app.id]);
  const [runtimeState, setRuntimeState] = useState(() =>
    createArtifactRuntimeState(app)
  );
  const [assistantDraft, setAssistantDraft] = useState("");
  const [assistantReply, setAssistantReply] = useState("");
  const [assistantError, setAssistantError] = useState("");
  const [assistantAttachment, setAssistantAttachment] = useState(null);
  const [isAssistantResponding, setIsAssistantResponding] = useState(false);
  const llmEnabled = isArtifactLlmEnabled(app);

  useEffect(() => {
    setRuntimeState(readArtifactRuntimeState(app));
    setAssistantDraft("");
    setAssistantReply("");
    setAssistantError("");
    setAssistantAttachment(null);
    setIsAssistantResponding(false);
  }, [app]);

  useEffect(() => {
    writeArtifactRuntimeState(storageKey, runtimeState);
  }, [runtimeState, storageKey]);

  const completedLessonCount = lessons.filter(
    (lesson) => runtimeState.completedLessons[lesson]
  ).length;
  const progress = lessons.length
    ? Math.round((completedLessonCount / lessons.length) * 100)
    : 0;
  const hasCheckInEntry = metrics.some((metric) =>
    String(runtimeState.checkInValues[metric] || "").trim()
  );
  const signal = assessArtifactSignal(app, runtimeState);
  const submittedLabel = runtimeState.lastSubmittedAt
    ? formatSubmissionTime(runtimeState.lastSubmittedAt)
    : "";

  function updateCheckInValue(metric, value) {
    setRuntimeState((current) => ({
      ...current,
      checkInValues: {
        ...current.checkInValues,
        [metric]: value
      },
      status: "editing"
    }));
  }

  function toggleLesson(lesson, lessonIndex) {
    const completed = !runtimeState.completedLessons[lesson];
    emitArtifactTelemetry(app.id, "lesson_complete", {
      mode,
      source: "lesson",
      lessonIndex,
      completed
    });
    setRuntimeState((current) => ({
      ...current,
      completedLessons: {
        ...current.completedLessons,
        [lesson]: !current.completedLessons[lesson]
      },
      status: "editing"
    }));
  }

  function saveCheckIn() {
    emitArtifactTelemetry(app.id, "checkin_submit", {
      mode,
      source: "checkin",
      metricCount: metrics.length,
      signal: signal.level
    });
    setRuntimeState((current) => ({
      ...current,
      lastSubmittedAt: new Date().toISOString(),
      submissions: current.submissions + 1,
      status: "saved"
    }));
  }

  function buildAssistantTranscript() {
    const completedLessons = lessons.filter(
      (lesson) => runtimeState.completedLessons[lesson]
    );
    const metricSummary = metrics
      .map((metric) => `${metric}: ${runtimeState.checkInValues[metric] || "not entered"}`)
      .join("; ");

    return [
      {
        role: "user",
        text: [
          `Completed lessons: ${completedLessons.join(", ") || "none"}.`,
          `Current metrics: ${metricSummary || "none"}.`,
          `Patient note: ${runtimeState.note || "none"}.`,
          `Current signal: ${signal.label} - ${signal.summary}.`
        ].join(" ")
      }
    ];
  }

  function handleAssistantAttachment(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setAssistantError("");

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setAssistantError("Attach an image file.");
      return;
    }

    if (file.size > MAX_ASSISTANT_IMAGE_BYTES) {
      setAssistantError("Use an image under 750 KB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setAssistantAttachment({
        type: "image",
        mimeType: file.type || "image/png",
        name: file.name,
        url: String(reader.result || "")
      });
    };
    reader.onerror = () => {
      setAssistantError("Could not read that image.");
    };
    reader.readAsDataURL(file);
  }

  async function handleAssistantSubmit(event) {
    event.preventDefault();
    const message = assistantDraft.trim();

    if (!message || isAssistantResponding || !llmEnabled) return;

    setIsAssistantResponding(true);
    setAssistantError("");

    try {
      const result = await askArtifactLlm({
        artifactId: app.id,
        message,
        transcript: buildAssistantTranscript(),
        attachments: assistantAttachment ? [assistantAttachment] : []
      });
      emitArtifactTelemetry(app.id, "assistant_query", {
        mode,
        source: "assistant",
        hasAttachment: Boolean(assistantAttachment),
        multimodal: true
      });
      setAssistantReply(result.reply || "I captured that for your care team.");
      setAssistantDraft("");
      setAssistantAttachment(null);
    } catch (error) {
      setAssistantError(error.message || "Assistant is unavailable.");
    } finally {
      setIsAssistantResponding(false);
    }
  }

  const shellClass = isPatient ? "patient-artifact" : "artifact-canvas";
  const heroClass = isPatient ? "patient-artifact-header" : "artifact-hero";
  const scoreClass = isPatient ? "patient-artifact-score" : "artifact-score";
  const gridClass = isPatient ? "patient-artifact-grid" : "artifact-grid";
  const learnPanelClass = isPatient ? "patient-panel" : "artifact-main";
  const checkInPanelClass = isPatient ? "patient-panel" : "artifact-side";
  const bottomPanelClass = isPatient ? "patient-panel" : "artifact-bottom";

  return (
    <section className={shellClass} data-artifact-id={app.id}>
      <header className={heroClass}>
        <div>
          <span className="artifact-kicker">{app.audience}</span>
          {isPatient ? (
            <h1>{app.preview.headline || app.title}</h1>
          ) : (
            <h3>{app.preview.headline || app.title}</h3>
          )}
          <p>{app.description}</p>
        </div>
        <div className={scoreClass}>
          <span>{runtimeState.lastSubmittedAt ? "Current signal" : app.preview.primaryMetric}</span>
          <strong>{runtimeState.lastSubmittedAt ? signal.label : app.preview.primaryMetricValue}</strong>
          <small>
            {runtimeState.lastSubmittedAt
              ? signal.detail
              : `${app.preview.today} - ${progress}% lessons complete`}
          </small>
        </div>
      </header>

      <section className={gridClass}>
        <div className={learnPanelClass}>
          <div className="artifact-section-heading">
            <BookOpen size={18} aria-hidden="true" />
            <strong>Explore</strong>
            <span className="lesson-progress">{completedLessonCount}/{lessons.length}</span>
          </div>
          <div className="lesson-stack">
            {lessons.map((lesson, index) => {
              const isComplete = Boolean(runtimeState.completedLessons[lesson]);
              return (
                <button
                  className={isComplete ? "lesson-row interactive complete" : "lesson-row interactive"}
                  key={lesson}
                  onClick={() => toggleLesson(lesson, index)}
                  type="button"
                >
                  <span>{index + 1}</span>
                  <div>
                    <strong>{lesson}</strong>
                    <p>
                      {app.modules?.[index]?.detail ||
                        (isComplete ? "Reviewed" : "Tap to update this step")}
                    </p>
                  </div>
                  <Check size={16} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>

        <div className={checkInPanelClass}>
          <div className="artifact-section-heading">
            <Activity size={18} aria-hidden="true" />
            <strong>Check in</strong>
          </div>
          <div className="checkin-form">
            {metrics.map((metric) => (
              <label key={metric}>
                <span>{metric}</span>
                <input
                  onChange={(event) => updateCheckInValue(metric, event.target.value)}
                  placeholder="Type here"
                  value={runtimeState.checkInValues[metric] || ""}
                />
              </label>
            ))}
            <label>
              <span>Anything else?</span>
              <textarea
                onChange={(event) =>
                  setRuntimeState((current) => ({
                    ...current,
                    note: event.target.value,
                    status: "editing"
                  }))
                }
                placeholder="Add questions, context, or notes."
                value={runtimeState.note}
              />
            </label>
            <button disabled={!hasCheckInEntry} onClick={saveCheckIn} type="button">
              {runtimeState.lastSubmittedAt ? "Update check-in" : app.preview.nextAction}
            </button>
            {runtimeState.lastSubmittedAt ? (
              <p className={`checkin-note ${signal.level}`} role="status">
                Saved {submittedLabel}. {signal.summary}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {llmEnabled ? (
        <section
          className={
            isPatient
              ? "patient-panel artifact-assistant-panel"
              : "artifact-bottom artifact-assistant-panel"
          }
        >
          <div className="artifact-section-heading">
            <Sparkles size={18} aria-hidden="true" />
            <strong>Ask assistant</strong>
            <span className="llm-runtime-pill">Multimodal</span>
          </div>
          <form className="artifact-assistant-form" onSubmit={handleAssistantSubmit}>
            <textarea
              aria-label="Ask the assistant"
              disabled={isAssistantResponding}
              onChange={(event) => setAssistantDraft(event.target.value)}
              placeholder="Ask a question or add context for this check-in."
              value={assistantDraft}
            />
            <div className="artifact-assistant-actions">
              <label className="attachment-button">
                <ImageIcon size={16} aria-hidden="true" />
                Add image
                <input
                  accept="image/*"
                  disabled={isAssistantResponding}
                  onChange={handleAssistantAttachment}
                  type="file"
                />
              </label>
              <button
                disabled={!assistantDraft.trim() || isAssistantResponding}
                type="submit"
              >
                {isAssistantResponding ? (
                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                ) : (
                  <Send size={16} aria-hidden="true" />
                )}
                Ask
              </button>
            </div>
          </form>
          {assistantAttachment ? (
            <div className="attachment-chip">
              <ImageIcon size={15} aria-hidden="true" />
              <span>{assistantAttachment.name}</span>
              <button
                aria-label="Remove image"
                onClick={() => setAssistantAttachment(null)}
                type="button"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {assistantError ? (
            <p className="assistant-response error" role="alert">
              {assistantError}
            </p>
          ) : null}
          {assistantReply ? (
            <p className="assistant-response" role="status">
              {assistantReply}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className={bottomPanelClass}>
        <div className="artifact-section-heading">
          {isPatient ? (
            <ShieldCheck size={18} aria-hidden="true" />
          ) : (
            <CircleGauge size={18} aria-hidden="true" />
          )}
          <strong>{isPatient ? "Care guidance" : "Clinician observability"}</strong>
        </div>

        {!isPatient ? (
          <div className="signal-grid">
            <article className={`signal-card runtime-signal ${signal.level}`}>
              <span className={`signal-dot ${signal.level === "high" ? "hot" : ""}`} />
              <strong>{signal.label} check-in signal</strong>
              <p>{runtimeState.lastSubmittedAt ? signal.detail : "Waiting for first check-in."}</p>
            </article>
            {app.observability.alerts.slice(0, 2).map((alert, index) => (
              <article className="signal-card" key={alert}>
                <span className={index === 0 ? "signal-dot hot" : "signal-dot"} />
                <strong>{alert}</strong>
                <p>{app.observability.cadence}</p>
              </article>
            ))}
          </div>
        ) : null}

        <div className="patient-guardrails">
          {runtimeState.lastSubmittedAt ? (
            <p className={`risk-guidance ${signal.level}`}>{signal.guidance}</p>
          ) : null}
          {app.guardrails.slice(0, 3).map((guardrail) => (
            <p key={guardrail}>{guardrail}</p>
          ))}
        </div>
      </section>
    </section>
  );
}

export function PatientLibraryPage({
  activeFilter,
  demoRole,
  error,
  filteredApps,
  filters,
  onChangeRole,
  onSelectApp,
  query,
  selectedApp,
  setActiveFilter,
  setQuery,
  status
}) {
  return (
    <>
      <div className="demo-role-bar" aria-label="Demo role switcher">
        <div>
          <strong>Demo mode</strong>
          <span>Patient library is read-only</span>
        </div>
        <DemoRoleSwitch role={demoRole} onChange={onChangeRole} />
      </div>

      <div className="patient-library-page">
        <aside
          className="patient-library-panel"
          aria-labelledby="patient-library-title"
        >
          <div className="library-heading patient-library-heading">
            <div>
              <p className="eyebrow">Artifacts</p>
              <h2 id="patient-library-title">Library</h2>
            </div>
            <div className="search-box">
              <Search size={17} aria-hidden="true" />
              <input
                aria-label="Search artifacts"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                value={query}
              />
            </div>
          </div>

          <div
            className="filter-row patient-filter-row"
            role="tablist"
            aria-label="Patient library filters"
          >
            {filters.map((filter) => (
              <button
                className={activeFilter === filter ? "filter-chip active" : "filter-chip"}
                key={filter}
                onClick={() => setActiveFilter(filter)}
                type="button"
              >
                {filter}
              </button>
            ))}
          </div>

          {filteredApps.length ? (
            <div className="patient-library-list">
              {filteredApps.map((app) => (
                <article
                  className={
                    selectedApp?.id === app.id
                      ? "app-card patient-library-card selected"
                      : "app-card patient-library-card"
                  }
                  key={app.id}
                >
                  <button type="button" onClick={() => onSelectApp(app)}>
                    <span className="card-icon">
                      <LayoutDashboard size={18} aria-hidden="true" />
                    </span>
                    <span className="card-main">
                      <strong>{app.title}</strong>
                      <span>{app.description}</span>
                    </span>
                    <ArrowUpRight size={17} aria-hidden="true" />
                  </button>
                  <div className="card-meta">
                    {app.condition ? <span>{app.condition}</span> : null}
                    <span>{app.specialty}</span>
                    <span>{app.visibility}</span>
                    <span>v{app.currentVersion || 1}</span>
                    {app.projectId ? <span>Project {app.projectId.slice(0, 8)}</span> : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-library">
              <Library size={22} aria-hidden="true" />
              <strong>No artifacts match this view</strong>
              <span>Change the search or filter to bring artifacts back.</span>
            </div>
          )}
        </aside>

        <section className="patient-library-artifact" aria-label="Selected artifact">
          <PatientArtifactPage app={selectedApp} error={error} status={status} />
        </section>
      </div>
    </>
  );
}

export function DemoRoleSwitch({ role, onChange }) {
  return (
    <div className="role-switch" role="group" aria-label="Demo user type">
      <button
        className={role === "practitioner" ? "active" : ""}
        onClick={() => onChange("practitioner")}
        type="button"
      >
        <Stethoscope size={15} aria-hidden="true" />
        Practitioner
      </button>
      <button
        className={role === "patient" ? "active" : ""}
        onClick={() => onChange("patient")}
        type="button"
      >
        <UserCheck size={15} aria-hidden="true" />
        Patient
      </button>
    </div>
  );
}

export function ArtifactControlDeck({
  accessState,
  app,
  onCopyAccessLink,
  onCopyShareUrl,
  onCreateAccessLink,
  onGenerateVoice,
  onRevokeAccessLink,
  onRestoreVersion,
  onSaveVersion,
  onSetArtifactVisibility,
  onSetLlmEnabled,
  permissionState,
  shareUrl,
  versionState,
  visibilityState,
  voiceEnabled,
  voiceState
}) {
  return (
    <div className="artifact-control-grid" aria-label="Artifact controls">
      <DeliveryPanel
        accessState={accessState}
        app={app}
        onCopyAccessLink={onCopyAccessLink}
        onCopyShareUrl={onCopyShareUrl}
        onCreateAccessLink={onCreateAccessLink}
        onGenerateVoice={onGenerateVoice}
        onRevokeAccessLink={onRevokeAccessLink}
        onSetArtifactVisibility={onSetArtifactVisibility}
        shareUrl={shareUrl}
        visibilityState={visibilityState}
        voiceEnabled={voiceEnabled}
        voiceState={voiceState}
      />
      <CapabilityPanel
        app={app}
        onSetLlmEnabled={onSetLlmEnabled}
        permissionState={permissionState}
      />
      <VersionControlPanel
        app={app}
        onRestoreVersion={onRestoreVersion}
        onSaveVersion={onSaveVersion}
        versionState={versionState}
      />
    </div>
  );
}

export function DeliveryPanel({
  accessState,
  app,
  onCopyAccessLink,
  onCopyShareUrl,
  onCreateAccessLink,
  onGenerateVoice,
  onRevokeAccessLink,
  onSetArtifactVisibility,
  shareUrl,
  visibilityState,
  voiceEnabled,
  voiceState
}) {
  const [recipientLabel, setRecipientLabel] = useState("");
  const isPublic = app.visibility === "Public";
  const accessLinks = accessState?.links || [];
  const qrShareUrl = isPublic
    ? shareUrl
    : accessLinks.find((link) => link.status === "active" && link.shareUrl)?.shareUrl || "";
  const smsBody = encodeURIComponent(
    `${app.title}: open your care artifact here ${shareUrl}`
  );
  const isAccessBusy = ["loading", "saving", "revoking", "refreshing"].includes(
    accessState?.status
  );
  const isVisibilitySaving = visibilityState?.status === "saving";

  async function handleCreateApprovedLink(event) {
    event.preventDefault();
    const createdLink = await onCreateAccessLink?.(recipientLabel);
    if (createdLink) {
      setRecipientLabel("");
    }
  }

  return (
    <div className="delivery-panel">
      <section className="mobile-share">
        <div className="delivery-heading">
          <span className="delivery-icon">
            <Smartphone size={18} aria-hidden="true" />
          </span>
          <div>
            <strong>Send to mobile</strong>
            <p>
              {isPublic
                ? "Use the public link, QR code, or SMS handoff."
                : "Create approved patient links for this private artifact."}
            </p>
          </div>
        </div>
        <div className="visibility-control">
          <div>
            <strong>Access</strong>
            <span>
              {isPublic
                ? "Anyone with the patient link can open this artifact."
                : "Only approved patient links can open this artifact."}
            </span>
          </div>
          <div className="visibility-segments" role="group" aria-label="Artifact access">
            <button
              aria-pressed={isPublic}
              className={isPublic ? "active" : ""}
              disabled={isVisibilitySaving}
              onClick={() => onSetArtifactVisibility?.("Public")}
              type="button"
            >
              <ExternalLink size={14} aria-hidden="true" />
              Public
            </button>
            <button
              aria-pressed={!isPublic}
              className={!isPublic ? "active" : ""}
              disabled={isVisibilitySaving}
              onClick={() => onSetArtifactVisibility?.("Assigned patients")}
              type="button"
            >
              <ShieldCheck size={14} aria-hidden="true" />
              Private
            </button>
          </div>
        </div>
        {visibilityState?.error ? (
          <p className="visibility-error" role="status">
            {visibilityState.error}
          </p>
        ) : null}
        <div className="share-tools">
          <div className="qr-box">
            {qrShareUrl ? (
              <QRCodeSVG value={qrShareUrl} size={72} marginSize={1} />
            ) : null}
          </div>
          <div className="share-link-box">
            <small>Artifact ID: {app.id}</small>
            {isPublic ? (
              <>
                <span>{shareUrl}</span>
                <div className="share-actions">
                  <button type="button" onClick={onCopyShareUrl}>
                    <Copy size={15} aria-hidden="true" />
                    Copy link
                  </button>
                  <a href={`sms:?&body=${smsBody}`}>
                    <Send size={15} aria-hidden="true" />
                    SMS
                  </a>
                  <a href={shareUrl || "#artifact"} target="_blank" rel="noreferrer">
                    <ExternalLink size={15} aria-hidden="true" />
                    Open
                  </a>
                </div>
              </>
            ) : (
              <span>Private: approved patient link required</span>
            )}
          </div>
        </div>

        {!isPublic ? (
          <div className="approved-access">
            <form className="approved-link-form" onSubmit={handleCreateApprovedLink}>
              <input
                aria-label="Approved patient label"
                onChange={(event) => setRecipientLabel(event.target.value)}
                placeholder="Patient name, alias, or recipient label"
                value={recipientLabel}
              />
              <button disabled={isAccessBusy} type="submit">
                {accessState?.status === "saving" ? (
                  <LoaderCircle className="spin" size={15} aria-hidden="true" />
                ) : (
                  <ShieldCheck size={15} aria-hidden="true" />
                )}
                Approve link
              </button>
            </form>

            {accessState?.error ? (
              <p className="approved-link-error" role="status">
                {accessState.error}
              </p>
            ) : null}

            <div className="approved-link-list" aria-label="Approved patient links">
              {accessState?.status === "loading" ? (
                <div className="approved-link-empty">
                  <LoaderCircle className="spin" size={15} aria-hidden="true" />
                  <span>Loading approved links</span>
                </div>
              ) : accessLinks.length ? (
                accessLinks.map((link) => {
                  const isActive = link.status === "active";
                  const linkSmsBody = encodeURIComponent(
                    `${app.title}: open your care artifact here ${link.shareUrl || ""}`
                  );

                  return (
                    <article
                      className={isActive ? "approved-link-row" : "approved-link-row revoked"}
                      key={link.id}
                    >
                      <div>
                        <strong>{link.recipientLabel}</strong>
                        <span>
                          {isActive ? "Active" : "Revoked"} · Created{" "}
                          {formatVersionTime(link.createdAt)}
                          {link.lastUsedAt
                            ? ` · Last opened ${formatVersionTime(link.lastUsedAt)}`
                            : ""}
                        </span>
                        <small>
                          {link.shareUrl
                            ? link.shareUrl
                            : "Full link is shown only when first created."}
                        </small>
                      </div>
                      <div className="approved-link-actions">
                        <button
                          disabled={!isActive || !link.shareUrl}
                          onClick={() => onCopyAccessLink?.(link)}
                          type="button"
                        >
                          <Copy size={14} aria-hidden="true" />
                          Copy
                        </button>
                        {link.shareUrl && isActive ? (
                          <>
                            <a href={`sms:?&body=${linkSmsBody}`}>
                              <Send size={14} aria-hidden="true" />
                              SMS
                            </a>
                            <a href={link.shareUrl} target="_blank" rel="noreferrer">
                              <ExternalLink size={14} aria-hidden="true" />
                              Open
                            </a>
                          </>
                        ) : null}
                        <button
                          disabled={!isActive || isAccessBusy}
                          onClick={() => onRevokeAccessLink?.(link.id)}
                          type="button"
                        >
                          <X size={14} aria-hidden="true" />
                          Revoke
                        </button>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="approved-link-empty">
                  <UsersRound size={15} aria-hidden="true" />
                  <span>No approved patient links yet</span>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </section>

      <section className={voiceEnabled ? "voice-panel enabled" : "voice-panel"}>
        <div className="delivery-heading">
          <span className="delivery-icon">
            <Volume2 size={18} aria-hidden="true" />
          </span>
          <div>
            <strong>ElevenLabs narration</strong>
            <p>
              {voiceEnabled
                ? "Generate a patient-friendly voiceover for this artifact."
                : "Enable the ElevenLabs toggle to add narration."}
            </p>
          </div>
        </div>
        <div className="voice-controls">
          <button
            disabled={!voiceEnabled || voiceState.status === "loading"}
            onClick={onGenerateVoice}
            type="button"
          >
            {voiceState.status === "loading" ? (
              <LoaderCircle className="spin" size={15} aria-hidden="true" />
            ) : (
              <Volume2 size={15} aria-hidden="true" />
            )}
            Generate audio
          </button>
          {voiceState.status === "ready" ? (
            <audio controls src={voiceState.audioUrl} />
          ) : null}
          {voiceState.status === "error" ? (
            <span className="voice-error">{voiceState.error}</span>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function CapabilityPanel({ app, onSetLlmEnabled, permissionState }) {
  const llmEnabled = isArtifactLlmEnabled(app);
  const permissions = getArtifactPermissions(app);
  const isSaving = permissionState.status === "saving";

  return (
    <section className="capability-panel" aria-labelledby="capability-title">
      <div className="delivery-heading capability-heading">
        <span className="delivery-icon">
          <Bot size={18} aria-hidden="true" />
        </span>
        <div>
          <strong id="capability-title">Runtime permissions</strong>
          <p>{permissions.sandboxedRuntime ? "Controlled runtime" : "Open runtime"}</p>
        </div>
      </div>

      <label className="permission-toggle">
        <input
          checked={llmEnabled}
          disabled={isSaving}
          onChange={(event) => onSetLlmEnabled(event.target.checked)}
          type="checkbox"
        />
        <span>
          <strong>Allow LLM calls</strong>
          <small>
            {llmEnabled
              ? `${permissions.llm.provider} · ${permissions.llm.model} · ${
                  permissions.llm.multimodal ? "multimodal" : "text"
                }`
              : "Disabled until practitioner approval"}
          </small>
        </span>
        {isSaving ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : null}
      </label>

      {permissionState.error ? (
        <p className="permission-error" role="status">
          {permissionState.error}
        </p>
      ) : null}
    </section>
  );
}

export function VersionControlPanel({
  app,
  onRestoreVersion,
  onSaveVersion,
  versionState
}) {
  const [label, setLabel] = useState("");
  const versions = versionState.versions || [];
  const currentVersion = app.currentVersion || versions[0]?.versionNumber || 1;
  const isBusy = ["loading", "saving", "restoring"].includes(versionState.status);

  async function handleSubmit(event) {
    event.preventDefault();
    await onSaveVersion(label.trim());
    setLabel("");
  }

  return (
    <section className="version-panel" aria-labelledby="version-title">
      <div className="delivery-heading version-heading">
        <span className="delivery-icon">
          <GitBranch size={18} aria-hidden="true" />
        </span>
        <div>
          <strong id="version-title">Version control</strong>
          <p>
            Current v{currentVersion}
            {app.versionId ? ` - ${app.versionId.slice(0, 8)}` : ""}
          </p>
        </div>
      </div>

      <form className="version-actions" onSubmit={handleSubmit}>
        <input
          aria-label="Version label"
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Snapshot label"
          value={label}
        />
        <button disabled={isBusy} type="submit">
          {versionState.status === "saving" ? (
            <LoaderCircle className="spin" size={15} aria-hidden="true" />
          ) : (
            <Save size={15} aria-hidden="true" />
          )}
          Save snapshot
        </button>
      </form>

      {versionState.error ? (
        <p className="version-error" role="status">
          {versionState.error}
        </p>
      ) : null}

      <div className="version-list" aria-label="Artifact versions">
        {versionState.status === "loading" ? (
          <div className="version-empty">
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
            <span>Loading versions</span>
          </div>
        ) : versions.length ? (
          versions.slice(0, 6).map((version) => {
            const isCurrent = version.versionNumber === currentVersion;
            return (
              <article className={isCurrent ? "version-row current" : "version-row"} key={version.id}>
                <div>
                  <strong>
                    v{version.versionNumber} · {version.label}
                  </strong>
                  <span>
                    {formatVersionTime(version.createdAt)} ·{" "}
                    {getVersionSourceLabel(version.source)}
                  </span>
                </div>
                <button
                  disabled={isBusy || isCurrent}
                  onClick={() => onRestoreVersion(version)}
                  type="button"
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  {isCurrent ? "Current" : "Restore"}
                </button>
              </article>
            );
          })
        ) : (
          <div className="version-empty">
            <GitBranch size={16} aria-hidden="true" />
            <span>No snapshots yet</span>
          </div>
        )}
      </div>
    </section>
  );
}

function ArtifactPreview({ app }) {
  return (
    <div className="artifact-shell" aria-label="Interactive artifact preview">
      <div className="artifact-browser">
        <div className="browser-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="browser-url">clinical.artifacts/{app.id}</div>
        <div className="browser-actions">
          <button type="button" title="Run artifact">
            <Play size={15} aria-hidden="true" />
          </button>
          <button type="button" title="Assign artifact">
            <UsersRound size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      <ArtifactRuntime app={app} mode="preview" />
    </div>
  );
}

function ArtifactSpec({ app, telemetryState }) {
  return (
    <div className="spec-layout">
      <div className="spec-column">
        <h3>Artifact Modules</h3>
        <ModuleList modules={app.modules} />
      </div>
      <div className="spec-column">
        <h3>Observability</h3>
        <TelemetrySummary app={app} telemetryState={telemetryState} />
      </div>
      <div className="spec-column">
        <h3>Source Material</h3>
        <SourceMaterialSummary app={app} />
      </div>
      <div className="spec-json">
        <h3>Structured Spec</h3>
        <pre>{JSON.stringify(toPublicSpec(app), null, 2)}</pre>
      </div>
    </div>
  );
}

function ArtifactCode({ app }) {
  return (
    <div className="code-view">
      <div className="code-heading">
        <Code2 size={18} aria-hidden="true" />
        <strong>Generated React Artifact</strong>
      </div>
      <pre>
        <code>{makeArtifactCode(app)}</code>
      </pre>
    </div>
  );
}

function ModuleList({ modules }) {
  return (
    <div className="module-list">
      {modules.slice(0, 5).map((module) => (
        <article className="module-row" key={`${module.type}-${module.title}`}>
          <span className="module-icon">
            {module.type === "education" ? (
              <BookOpen size={16} aria-hidden="true" />
            ) : module.type === "tracker" ? (
              <Activity size={16} aria-hidden="true" />
            ) : module.type === "quiz" ? (
              <ClipboardList size={16} aria-hidden="true" />
            ) : (
              <Stethoscope size={16} aria-hidden="true" />
            )}
          </span>
          <div>
            <strong>{module.title}</strong>
            <p>{module.detail}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function TelemetryDashboard({ app, telemetryState }) {
  const telemetry = telemetryState?.telemetry;
  const events = telemetry?.events || [];

  return (
    <div className="telemetry-dashboard">
      <div className="telemetry-heading">
        <div>
          <p className="eyebrow">Usage telemetry</p>
          <h3>{app.title}</h3>
        </div>
        <span className={`status-pill ${telemetryState?.status || "idle"}`}>
          {telemetryState?.status === "refreshing"
            ? "Refreshing"
            : telemetryState?.status === "loading"
              ? "Loading"
              : "Live"}
        </span>
      </div>

      {telemetryState?.error ? (
        <p className="telemetry-error">{telemetryState.error}</p>
      ) : null}

      <TelemetrySummary app={app} telemetryState={telemetryState} />

      <div className="telemetry-detail-grid">
        <section className="telemetry-panel">
          <div className="artifact-section-heading">
            <CircleGauge size={18} aria-hidden="true" />
            <strong>Recent activity</strong>
          </div>
          {events.length ? (
            <div className="telemetry-event-list">
              {events.slice(0, 12).map((event) => (
                <article className="telemetry-event" key={event.id}>
                  <span>{getTelemetryEventLabel(event.eventType)}</span>
                  <strong>{formatTelemetryTime(event.createdAt)}</strong>
                  <p>{formatTelemetryMetadata(event.metadata)}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="telemetry-empty">Waiting for patient link activity.</p>
          )}
        </section>

        <section className="telemetry-panel">
          <div className="artifact-section-heading">
            <ClipboardList size={18} aria-hidden="true" />
            <strong>Tracking plan</strong>
          </div>
          <ModuleList
            modules={[
              {
                type: "tracker",
                title: "Patient use",
                detail: "Link opens, artifact views, and active anonymous sessions."
              },
              {
                type: "check-in",
                title: "Check-ins",
                detail: app.observability.metrics.slice(0, 3).join(", ")
              },
              {
                type: "education",
                title: "Health literacy",
                detail: app.education.lessons.slice(0, 3).join(", ")
              },
              {
                type: "escalation",
                title: "Safety signals",
                detail: app.observability.alerts.slice(0, 2).join(", ")
              }
            ]}
          />
        </section>
      </div>
    </div>
  );
}

function SourceMaterialSummary({ app }) {
  const source = app.sourceMaterial || {};

  if (!source.hasMaterial && !source.summary && !source.urls?.length) {
    return (
      <div className="source-summary empty">
        <p>No source material attached.</p>
      </div>
    );
  }

  return (
    <div className="source-summary">
      {source.summary ? <p>{source.summary}</p> : null}
      {source.urls?.length ? (
        <div className="source-link-list">
          {source.urls.slice(0, 4).map((url) => (
            <span key={url}>{url}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TelemetrySummary({ app, telemetryState }) {
  const summary = telemetryState?.telemetry?.summary || {};
  return (
    <div className="telemetry-grid">
      <div className="telemetry-block">
        <span>
          <CircleGauge size={16} aria-hidden="true" />
          Link opens
        </span>
        <strong>{summary.linkOpens || 0}</strong>
        <p>{summary.activeSessions || 0} active anonymous sessions</p>
      </div>
      <div className="telemetry-block">
        <span>
          <UserCheck size={16} aria-hidden="true" />
          Artifact views
        </span>
        <strong>{summary.artifactViews || 0}</strong>
        <p>{summary.patientKeys || 0} patient keys observed</p>
      </div>
      <div className="telemetry-block">
        <span>
          <LayoutDashboard size={16} aria-hidden="true" />
          Use events
        </span>
        <strong>{summary.interactions || 0}</strong>
        <p>{summary.checkIns || 0} check-ins, {summary.assistantUses || 0} assistant uses</p>
      </div>
      <div className="telemetry-block">
        <span>
          <AlertTriangle size={16} aria-hidden="true" />
          Last activity
        </span>
        <strong>{summary.lastEventAt ? formatTelemetryTime(summary.lastEventAt) : "None"}</strong>
        <p>{app.observability.cadence}</p>
      </div>
    </div>
  );
}

function getTelemetryEventLabel(eventType) {
  const labels = {
    share_link_open: "Link opened",
    share_link_copy: "Link copied",
    artifact_view: "Artifact viewed",
    lesson_complete: "Lesson interaction",
    checkin_submit: "Check-in submitted",
    assistant_query: "Assistant used",
    chat_message: "Chat message",
    quick_reply: "Quick reply",
    chat_reset: "Chat reset",
    voice_preview: "Voice preview"
  };

  return labels[eventType] || eventType;
}

function formatTelemetryTime(value) {
  if (!value) return "None";

  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatTelemetryMetadata(metadata = {}) {
  const parts = [];
  if (metadata.mode) parts.push(metadata.mode);
  if (metadata.signal) parts.push(`signal ${metadata.signal}`);
  if (metadata.metricCount !== undefined) parts.push(`${metadata.metricCount} metrics`);
  if (metadata.hasAttachment) parts.push("image attached");
  if (metadata.escalation) parts.push("escalation language");
  return parts.join(" · ") || "Minimum-necessary event";
}
