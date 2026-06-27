/**
 * LOVABLE FRONTEND — TriageChat.jsx
 * ===================================
 * A single React component you can paste directly into a new Lovable project.
 *
 * HOW TO USE IN LOVABLE:
 *  1. Create a new project at https://lovable.dev
 *  2. In the Lovable editor, create a new file: src/components/TriageChat.jsx
 *  3. Paste this entire file
 *  4. In src/App.jsx, replace the contents with:
 *       import TriageChat from './components/TriageChat';
 *       export default function App() { return <TriageChat />; }
 *  5. Set your backend URL (see API_BASE_URL below)
 *
 * SETTING THE BACKEND URL:
 *  - Local testing:  "http://localhost:8000"
 *  - ngrok:          "https://xxxx.ngrok.io"   (from: ngrok http 8000)
 *  - Baseten:        "https://xxxx.baseten.co"
 *
 * WHAT THIS COMPONENT DOES:
 *  - Text chat with the triage agent
 *  - Image upload (tap the photo button)
 *  - Voice recording (tap the mic button — sends to /transcribe)
 *  - Displays escalation warnings with appropriate visual weight
 */

import { useState, useRef, useEffect } from "react";

// ── Configuration ─────────────────────────────────────────────
// Change this to your ngrok or Baseten URL when testing remotely
const API_BASE_URL = "http://localhost:8000";

// ── Main component ────────────────────────────────────────────
export default function TriageChat() {
  const [messages, setMessages]     = useState([
    {
      role: "agent",
      text: "Hi, I'm here to help. What's going on? Describe what happened or how you're feeling, and we'll figure out the best next step together."
    }
  ]);
  const [input, setInput]           = useState("");
  const [sessionId, setSessionId]   = useState(null);
  const [loading, setLoading]       = useState(false);
  const [recording, setRecording]   = useState(false);
  const [imageFile, setImageFile]   = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

  const bottomRef    = useRef(null);
  const mediaRef     = useRef(null);
  const chunksRef    = useRef([]);
  const fileInputRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Send a text message ────────────────────────────────────
  const sendMessage = async (textOverride = null) => {
    const text = textOverride || input.trim();
    if (!text && !imageFile) return;

    // Add user message to UI immediately
    setMessages(prev => [...prev, {
      role: "user",
      text: text || "(shared an image)",
      image: imagePreview
    }]);
    setInput("");
    setImageFile(null);
    setImagePreview(null);
    setLoading(true);

    try {
      // Build multipart form data (supports text + optional image)
      const formData = new FormData();
      formData.append("message", text || "I'm sharing an image of my situation.");
      if (sessionId) formData.append("session_id", sessionId);
      if (imageFile) formData.append("image", imageFile);

      const res = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        body: formData
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();

      // Save session ID from first response
      if (!sessionId) setSessionId(data.session_id);

      // Check for escalation marker in response
      const isEscalation = data.response.includes("---");

      setMessages(prev => [...prev, {
        role: "agent",
        text: data.response,
        isEscalation
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: "agent",
        text: "Sorry, I couldn't reach the server. Make sure the backend is running.",
        isError: true
      }]);
    } finally {
      setLoading(false);
    }
  };

  // ── Handle Enter key ───────────────────────────────────────
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Image upload ───────────────────────────────────────────
  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  // ── Voice recording ────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        // Send the audio blob to /transcribe
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const formData = new FormData();
        formData.append("audio", blob, "recording.webm");

        try {
          const res = await fetch(`${API_BASE_URL}/transcribe`, {
            method: "POST",
            body: formData
          });
          const data = await res.json();
          if (data.text) {
            // Auto-send the transcribed text as if the user typed it
            sendMessage(data.text);
          }
        } catch {
          setMessages(prev => [...prev, {
            role: "agent",
            text: "Couldn't transcribe the recording. Please try typing instead.",
            isError: true
          }]);
        }

        stream.getTracks().forEach(t => t.stop());
      };

      mediaRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      alert("Microphone access denied. Please allow microphone access and try again.");
    }
  };

  const stopRecording = () => {
    mediaRef.current?.stop();
    setRecording(false);
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      maxWidth: 680,
      margin: "0 auto",
      fontFamily: "system-ui, sans-serif",
      background: "#f9f9f7"
    }}>

      {/* Header */}
      <div style={{
        padding: "16px 20px",
        background: "#fff",
        borderBottom: "1px solid #e5e5e2",
        display: "flex",
        alignItems: "center",
        gap: 10
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          background: "#e1f5ee", display: "flex",
          alignItems: "center", justifyContent: "center",
          fontSize: 18
        }}>+</div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, color: "#1a1a1a" }}>
            First Aid Assistant
          </div>
          <div style={{ fontSize: 12, color: "#888" }}>
            Not a replacement for professional medical care
          </div>
        </div>
      </div>

      {/* Message list */}
      <div style={{
        flex: 1, overflowY: "auto",
        padding: "20px 16px",
        display: "flex", flexDirection: "column", gap: 12
      }}>
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}

        {/* Loading indicator */}
        {loading && (
          <div style={{ display: "flex", gap: 4, padding: "8px 0" }}>
            {[0,1,2].map(i => (
              <div key={i} style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "#aaa",
                animation: `bounce 1s ease-in-out ${i * 0.15}s infinite`
              }} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Image preview strip */}
      {imagePreview && (
        <div style={{
          padding: "8px 16px",
          background: "#fff",
          borderTop: "1px solid #e5e5e2",
          display: "flex", alignItems: "center", gap: 8
        }}>
          <img src={imagePreview} alt="preview"
            style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6 }} />
          <span style={{ fontSize: 13, color: "#666" }}>Image ready to send</span>
          <button onClick={() => { setImageFile(null); setImagePreview(null); }}
            style={{ marginLeft: "auto", background: "none", border: "none",
                     cursor: "pointer", color: "#888", fontSize: 18 }}>×</button>
        </div>
      )}

      {/* Input bar */}
      <div style={{
        padding: "12px 16px",
        background: "#fff",
        borderTop: "1px solid #e5e5e2",
        display: "flex", gap: 8, alignItems: "flex-end"
      }}>
        {/* Hidden file input */}
        <input ref={fileInputRef} type="file"
          accept="image/*,video/*" style={{ display: "none" }}
          onChange={handleImageSelect} />

        {/* Image/video attach button */}
        <button onClick={() => fileInputRef.current?.click()}
          style={iconButtonStyle("#e1f5ee", "#0f6e56")}
          title="Attach image or video">
          📷
        </button>

        {/* Mic button */}
        <button
          onClick={recording ? stopRecording : startRecording}
          style={iconButtonStyle(
            recording ? "#fcebeb" : "#eeedfe",
            recording ? "#a32d2d" : "#534ab7"
          )}
          title={recording ? "Stop recording" : "Record voice message"}>
          {recording ? "⏹" : "🎙"}
        </button>

        {/* Text input */}
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe what happened..."
          rows={1}
          style={{
            flex: 1, resize: "none", border: "1px solid #e5e5e2",
            borderRadius: 20, padding: "10px 14px",
            fontSize: 15, fontFamily: "inherit",
            outline: "none", background: "#f9f9f7",
            lineHeight: 1.4
          }}
        />

        {/* Send button */}
        <button
          onClick={() => sendMessage()}
          disabled={loading || (!input.trim() && !imageFile)}
          style={{
            background: (loading || (!input.trim() && !imageFile)) ? "#e5e5e2" : "#1d9e75",
            color: "#fff", border: "none", borderRadius: "50%",
            width: 40, height: 40, cursor: "pointer",
            fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center"
          }}>
          →
        </button>
      </div>

      {/* Bounce animation for loading dots */}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── Message bubble sub-component ──────────────────────────────
