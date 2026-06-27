import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  CircleGauge,
  FileHeart,
  LayoutDashboard,
  Library,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Workflow
} from "lucide-react";
import {
  createArtifactAccessToken,
  generateAppSpec,
  generateVoicePreview,
  getArtifact,
  getArtifactAccessTokens,
  getArtifactTelemetry,
  getArtifactVersions,
  getPatientArtifact,
  getPublicUrl,
  listArtifacts,
  revokeArtifactAccessToken,
  restoreArtifactVersion,
  saveArtifactVersion,
  storeArtifact as publishArtifact
} from "./api.js";
import {
  pipelineAgents
} from "./data/apps.js";
import {
  defaultCreateForm,
  exampleBrief,
  libraryFilters,
  platformPositioning
} from "./config/clinical.js";
import {
  AuthGate,
  AuthStatus
} from "./components/AuthGate.jsx";
import {
  clearStoredAuthSession,
  readStoredAuthSession
} from "./utils/auth.js";
import {
  ArtifactHeader,
  ArtifactWorkspace,
  ArtifactControlDeck,
  CodeGenerationPanel,
  DemoRoleSwitch,
  EmptyArtifactPanel,
  PatientArtifactPage,
  PatientLibraryPage
} from "./components/artifact-components.jsx";
import {
  buildOpenEndedPayload,
  createProjectId,
  formatVersionTime,
  getArtifactAccessTokenFromUrl,
  getArtifactIdFromUrl,
  getDemoRoleFromUrl,
  isArtifactLlmEnabled,
  isPatientArtifactUrl,
  makeArtifactShareUrl,
  markAgentsComplete,
  scrollRefToTop,
  upsertArtifact,
  withArtifactLlmPermission,
  writeArtifactUrl,
  writeDemoRoleToUrl,
  writePatientLibraryUrl
} from "./utils/artifacts.js";
import { emitArtifactTelemetry } from "./utils/telemetry.js";

