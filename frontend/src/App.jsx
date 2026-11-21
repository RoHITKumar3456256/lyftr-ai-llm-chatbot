import React, { useState, useRef, useEffect, useCallback } from "react";

const API_BASE_URL = (
  import.meta.env.VITE_API_URL || "https://lyftr-ai-llm-chatbot.onrender.com"
).replace(/\/$/, "");

function generateSessionId() {
  return `s-${Math.random().toString(36).substring(2, 8)}`;
}

function formatTime(isoStr) {
  if (!isoStr) return "";
  try {
    return new Date(isoStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  return (
    <button className="glass-icon-btn" onClick={handleCopy} title="Copy response">
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

const QUICK_PROMPTS = [
  {
    icon: "⚡",
    title: "Test Deterministic Cache",
    prompt: "What is the capital of India?",
    desc: "Send once for live inference, then send again for instant LLM_CACHE hit."
  },
  {
    icon: "🛡️",
    title: "Simulate Key 1 Rate Limit",
    prompt: "Calculate 25 * 40 and explain the steps.",
    desc: "Uses key_1=429 simulation to trigger seamless fallback to key_2.",
    simulation: "key_1=429"
  },
  {
    icon: "🧠",
    title: "Multi-Turn Memory Test",
    prompt: "Remember my favorite framework is FastAPI. What was it?",
    desc: "Tests session memory persistence in SQLite."
  },
  {
    icon: "✨",
    title: "Creative Assistant",
    prompt: "Write a 3-line poem about high availability and AI gateways.",
    desc: "Tests LLM response streaming and latency metrics."
  }
];

export default function App() {
  const [sessions, setSessions] = useState(() => {
    const id = generateSessionId();
    return [{ id, label: "Session 1", createdAt: new Date().toISOString() }];
  });
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messagesBySession, setMessagesBySession] = useState({});
  const [systemPrompt, setSystemPrompt] = useState("");
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [simulateFailure, setSimulateFailure] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [cacheEnabled, setCacheEnabled] = useState(true);
  const [cacheHits, setCacheHits] = useState(0);
  const [activeMessageIndex, setActiveMessageIndex] = useState(null);
  const [showDetails, setShowDetails] = useState(true);
  const [currentModel, setCurrentModel] = useState("gemini-2.5-flash");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast] = useState(null);

  const bottomRef = useRef(null);
  const chatInputRef = useRef(null);

  const currentSessionId = activeSessionId || sessions[0]?.id;
  const messages = messagesBySession[currentSessionId] || [];

  const showToast = useCallback((msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleNewSession = () => {
    const id = generateSessionId();
    const label = `Session ${sessions.length + 1}`;
    setSessions((prev) => [ { id, label, createdAt: new Date().toISOString() }, ...prev ]);
    setActiveSessionId(id);
    setActiveMessageIndex(null);
    setInput("");
    showToast("✨ Started new session", "success");
  };

  const handleSelectSession = (id) => {
    setActiveSessionId(id);
    setActiveMessageIndex(null);
    setInput("");
  };

  const setMessages = (updater) => {
    setMessagesBySession((prev) => ({
      ...prev,
      [currentSessionId]: typeof updater === "function" ? updater(prev[currentSessionId] || []) : updater,
    }));
  };

  const handleSend = async (customText, customSim) => {
    const messageToSend = typeof customText === "string" ? customText : input;
    const trimmed = messageToSend.trim();
    if (!trimmed || loading) return;

    const simToUse = typeof customSim === "string" ? customSim : simulateFailure;

    setInput("");
    setLoading(true);

    const userMsg = { role: "user", content: trimmed, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const payload = { session_id: currentSessionId, message: trimmed };
      if (systemPrompt.trim()) {
        payload.system_prompt = systemPrompt.trim();
      }

      const headers = { "Content-Type": "application/json" };
      if (simToUse && simToUse.trim()) {
        headers["X-Simulate-Failure"] = simToUse.trim();
      }

      const res = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : JSON.stringify(data.detail || "Service error");
        setMessages((prev) => [
          ...prev,
          { role: "error", content: `Error (${res.status}): ${detail}`, timestamp: new Date().toISOString() },
        ]);
        showToast(`Request returned ${res.status}`, "error");
        return;
      }

      if (data.metadata?.resolution_source === "LLM_CACHE") {
        setCacheHits((c) => c + 1);
        showToast("⚡ Served instantly from deterministic cache!", "cache");
      } else if (data.metadata?.fallback_attempts > 0) {
        showToast(`🛡️ Failover activated: ${data.metadata.fallback_attempts} fallback attempt(s)`, "warn");
      }

      if (data.metadata?.model) {
        setCurrentModel(data.metadata.model.replace("gemini/", ""));
      }

      const assistantMsg = {
        role: "assistant",
        content: data.reply,
        metadata: data.metadata,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => {
        const updated = [...prev, assistantMsg];
        setActiveMessageIndex(updated.length - 1);
        return updated;
      });
      setShowDetails(true);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "error",
          content: `Network error: ${err.message}. Backend URL: ${API_BASE_URL}`,
          timestamp: new Date().toISOString(),
        },
      ]);
      showToast("Network error: check backend status", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const assistantReplies = messages
    .map((m, idx) => ({ ...m, globalIndex: idx }))
    .filter((m) => m.role === "assistant");

  const currentAssistantIndex =
    activeMessageIndex !== null
      ? assistantReplies.findIndex((m) => m.globalIndex === activeMessageIndex)
      : assistantReplies.length - 1;

  const selectedAssistant =
    currentAssistantIndex >= 0
      ? assistantReplies[currentAssistantIndex]
      : assistantReplies[assistantReplies.length - 1] || null;

  const isKey1Simulated =
    simulateFailure.includes("key_1") || simulateFailure.includes("*=");
  const isKey2Simulated =
    simulateFailure.includes("key_2") || simulateFailure.includes("*=");

  return (
    <div className="simy-app-root">
      {/* Background ambient iridescent glows */}
      <div className="bg-glow bg-glow-1" />
      <div className="bg-glow bg-glow-2" />
      <div className="bg-glow bg-glow-3" />

      {/* Floating Toast Notification */}
      {toast && (
        <div className={`floating-toast toast-${toast.type}`}>
          <span className="toast-dot" />
          <span>{toast.msg}</span>
        </div>
      )}

      {/* 3-COLUMN GLASS CONTAINER */}
      <div className="simy-glass-container">
        
        {/* LEFT SIDEBAR: SESSIONS, KEYS & CACHE */}
        <aside className={`glass-sidebar ${sidebarOpen ? "open" : "collapsed"}`}>
          {/* Brand & Bot Avatar */}
          <div className="sidebar-brand-card">
            <div className="bot-avatar-3d">
              <div className="bot-head">
                <span className="bot-eye left">✦</span>
                <span className="bot-smile">‿</span>
                <span className="bot-eye right">✦</span>
              </div>
              <div className="online-indicator" />
            </div>
            {sidebarOpen && (
              <div className="brand-meta">
                <div className="brand-title-wrap">
                  <span className="brand-title">KeyFlow</span>
                  <span className="pro-badge">AI 2.0</span>
                </div>
                <span className="brand-sub">Lyftr Resilient Gateway</span>
              </div>
            )}
            <button
              className="glass-icon-btn collapse-btn"
              onClick={() => setSidebarOpen((p) => !p)}
              title="Toggle sidebar"
            >
              {sidebarOpen ? "◀" : "▶"}
            </button>
          </div>

          {sidebarOpen && (
            <>
              {/* Action: New Session */}
              <button className="primary-glass-btn new-session-btn" onClick={handleNewSession}>
                <span className="btn-icon">＋</span>
                <span>Start New Chat</span>
              </button>

              {/* Provider Keys Pool Card */}
              <div className="glass-card section-card">
                <div className="section-header">
                  <span className="section-title">PROVIDER KEY POOL</span>
                  <span className="pool-count">2 Keys</span>
                </div>
                <div className="keys-stack">
                  <div className={`key-tile ${isKey1Simulated ? "tile-simulated" : "tile-active"}`}>
                    <div className="key-info">
                      <span className={`status-orb ${isKey1Simulated ? "orb-amber" : "orb-green"}`} />
                      <span className="key-code">key_1</span>
                    </div>
                    <span className="key-status-tag">
                      {isKey1Simulated ? "Simulated Fail" : "Healthy (Primary)"}
                    </span>
                  </div>

                  <div className={`key-tile ${isKey2Simulated ? "tile-simulated" : "tile-active"}`}>
                    <div className="key-info">
                      <span className={`status-orb ${isKey2Simulated ? "orb-amber" : "orb-green"}`} />
                      <span className="key-code">key_2</span>
                    </div>
                    <span className="key-status-tag">
                      {isKey2Simulated ? "Simulated Fail" : "Healthy (Fallback)"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Response Cache Card */}
              <div className="glass-card section-card">
                <div className="section-header">
                  <span className="section-title">DETERMINISTIC CACHE</span>
                  <span className="cache-counter">{cacheHits} {cacheHits === 1 ? "hit" : "hits"}</span>
                </div>
                <div className="cache-toggle-row">
                  <div>
                    <div className="cache-mode-label">{cacheEnabled ? "Active & Serving" : "Disabled"}</div>
                    <div className="cache-sub-label">SHA-256 prompt digest</div>
                  </div>
                  <label className="ios-switch">
                    <input
                      type="checkbox"
                      checked={cacheEnabled}
                      onChange={(e) => setCacheEnabled(e.target.checked)}
                    />
                    <span className="ios-slider" />
                  </label>
                </div>
              </div>

              {/* Sessions History List */}
              <div className="glass-card section-card sessions-card">
                <div className="section-header">
                  <span className="section-title">CONVERSATIONS</span>
                  <span className="sessions-badge">{sessions.length}</span>
                </div>
                <div className="sessions-scroll">
                  {sessions.map((s) => {
                    const isActive = s.id === currentSessionId;
                    const sessionMsgs = messagesBySession[s.id] || [];
                    return (
                      <button
                        key={s.id}
                        className={`session-row ${isActive ? "active-session" : ""}`}
                        onClick={() => handleSelectSession(s.id)}
                      >
                        <span className="session-icon">{isActive ? "💬" : "▫️"}</span>
                        <div className="session-text-wrap">
                          <span className="session-name">{s.label}</span>
                          <span className="session-id-tag">{s.id} · {sessionMsgs.length} msgs</span>
                        </div>
                        <span className="session-arrow">→</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Footer info */}
              <div className="sidebar-bottom-bar">
                <div className="model-chip-live">
                  <span className="pulse-dot-cyan" />
                  <span>{currentModel}</span>
                </div>
                <a
                  href={`${API_BASE_URL}/docs`}
                  target="_blank"
                  rel="noreferrer"
                  className="docs-link"
                  title="Open Swagger API documentation"
                >
                  Swagger ↗
                </a>
              </div>
            </>
          )}
        </aside>

        {/* CENTER MAIN CHAT DISPLAY */}
        <main className="glass-main-chat">
          {/* Top Glass Header */}
          <header className="chat-top-header">
            <div className="header-left">
              <div className="bot-header-avatar">
                <span>🤖</span>
              </div>
              <div className="header-titles">
                <div className="chat-bot-name">
                  KeyFlow AI Assistant
                  <span className="bot-status-pill">Online</span>
                </div>
                <div className="chat-session-sub">
                  Session: <span className="mono-text">{currentSessionId}</span>
                </div>
              </div>
            </div>

            {/* Glowing Fluid Soundwave Visualizer */}
            <div className="header-soundwave-wrap" title="Live Gateway Audio/AI Waveform">
              <div className="soundwave-bar bar-1" />
              <div className="soundwave-bar bar-2" />
              <div className="soundwave-bar bar-3" />
              <div className="soundwave-bar bar-4" />
              <div className="soundwave-bar bar-5" />
              <div className="soundwave-bar bar-6" />
              <div className="soundwave-bar bar-7" />
              <div className="soundwave-bar bar-8" />
            </div>

            {/* Failover Simulation Header Control */}
            <div className="header-right">
              <div className={`simulate-glass-pill ${simulateFailure ? "sim-active" : ""}`}>
                <span className="sim-icon">⚠️</span>
                <span className="sim-title">Failover Test:</span>
                <input
                  type="text"
                  className="sim-input"
                  placeholder="key_1=429"
                  value={simulateFailure}
                  onChange={(e) => setSimulateFailure(e.target.value)}
                  title="Format: key_1=429, key_2=500, *=429"
                />
                <button
                  className="sim-action-btn"
                  onClick={() => setSimulateFailure((prev) => (prev ? "" : "key_1=429"))}
                >
                  {simulateFailure ? "Clear" : "Set"}
                </button>
              </div>
            </div>
          </header>

          {/* Chat Messages Stream */}
          <div className="messages-stream">
            {messages.length === 0 ? (
              <div className="hero-empty-state">
                {/* 3D AI Robot illustration & Wave */}
                <div className="hero-bot-showcase">
                  <div className="hero-floating-orb" />
                  <div className="hero-bot-avatar-large">
                    <div className="hero-bot-face">
                      <span className="eye-star">✦</span>
                      <span className="smile-curve">‿</span>
                      <span className="eye-star">✦</span>
                    </div>
                  </div>
                </div>

                <h1 className="hero-title">Providing The Best Solutions</h1>
                <p className="hero-description">
                  Resilient Multi-Turn LLM Gateway with Automatic Key Failover & Deterministic Caching.
                </p>

                {/* Quick Prompts Cards Grid */}
                <div className="quick-prompts-grid">
                  {QUICK_PROMPTS.map((qp, idx) => (
                    <div
                      key={idx}
                      className="quick-prompt-card"
                      onClick={() => {
                        if (qp.simulation) setSimulateFailure(qp.simulation);
                        handleSend(qp.prompt, qp.simulation);
                      }}
                    >
                      <div className="qp-top">
                        <span className="qp-icon">{qp.icon}</span>
                        <span className="qp-arrow">↗</span>
                      </div>
                      <div className="qp-title">{qp.title}</div>
                      <div className="qp-desc">{qp.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, idx) => {
                if (m.role === "user") {
                  return (
                    <div key={idx} className="bubble-row user-bubble-row">
                      <div className="bubble-container user-bubble">
                        <div className="bubble-content">{m.content}</div>
                        <div className="bubble-time">{formatTime(m.timestamp)}</div>
                      </div>
                      <div className="user-icon-avatar">👤</div>
                    </div>
                  );
                }

                if (m.role === "error") {
                  return (
                    <div key={idx} className="bubble-row">
                      <div className="glass-card error-bubble">
                        <span className="error-alert-icon">⚠️</span>
                        <div className="error-body">
                          <div className="error-heading">Gateway Error</div>
                          <div className="error-text">{m.content}</div>
                        </div>
                      </div>
                    </div>
                  );
                }

                const meta = m.metadata || {};
                const isCache = meta.resolution_source === "LLM_CACHE";
                const isSelected = activeMessageIndex === idx;

                return (
                  <React.Fragment key={idx}>
                    {/* Failover notice banner */}
                    {meta.failover_note && (
                      <div className="failover-glass-banner">
                        <span className="failover-shield">🛡️</span>
                        <span className="failover-text">{meta.failover_note}</span>
                      </div>
                    )}

                    <div
                      className={`bubble-row assistant-bubble-row ${isSelected ? "bubble-selected" : ""}`}
                      onClick={() => {
                        setActiveMessageIndex(idx);
                        setShowDetails(true);
                      }}
                    >
                      <div className="assistant-bot-avatar">
                        <span>🤖</span>
                      </div>

                      <div className="bubble-container assistant-bubble" data-testid="assistant-message">
                        <div className="bubble-content">{m.content}</div>

                        {/* Metadata Tag Strip */}
                        <div className="bubble-metadata-strip">
                          <span
                            data-testid="meta-source"
                            className={`badge-source ${isCache ? "badge-cache" : "badge-live"}`}
                          >
                            <span className="source-dot" />
                            {meta.resolution_source || "LIVE_INFERENCE"}
                          </span>

                          {meta.fallback_attempts > 0 && (
                            <span className="badge-fallback">
                              🔄 {meta.fallback_attempts} {meta.fallback_attempts === 1 ? "fallback" : "fallbacks"}
                            </span>
                          )}

                          <span data-testid="meta-latency" className="badge-metric">
                            ⏱️ {meta.latency_ms} ms
                          </span>

                          <span className="badge-metric">
                            <strong data-testid="meta-input-tokens">{meta.input_tokens}</strong> in ·{" "}
                            <strong data-testid="meta-output-tokens">{meta.output_tokens}</strong> out
                          </span>

                          {meta.key_id && (
                            <span className="badge-key">
                              🔑 {meta.key_id}
                            </span>
                          )}

                          <span data-testid="meta-model" style={{ display: "none" }}>
                            {meta.model || currentModel}
                          </span>

                          <div className="bubble-actions">
                            <CopyButton text={m.content} />
                            <button
                              className="inspect-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMessageIndex(idx);
                                setShowDetails(true);
                              }}
                            >
                              Inspector ↗
                            </button>
                          </div>
                        </div>

                        <div className="bubble-time">{formatTime(m.timestamp)}</div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })
            )}

            {/* Animated Typing Indicator */}
            {loading && (
              <div className="bubble-row loading-row">
                <div className="assistant-bot-avatar pulse-avatar">🤖</div>
                <div className="loading-glass-card">
                  <div className="glowing-wave-loader">
                    <span className="dot dot-1" />
                    <span className="dot dot-2" />
                    <span className="dot dot-3" />
                  </div>
                  <span className="loading-text">Resolving with key pool failover...</span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Floating Glass Input Deck */}
          <div className="floating-input-deck">
            {/* System Prompt Drawer */}
            {showSystemPrompt && (
              <div className="system-prompt-glass-panel">
                <span className="sys-icon">⚙️</span>
                <label className="sys-title">System Prompt:</label>
                <input
                  id="sys-input"
                  data-testid="system-prompt-input"
                  type="text"
                  className="sys-field"
                  placeholder="e.g. You are a concise mathematical assistant."
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                />
                <button
                  className="sys-close-btn"
                  onClick={() => {
                    setSystemPrompt("");
                    setShowSystemPrompt(false);
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            <div className="glass-input-card">
              <textarea
                ref={chatInputRef}
                data-testid="chat-input"
                rows={2}
                className="glass-textarea"
                placeholder="Ask KeyFlow AI anything (press Enter to send)..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={4000}
              />

              <div className="input-toolbar">
                <div className="toolbar-left">
                  <button
                    type="button"
                    className={`tool-pill ${showSystemPrompt || systemPrompt ? "tool-pill-active" : ""}`}
                    onClick={() => setShowSystemPrompt((prev) => !prev)}
                  >
                    <span>⚙️</span>
                    <span>System Prompt</span>
                    {systemPrompt && <span className="pill-active-dot" />}
                  </button>

                  <div className={`tool-pill simulate-indicator ${simulateFailure ? "sim-on" : ""}`}>
                    <span>🛡️</span>
                    <span>{simulateFailure ? `Failover: ${simulateFailure}` : "Failover: Auto"}</span>
                  </div>
                </div>

                <div className="toolbar-right">
                  <span className="char-badge">{input.length}/4000</span>
                  <button
                    data-testid="send-button"
                    type="button"
                    className="glowing-send-btn"
                    disabled={loading || !input.trim()}
                    onClick={() => handleSend()}
                    title="Send message"
                  >
                    {loading ? (
                      <span className="spinner-icon">◌</span>
                    ) : (
                      <span className="send-arrow">➔</span>
                    )}
                  </button>
                </div>
              </div>
            </div>
            <div className="input-footer-hint">
              KeyFlow AI Gateway · LiteLLM Failover · SQLite Memory · SHA-256 Cache
            </div>
          </div>
        </main>

        {/* RIGHT SIDEBAR: REQUEST DETAILS INSPECTOR */}
        {showDetails && selectedAssistant && (
          <aside className="glass-details-sidebar">
            <div className="details-top">
              <div>
                <h3 className="details-heading">Request Details</h3>
                <span className="details-subhead">
                  Reply {currentAssistantIndex + 1} of {assistantReplies.length}
                </span>
              </div>
              <button className="glass-icon-btn" onClick={() => setShowDetails(false)}>
                ✕
              </button>
            </div>

            {/* Resolution Status Card */}
            <div
              className={`glass-card status-indicator-card ${
                selectedAssistant.metadata?.resolution_source === "LLM_CACHE"
                  ? "card-cache-status"
                  : "card-live-status"
              }`}
            >
              <div className="status-hero-icon">
                {selectedAssistant.metadata?.resolution_source === "LLM_CACHE" ? "⚡" : "✓"}
              </div>
              <div>
                <div className="status-hero-title">
                  {selectedAssistant.metadata?.resolution_source === "LLM_CACHE"
                    ? "Served from LLM Cache"
                    : "Live Model Inference"}
                </div>
                <div className="status-hero-desc">
                  {selectedAssistant.metadata?.resolution_source === "LLM_CACHE"
                    ? "Identical prompt found in local store. 0 token cost incurred."
                    : selectedAssistant.metadata?.fallback_attempts > 0
                    ? `Resolved by ${selectedAssistant.metadata?.key_id} after ${selectedAssistant.metadata?.fallback_attempts} fallback.`
                    : `Resolved directly by primary ${selectedAssistant.metadata?.key_id}.`}
                </div>
              </div>
            </div>

            {/* 2x2 Metric Tiles Grid */}
            <div className="metrics-2x2-grid">
              <div className="metric-glass-tile">
                <span className="m-label">LATENCY</span>
                <span className="m-val">{selectedAssistant.metadata?.latency_ms?.toLocaleString()} <span className="m-unit">ms</span></span>
              </div>
              <div className="metric-glass-tile">
                <span className="m-label">FALLBACKS</span>
                <span className={`m-val ${(selectedAssistant.metadata?.fallback_attempts || 0) > 0 ? "text-amber" : ""}`}>
                  {selectedAssistant.metadata?.fallback_attempts || 0}
                </span>
              </div>
              <div className="metric-glass-tile">
                <span className="m-label">INPUT TOKENS</span>
                <span className="m-val">{selectedAssistant.metadata?.input_tokens || 0}</span>
              </div>
              <div className="metric-glass-tile">
                <span className="m-label">OUTPUT TOKENS</span>
                <span className="m-val">{selectedAssistant.metadata?.output_tokens || 0}</span>
              </div>
            </div>

            {/* Key Resolution Timeline */}
            <div className="glass-card section-card">
              <div className="section-header">
                <span className="section-title">RESOLUTION TIMELINE</span>
              </div>

              {selectedAssistant.metadata?.timeline && selectedAssistant.metadata.timeline.length > 1 && (
                <div className="timeline-multi-bar">
                  {selectedAssistant.metadata.timeline.map((step, si) => (
                    <div
                      key={si}
                      className={`timeline-segment ${step.status === 200 ? "seg-green" : "seg-amber"}`}
                      style={{ flex: 1 }}
                    />
                  ))}
                </div>
              )}

              <div className="timeline-steps-list">
                {selectedAssistant.metadata?.timeline?.map((step, sIdx) => (
                  <div key={sIdx} className="timeline-step-row">
                    <div className="step-left">
                      <span className={`step-dot ${step.status === 200 ? "orb-green" : "orb-amber"}`} />
                      <span className="step-key">{step.key_id}</span>
                      <span className={`step-code ${step.status === 200 ? "code-200" : "code-fail"}`}>
                        {step.status}
                      </span>
                    </div>
                    <span className="step-ms">{step.latency_ms?.toLocaleString()} ms</span>
                  </div>
                ))}
                {!selectedAssistant.metadata?.timeline && (
                  <div className="timeline-step-row">
                    <div className="step-left">
                      <span className="step-dot orb-green" />
                      <span className="step-key">{selectedAssistant.metadata?.key_id || "cache"}</span>
                      <span className="step-code code-200">200 OK</span>
                    </div>
                    <span className="step-ms">{selectedAssistant.metadata?.latency_ms} ms</span>
                  </div>
                )}
              </div>
            </div>

            {/* Model & Infrastructure Info */}
            <div className="glass-card section-card">
              <div className="section-header">
                <span className="section-title">ENGINE & PROTOCOL</span>
              </div>
              <div className="engine-info-rows">
                <div className="engine-row">
                  <span className="e-label">Model</span>
                  <span className="e-val-mono">{selectedAssistant.metadata?.model || currentModel}</span>
                </div>
                <div className="engine-row">
                  <span className="e-label">Provider</span>
                  <span className="e-val">Google Gemini / LiteLLM</span>
                </div>
                <div className="engine-row">
                  <span className="e-label">Storage</span>
                  <span className="e-val">SQLite (Persistent)</span>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