function MessageBubble({ msg }) {
  const isUser = msg.role === "user";

  // Split on the escalation separator (--- added by escalation module)
  const parts = msg.text?.split("\n\n---\n") || [msg.text];
  const mainText = parts[0];
  const escalationText = parts[1];

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start",
      gap: 6
    }}>
      {/* Image preview (if user sent one) */}
      {msg.image && (
        <img src={msg.image} alt="shared"
          style={{ maxWidth: 200, borderRadius: 10, marginBottom: 4 }} />
      )}

      {/* Main message bubble */}
      <div style={{
        maxWidth: "80%",
        padding: "10px 14px",
        borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
        background: isUser ? "#1d9e75" : "#fff",
        color: isUser ? "#fff" : "#1a1a1a",
        fontSize: 15, lineHeight: 1.5,
        border: isUser ? "none" : "1px solid #e5e5e2",
        whiteSpace: "pre-wrap"
      }}>
        {mainText}
      </div>

      {/* Escalation notice — rendered separately with appropriate styling */}
      {escalationText && (
        <div style={{
          maxWidth: "80%",
          padding: "10px 14px",
          borderRadius: 10,
          background: escalationText.includes("🚨") ? "#fcebeb"
                    : escalationText.includes("⚠️") ? "#faeeda"
                    : "#e6f1fb",
          border: `1px solid ${
            escalationText.includes("🚨") ? "#f09595"
            : escalationText.includes("⚠️") ? "#fac775"
            : "#b5d4f4"
          }`,
          fontSize: 14, lineHeight: 1.5,
          whiteSpace: "pre-wrap"
        }}>
          {escalationText}
        </div>
      )}
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────
function iconButtonStyle(bg, color) {
  return {
    background: bg, border: "none", borderRadius: "50%",
    width: 40, height: 40, cursor: "pointer",
    fontSize: 18, display: "flex", alignItems: "center",
    justifyContent: "center", color, flexShrink: 0
  };
}