function App({ clerkEnabled = false }) {
  const [authSession, setAuthSession] = useState(() =>
    clerkEnabled ? null : readStoredAuthSession()
  );
  const [form, setForm] = useState(defaultCreateForm);
  const [apps, setApps] = useState([]);
  const [selectedApp, setSelectedApp] = useState(null);
  const [agents, setAgents] = useState(pipelineAgents);
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [artifactView, setArtifactView] = useState("preview");
  const [isGenerating, setIsGenerating] = useState(false);
  const [source, setSource] = useState("seed");
  const [activeNav, setActiveNav] = useState("Create");
  const [shareUrl, setShareUrl] = useState("");
  const [publicBaseUrl, setPublicBaseUrl] = useState("");
  const [buildMode, setBuildMode] = useState("Autopilot");
  const [speedMode, setSpeedMode] = useState("Fast");
  const [activeProject, setActiveProject] = useState(null);
  const [builderMessages, setBuilderMessages] = useState([]);
  const [forcedPatientMode] = useState(() => isPatientArtifactUrl());
  const [demoRole, setDemoRole] = useState(() => getDemoRoleFromUrl());
  const [patientLoadState, setPatientLoadState] = useState({
    status: isPatientArtifactUrl() ? "loading" : "ready",
    error: ""
  });
  const [voiceState, setVoiceState] = useState({
    status: "idle",
    audioUrl: "",
    error: ""
  });
  const [versionState, setVersionState] = useState({
    status: "idle",
    versions: [],
    error: ""
  });
  const [permissionState, setPermissionState] = useState({
    status: "idle",
    error: ""
  });
  const [telemetryState, setTelemetryState] = useState({
    status: "idle",
    telemetry: null,
    error: ""
  });
  const [accessState, setAccessState] = useState({
    status: "idle",
    links: [],
    error: ""
  });
  const [visibilityState, setVisibilityState] = useState({
    status: "idle",
    error: ""
  });
  const createRef = useRef(null);
  const artifactRef = useRef(null);
  const libraryRef = useRef(null);
  const hasBootstrappedRef = useRef(false);

  const filters = useMemo(() => libraryFilters, []);

  const filteredApps = useMemo(() => {
    const searchText = query.trim().toLowerCase();
    return apps.filter((app) => {
      const haystack = `${app.title} ${app.condition || ""} ${app.specialty} ${app.audience} ${app.description}`;
      const matchesSearch = haystack.toLowerCase().includes(searchText);
      const matchesFilter =
        activeFilter === "All" ||
        app.status === activeFilter ||
        app.visibility === activeFilter;
      return matchesSearch && matchesFilter;
    });
  }, [activeFilter, apps, query]);

  const patientLibraryApps = useMemo(
    () => filteredApps.filter((app) => app.visibility === "Public"),
    [filteredApps]
  );
  const patientSelectedApp =
    selectedApp?.visibility === "Public" ? selectedApp : null;

  const effectiveRole = forcedPatientMode ? "patient" : demoRole;
  const requiresPractitionerAuth = effectiveRole === "practitioner" && !forcedPatientMode;
  const handleAuthenticated = useCallback((session) => {
    setAuthSession(session);
  }, []);
  const handleSignOut = useCallback(() => {
    clearStoredAuthSession();
    setAuthSession(null);
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    const submittedForm = { ...form };
    const prompt = submittedForm.brief.trim();
    if (!prompt) return;

    const projectId = createProjectId();
    const startedAt = new Date().toISOString();
    const runMessageId = `${projectId}-run`;
    const project = {
      id: projectId,
      prompt,
      status: "generating",
      startedAt,
      artifactId: "",
      artifactTitle: ""
    };
    const sourceMaterial = String(submittedForm.sourceMaterial || "").trim();

    setActiveProject(project);
    setBuilderMessages((current) =>
      [
        ...current,
        {
          id: `${projectId}-prompt`,
          role: "user",
          text: prompt,
          sourceMaterial,
          createdAt: startedAt
        },
        {
          id: runMessageId,
          role: "assistant",
          status: "running",
          text: "Generating artifact",
          projectId,
          createdAt: startedAt
        }
      ].slice(-10)
    );
    setIsGenerating(true);
    setSource("running");
    setArtifactView("code");
    setActiveNav("Create");
    resetVoiceState();
    runAgentAnimation();
    window.requestAnimationFrame(() => {
      scrollRefToTop(artifactRef, "smooth");
    });

    try {
      const payload = {
        ...buildOpenEndedPayload(submittedForm, buildMode, speedMode),
        projectId
      };
      setForm((current) => ({
        ...current,
        brief: "",
        sourceMaterial: "",
        distribution: payload.distribution,
        language: payload.language,
        voiceEnabled: payload.voiceEnabled
      }));
      const result = await generateAppSpec(payload);
      const generatedApp = {
        ...result.app,
        projectId: result.app.projectId || projectId
      };
      setSelectedApp(generatedApp);
      setSource(result.source);
      setArtifactView("preview");
      writeArtifactUrl(generatedApp.id);
      setActiveProject({
        ...project,
        status: "rendered",
        artifactId: generatedApp.id,
        artifactTitle: generatedApp.title
      });
      setBuilderMessages((current) =>
        current.map((message) =>
          message.id === runMessageId
            ? {
                ...message,
                status: "complete",
                text: "Rendered artifact",
                artifactId: generatedApp.id,
                artifactTitle: generatedApp.title,
                updatedAt: new Date().toISOString()
              }
            : message
        )
      );
      setAgents(result.agents || markAgentsComplete("complete"));
      setApps((currentApps) => upsertArtifact(currentApps, generatedApp));
      loadArtifactVersions(generatedApp.id).catch(() => {});
      loadArtifactAccessTokens(generatedApp.id).catch(() => {});
    } catch (error) {
      setActiveProject({
        ...project,
        status: "blocked",
        error: error.message
      });
      setBuilderMessages((current) =>
        current.map((message) =>
          message.id === runMessageId
            ? {
                ...message,
                status: "blocked",
                text: "Generation blocked",
                error: error.message,
                updatedAt: new Date().toISOString()
              }
            : message
        )
      );
      setSource("error");
      setAgents(
        error.details?.agents ||
          markAgentsComplete("blocked").map((agent, index) =>
            index === 3 ? { ...agent, detail: error.message } : agent
          )
      );
    } finally {
      setIsGenerating(false);
    }
  }

  function runAgentAnimation() {
    setAgents(
      pipelineAgents.map((agent, index) => ({
        ...agent,
        status: index === 0 ? "running" : "queued"
      }))
    );

    pipelineAgents.forEach((_agent, index) => {
      window.setTimeout(() => {
        setAgents((current) =>
          current.map((item, itemIndex) => {
            if (itemIndex < index) {
              return { ...item, status: "complete" };
            }
            if (itemIndex === index) {
              return { ...item, status: "running" };
            }
            return { ...item, status: "queued" };
          })
        );
      }, 650 * index);
    });
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function scrollToSection(ref, navItem, hash) {
    setActiveNav(navItem);
    if (hash && window.location.hash !== hash) {
      const url = new URL(window.location.href);
      url.hash = hash;
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    window.requestAnimationFrame(() => {
      scrollRefToTop(ref, "smooth");
    });
  }

  function handleSelectLibraryApp(app) {
    setSelectedApp(app);
    setArtifactView("preview");
    setSource("library");
    setActiveProject(null);
    resetVoiceState();
    writeArtifactUrl(app.id);
    loadArtifactAccessTokens(app.id).catch(() => {});
    scrollToSection(artifactRef, "Create", "#artifact");
  }

  function handleSelectPatientLibraryApp(app) {
    if (app.visibility !== "Public") {
      setPatientLoadState({
        status: "error",
        error: "This private artifact requires an approved patient link."
      });
      return;
    }

    setSelectedApp(app);
    setArtifactView("preview");
    setActiveProject(null);
    setPatientLoadState({ status: "ready", error: "" });
    writePatientLibraryUrl(app.id);
  }

  async function handleGenerateVoice() {
    if (!selectedApp) return;

    setVoiceState({ status: "loading", audioUrl: "", error: "" });
    emitArtifactTelemetry(selectedApp.id, "voice_preview", {
      mode: "practitioner",
      source: "delivery"
    });

    try {
      const result = await generateVoicePreview({ app: selectedApp });
      const byteCharacters = atob(result.audioContent);
      const byteNumbers = Array.from(byteCharacters, (character) =>
        character.charCodeAt(0)
      );
      const blob = new Blob([new Uint8Array(byteNumbers)], {
        type: result.mimeType
      });
      const audioUrl = URL.createObjectURL(blob);
      setVoiceState({ status: "ready", audioUrl, error: "" });
    } catch (error) {
      setVoiceState({
        status: "error",
        audioUrl: "",
        error: error.message
      });
    }
  }

  async function handleCopyShareUrl() {
    if (!shareUrl) return;

    await navigator.clipboard.writeText(shareUrl);
    if (selectedApp?.id) {
      emitArtifactTelemetry(selectedApp.id, "share_link_copy", {
        mode: "practitioner",
        source: "delivery",
        channel: "clipboard"
      });
      loadArtifactTelemetry(selectedApp.id).catch(() => {});
    }
  }

  async function handleCreateAccessLink(recipientLabel) {
    if (!selectedApp?.id) return null;

    setAccessState((current) => ({
      ...current,
      status: "saving",
      error: ""
    }));

    try {
      const result = await createArtifactAccessToken(
        selectedApp.id,
        recipientLabel
      );
      const base = publicBaseUrl || window.location.origin;
      const createdLink = {
        ...result.link,
        shareUrl: makeArtifactShareUrl(
          base,
          selectedApp.id,
          result.link?.token || ""
        )
      };
      const currentUrlById = new Map(
        accessState.links
          .filter((link) => link.shareUrl)
          .map((link) => [link.id, link.shareUrl])
      );
      const links = (result.links || []).map((link) => ({
        ...link,
        shareUrl: link.id === createdLink.id ? createdLink.shareUrl : currentUrlById.get(link.id) || ""
      }));

      setAccessState({
        status: "ready",
        links,
        error: ""
      });

      return createdLink;
    } catch (error) {
      setAccessState((current) => ({
        ...current,
        status: "error",
        error: error.message
      }));
      return null;
    }
  }

  async function handleCopyAccessLink(link) {
    if (!link?.shareUrl) return;

    await navigator.clipboard.writeText(link.shareUrl);
    if (selectedApp?.id) {
      emitArtifactTelemetry(selectedApp.id, "share_link_copy", {
        mode: "practitioner",
        source: "delivery",
        channel: "approved_link"
      });
      loadArtifactTelemetry(selectedApp.id).catch(() => {});
    }
  }

  async function handleRevokeAccessLink(linkId) {
    if (!selectedApp?.id || !linkId) return;

    setAccessState((current) => ({
      ...current,
      status: "revoking",
      error: ""
    }));

    try {
      const result = await revokeArtifactAccessToken(selectedApp.id, linkId);
      setAccessState((current) => {
        const currentUrlById = new Map(
          current.links
            .filter((link) => link.shareUrl)
            .map((link) => [link.id, link.shareUrl])
        );
        return {
          status: "ready",
          links: (result.links || []).map((link) => ({
            ...link,
            shareUrl: currentUrlById.get(link.id) || ""
          })),
          error: ""
        };
      });
    } catch (error) {
      setAccessState((current) => ({
        ...current,
        status: "error",
        error: error.message
      }));
    }
  }

  async function handleSetArtifactVisibility(visibility) {
    if (!selectedApp) return;

    const normalizedVisibility =
      visibility === "Public" ? "Public" : "Assigned patients";
    if (selectedApp.visibility === normalizedVisibility) return;

    const previousApp = selectedApp;
    const updatedApp = {
      ...selectedApp,
      visibility: normalizedVisibility
    };

    setVisibilityState({ status: "saving", error: "" });
    setSelectedApp(updatedApp);
    setApps((currentApps) => upsertArtifact(currentApps, updatedApp));

    try {
      const storedApp = await publishArtifact(updatedApp);
      setSelectedApp(storedApp);
      setApps((currentApps) => upsertArtifact(currentApps, storedApp));
      setVisibilityState({ status: "ready", error: "" });
      loadArtifactVersions(storedApp.id).catch(() => {});
      loadArtifactAccessTokens(storedApp.id).catch(() => {});
    } catch (error) {
      setSelectedApp(previousApp);
      setApps((currentApps) => upsertArtifact(currentApps, previousApp));
      setVisibilityState({ status: "error", error: error.message });
    }
  }

  async function handleSetArtifactLlmEnabled(enabled) {
    if (!selectedApp) return;

    const updatedApp = withArtifactLlmPermission(selectedApp, enabled);
    setPermissionState({ status: "saving", error: "" });
    setSelectedApp(updatedApp);
    setApps((currentApps) => upsertArtifact(currentApps, updatedApp));

    try {
      const storedApp = await publishArtifact(updatedApp);
      setSelectedApp(storedApp);
      setApps((currentApps) => upsertArtifact(currentApps, storedApp));
      setPermissionState({ status: "ready", error: "" });
      loadArtifactVersions(storedApp.id).catch(() => {});
    } catch (error) {
      setPermissionState({ status: "error", error: error.message });
    }
  }

  async function handleSaveArtifactVersion(label) {
    if (!selectedApp?.id) return;

    setVersionState((current) => ({
      ...current,
      status: "saving",
      error: ""
    }));

    try {
      const result = await saveArtifactVersion(
        selectedApp.id,
        label || `Snapshot ${formatVersionTime(new Date().toISOString())}`
      );
      const savedVersion = result.version;
      setVersionState({
        status: "ready",
        versions: result.versions || [],
        error: ""
      });
      setSelectedApp((current) =>
        current.id === selectedApp.id
          ? {
              ...current,
              currentVersion: savedVersion.versionNumber,
              versionId: savedVersion.id
            }
          : current
      );
      setApps((currentApps) =>
        currentApps.map((app) =>
          app.id === selectedApp.id
            ? {
                ...app,
                currentVersion: savedVersion.versionNumber,
                versionId: savedVersion.id
              }
            : app
        )
      );
    } catch (error) {
      setVersionState((current) => ({
        ...current,
        status: "error",
        error: error.message
      }));
    }
  }

  async function handleRestoreArtifactVersion(version) {
    if (!selectedApp?.id || !version?.id) return;

    setVersionState((current) => ({
      ...current,
      status: "restoring",
      error: ""
    }));

    try {
      const result = await restoreArtifactVersion(selectedApp.id, version.id);
      setSelectedApp(result.artifact);
      setApps((currentApps) => upsertArtifact(currentApps, result.artifact));
      setSource("restore");
      setArtifactView("preview");
      setVersionState({
        status: "ready",
        versions: result.versions || [],
        error: ""
      });
      writeArtifactUrl(result.artifact.id);
      loadArtifactAccessTokens(result.artifact.id).catch(() => {});
    } catch (error) {
      setVersionState((current) => ({
        ...current,
        status: "error",
        error: error.message
      }));
    }
  }

  function resetVoiceState() {
    setVoiceState({ status: "idle", audioUrl: "", error: "" });
  }

  const loadArtifactVersions = useCallback(
    async (artifactId = selectedApp?.id) => {
      if (effectiveRole !== "practitioner" || !artifactId) {
        setVersionState({ status: "idle", versions: [], error: "" });
        return;
      }

      setVersionState((current) => ({
        ...current,
        status: "loading",
        error: ""
      }));

      try {
        const versions = await getArtifactVersions(artifactId);
        setVersionState({ status: "ready", versions, error: "" });
      } catch (error) {
        setVersionState({
          status: "error",
          versions: [],
          error: error.message
        });
      }
    },
    [effectiveRole, selectedApp?.id]
  );

  const loadArtifactTelemetry = useCallback(
    async (artifactId = selectedApp?.id) => {
      if (effectiveRole !== "practitioner" || !artifactId) {
        setTelemetryState({ status: "idle", telemetry: null, error: "" });
        return;
      }

      setTelemetryState((current) => ({
        ...current,
        status: current.telemetry ? "refreshing" : "loading",
        error: ""
      }));

      try {
        const telemetry = await getArtifactTelemetry(artifactId);
        setTelemetryState({ status: "ready", telemetry, error: "" });
      } catch (error) {
        setTelemetryState({
          status: "error",
          telemetry: null,
          error: error.message
        });
      }
    },
    [effectiveRole, selectedApp?.id]
  );

  const loadArtifactAccessTokens = useCallback(
    async (artifactId = selectedApp?.id) => {
      if (effectiveRole !== "practitioner" || !artifactId) {
        setAccessState({ status: "idle", links: [], error: "" });
        return;
      }

      setAccessState((current) => ({
        ...current,
        status: current.links.length ? "refreshing" : "loading",
        error: ""
      }));

      try {
        const links = await getArtifactAccessTokens(artifactId);
        setAccessState((current) => {
          const currentUrlById = new Map(
            current.links
              .filter((link) => link.shareUrl)
              .map((link) => [link.id, link.shareUrl])
          );
          return {
            status: "ready",
            links: links.map((link) => ({
              ...link,
              shareUrl: currentUrlById.get(link.id) || ""
            })),
            error: ""
          };
        });
      } catch (error) {
        setAccessState({
          status: "error",
          links: [],
          error: error.message
        });
      }
    },
    [effectiveRole, selectedApp?.id]
  );

  const loadArtifactFromUrl = useCallback(async () => {
    const id = getArtifactIdFromUrl();
    if (!id) {
      if (forcedPatientMode) {
        setPatientLoadState({
          status: "error",
          error: "No artifact ID was included in this patient link."
        });
      }
      return;
    }

    try {
      const result = forcedPatientMode
        ? await getPatientArtifact(id, getArtifactAccessTokenFromUrl())
        : { artifact: await getArtifact(id) };
      const artifact = result.artifact;
      setSelectedApp(artifact);
      setApps((currentApps) => upsertArtifact(currentApps, artifact));
      setArtifactView("preview");
      setSource("shared");
      setPatientLoadState({ status: "ready", error: "" });
    } catch (error) {
      console.warn(error.message);
      if (forcedPatientMode) {
        setPatientLoadState({
          status: "error",
          error: error.message || "This artifact link is no longer available."
        });
      }
    }
  }, [forcedPatientMode]);

  useEffect(() => {
    if (hasBootstrappedRef.current) return;

    hasBootstrappedRef.current = true;
    listArtifacts()
      .then((artifacts) => {
        setApps(artifacts);
        setSelectedApp((currentApp) =>
          currentApp
            ? artifacts.find((artifact) => artifact.id === currentApp.id) || currentApp
            : null
        );
        loadArtifactVersions();
        loadArtifactTelemetry();
        loadArtifactAccessTokens();
      })
      .catch(() => {});

    getPublicUrl()
      .then((url) => setPublicBaseUrl(url))
      .catch(() => {});
  }, [loadArtifactAccessTokens, loadArtifactTelemetry, loadArtifactVersions]);

  useEffect(() => {
    loadArtifactFromUrl();
  }, [loadArtifactFromUrl]);

  useEffect(() => {
    function scrollHashTarget() {
      const hash = window.location.hash;
      const targets = {
        "#create": { ref: createRef, nav: "Create" },
        "#artifact": { ref: artifactRef, nav: "Create" },
        "#library": { ref: libraryRef, nav: "Library" }
      };
      const target = targets[hash];

      if (target) {
        setActiveNav(target.nav);
        window.requestAnimationFrame(() => {
          scrollRefToTop(target.ref, "auto");
        });
      }
    }

    scrollHashTarget();
    window.addEventListener("hashchange", scrollHashTarget);
    return () => window.removeEventListener("hashchange", scrollHashTarget);
  }, []);

  useEffect(() => {
    const base = publicBaseUrl || window.location.origin;
    setShareUrl(selectedApp?.id ? makeArtifactShareUrl(base, selectedApp.id) : "");
  }, [publicBaseUrl, selectedApp?.id]);

  useEffect(() => {
    loadArtifactVersions();
  }, [loadArtifactVersions]);

  useEffect(() => {
    loadArtifactTelemetry();
  }, [loadArtifactTelemetry]);

  useEffect(() => {
    loadArtifactAccessTokens();
  }, [loadArtifactAccessTokens]);

  useEffect(() => {
    if (effectiveRole !== "practitioner" || !selectedApp?.id) return undefined;

    const intervalId = window.setInterval(() => {
      loadArtifactTelemetry(selectedApp.id).catch(() => {});
    }, 12000);

    return () => window.clearInterval(intervalId);
  }, [effectiveRole, loadArtifactTelemetry, selectedApp?.id]);

  const handleSetDemoRole = (role) => {
    setDemoRole(role);
    writeDemoRoleToUrl(role);
  };

  if (requiresPractitionerAuth && !authSession) {
    return (
      <AuthGate
        clerkEnabled={clerkEnabled}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  if (effectiveRole === "patient") {
    if (forcedPatientMode) {
      return (
        <PatientArtifactPage
          app={selectedApp}
          error={patientLoadState.error}
          status={patientLoadState.status}
        />
      );
    }

    return (
      <PatientLibraryPage
        activeFilter={activeFilter}
        demoRole={demoRole}
        error={patientLoadState.error}
        filteredApps={patientLibraryApps}
        filters={filters}
        onChangeRole={handleSetDemoRole}
        onSelectApp={handleSelectPatientLibraryApp}
        query={query}
        selectedApp={patientSelectedApp}
        setActiveFilter={setActiveFilter}
        setQuery={setQuery}
        status={patientLoadState.status}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <FileHeart size={18} aria-hidden="true" />
          </span>
          <div>
            <strong>{platformPositioning.productName}</strong>
            <span>{platformPositioning.subtitle}</span>
          </div>
        </div>
        <nav className="nav-tabs" aria-label="Workspace">
          <button
            className={activeNav === "Create" ? "nav-tab active" : "nav-tab"}
            type="button"
            onClick={() => scrollToSection(createRef, "Create", "#create")}
          >
            <Sparkles size={16} aria-hidden="true" />
            Create
          </button>
          <button
            className={activeNav === "Library" ? "nav-tab active" : "nav-tab"}
            type="button"
            onClick={() => scrollToSection(libraryRef, "Library", "#library")}
          >
            <Library size={16} aria-hidden="true" />
            Library
          </button>
          <button
            className={activeNav === "Patients" ? "nav-tab active" : "nav-tab"}
            type="button"
            onClick={() => {
              setActiveFilter("Assigned patients");
              scrollToSection(libraryRef, "Patients", "#library");
            }}
          >
            <UsersRound size={16} aria-hidden="true" />
            Patients
          </button>
          <button
            className={activeNav === "Telemetry" ? "nav-tab active" : "nav-tab"}
            type="button"
            onClick={() => {
              setArtifactView("telemetry");
              scrollToSection(artifactRef, "Telemetry", "#artifact");
            }}
          >
            <CircleGauge size={16} aria-hidden="true" />
            Telemetry
          </button>
        </nav>
        <DemoRoleSwitch role={demoRole} onChange={handleSetDemoRole} />
        <AuthStatus
          clerkEnabled={clerkEnabled}
          session={authSession}
          onSignOut={handleSignOut}
        />
      </header>

      <main className="workspace" id="create" ref={createRef}>
        <section className="create-hero" aria-labelledby="builder-title">
          <h1 id="builder-title">Idea in, app out. What are we working on?</h1>

          <form className="idea-composer" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="brief">
              Artifact brief
            </label>
            <textarea
              id="brief"
              onChange={(event) => updateForm("brief", event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  (!event.shiftKey || event.metaKey || event.ctrlKey)
                ) {
                  event.preventDefault();
                  event.currentTarget.form.requestSubmit();
                }
              }}
              placeholder="Describe the illness, literacy goal, patient metrics, and what the clinician needs to track..."
              rows={2}
              value={form.brief}
            />

            <label className="sr-only" htmlFor="sourceMaterial">
              Source material
            </label>
            <textarea
              className="source-material-input"
              id="sourceMaterial"
              onChange={(event) => updateForm("sourceMaterial", event.target.value)}
              placeholder="Paste discharge/offboarding notes, care-plan text, reference URLs, or integration context..."
              rows={2}
              value={form.sourceMaterial}
            />

            <div className="idea-composer-actions">
              <button
                aria-label="Use example brief"
                className="composer-icon"
                onClick={() =>
                  updateForm(
                    "brief",
                    form.brief.trim() ? `${form.brief}\n${exampleBrief}` : exampleBrief
                  )
                }
                type="button"
              >
                <Plus size={16} aria-hidden="true" />
              </button>

              <div className="composer-selects">
                <label className="composer-select">
                  <select
                    aria-label="Build mode"
                    onChange={(event) => setBuildMode(event.target.value)}
                    value={buildMode}
                  >
                    <option>Autopilot</option>
                    <option>Guided</option>
                    <option>Review first</option>
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </label>
                <label className="composer-select">
                  <select
                    aria-label="Generation pace"
                    onChange={(event) => setSpeedMode(event.target.value)}
                    value={speedMode}
                  >
                    <option>Fast</option>
                    <option>Balanced</option>
                    <option>Thorough</option>
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </label>
              </div>

              <button
                aria-label="Generate artifact"
                className="composer-submit"
                disabled={isGenerating || !form.brief.trim()}
                type="submit"
              >
                {isGenerating ? (
                  <LoaderCircle className="spin" size={20} aria-hidden="true" />
                ) : (
                  <ArrowUp size={22} aria-hidden="true" />
                )}
              </button>
            </div>
          </form>
          <BuilderChatLog messages={builderMessages} />
        </section>

        <section
          className="preview-panel artifact-panel"
          id="artifact"
          aria-labelledby="artifact-title"
          ref={artifactRef}
        >
          {activeProject && (isGenerating || activeProject.status === "blocked") ? (
            <CodeGenerationPanel
              agents={agents}
              buildMode={buildMode}
              project={activeProject}
              speedMode={speedMode}
            />
          ) : !selectedApp ? (
            <EmptyArtifactPanel />
          ) : (
            <>
              <ArtifactHeader
                app={selectedApp}
                artifactView={artifactView}
                setArtifactView={setArtifactView}
                source={source}
              />
              <ArtifactWorkspace
                app={selectedApp}
                telemetryState={telemetryState}
                view={artifactView}
              />
              <ArtifactControlDeck
                accessState={accessState}
                app={selectedApp}
                onCopyAccessLink={handleCopyAccessLink}
                onCopyShareUrl={handleCopyShareUrl}
                onCreateAccessLink={handleCreateAccessLink}
                onGenerateVoice={handleGenerateVoice}
                onRevokeAccessLink={handleRevokeAccessLink}
                onRestoreVersion={handleRestoreArtifactVersion}
                onSaveVersion={handleSaveArtifactVersion}
                onSetArtifactVisibility={handleSetArtifactVisibility}
                onSetLlmEnabled={handleSetArtifactLlmEnabled}
                permissionState={permissionState}
                shareUrl={shareUrl}
                versionState={versionState}
                visibilityState={visibilityState}
                voiceEnabled={form.voiceEnabled}
                voiceState={voiceState}
              />
            </>
          )}
        </section>

        <aside className="agent-panel" aria-labelledby="agent-title">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Agent run</p>
              <h2 id="agent-title">Build pipeline</h2>
            </div>
            <Workflow size={20} aria-hidden="true" />
          </div>

          <div className="agent-list">
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

          {selectedApp ? (
            <div className="release-box">
              <div>
                <p className="eyebrow">Release gates</p>
                <strong>Clinician approval required</strong>
              </div>
              <ul>
                {(Array.isArray(selectedApp.guardrails)
                  ? selectedApp.guardrails
                  : []
                )
                  .slice(0, 4)
                  .map((guardrail) => (
                  <li key={guardrail}>
                    <ShieldCheck size={14} aria-hidden="true" />
                    <span>{guardrail}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </main>

      <section
        className="library-section"
        id="library"
        aria-labelledby="library-title"
        ref={libraryRef}
      >
        <div className="library-heading">
          <div>
            <p className="eyebrow">Reusable artifacts</p>
            <h2 id="library-title">Artifact library</h2>
          </div>
          <div className="search-box">
            <Search size={17} aria-hidden="true" />
            <input
              aria-label="Search artifacts"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
            />
          </div>
        </div>

        <div className="filter-row" role="tablist" aria-label="Library filters">
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
          <div className="app-grid">
            {filteredApps.map((app) => (
              <article
                className={selectedApp?.id === app.id ? "app-card selected" : "app-card"}
                key={app.id}
              >
                <button type="button" onClick={() => handleSelectLibraryApp(app)}>
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
                  <span>{app.specialty}</span>
                  {app.condition ? <span>{app.condition}</span> : null}
                  <span>{app.visibility}</span>
                  <span>{app.status}</span>
                  <span>v{app.currentVersion || 1}</span>
                  {isArtifactLlmEnabled(app) ? <span>LLM</span> : null}
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
      </section>
    </div>
  );
}

function BuilderChatLog({ messages }) {
  if (!messages.length) return null;

  return (
    <div className="builder-chat-log" aria-label="Builder chat log">
      {messages.map((message) => (
        <article
          className={`builder-chat-message ${message.role} ${message.status || ""}`}
          key={message.id}
        >
          <span className="builder-chat-icon" aria-hidden="true">
            {message.role === "user" ? (
              <Sparkles size={14} />
            ) : message.status === "running" ? (
              <LoaderCircle className="spin" size={14} />
            ) : message.status === "blocked" ? (
              <AlertTriangle size={14} />
            ) : (
              <Check size={14} />
            )}
          </span>
          <div>
            <strong>{message.role === "user" ? "You" : "Agent"}</strong>
            <p>{message.text}</p>
            {message.sourceMaterial ? (
              <small>Source material attached</small>
            ) : null}
            {message.artifactTitle ? (
              <small>{message.artifactTitle}</small>
            ) : null}
            {message.error ? <small>{message.error}</small> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

export default App;
