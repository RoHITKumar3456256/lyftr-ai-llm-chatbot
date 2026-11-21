import React, { useState, useRef, useEffect, useCallback } from "react";

const API_BASE_URL = (
  import.meta.env.VITE_API_URL || "https://lyftr-ai-llm-chatbot.onrender.com"
).replace(/\/$/, "");

function generateSessionId() {
  return `s-${Math.random().toString(36).substring(2, 8)}`;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
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
    <button className="copilot-action-icon" onClick={handleCopy} title="Copy response">
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

// Ribbon logo matching Microsoft Copilot
function CopilotRibbon() {
  return (
    <svg className="copilot-ribbon-icon" viewBox="0 0 32 32" fill="none">
      <defs>
        <linearGradient id="copilotGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00c6ff" />
          <stop offset="100%" stopColor="#0072ff" />
        </linearGradient>
        <linearGradient id="copilotGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f857a6" />
          <stop offset="100%" stopColor="#ff5858" />
        </linearGradient>
        <linearGradient id="copilotGrad3" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a8ff78" />
          <stop offset="100%" stopColor="#78ffd6" />
        </linearGradient>
      </defs>
      <path d="M8 12C8 7.58 11.58 4 16 4C20.42 4 24 7.58 24 12V20C24 24.42 20.42 28 16 28C11.58 28 8 24.42 8 20V12Z" fill="url(#copilotGrad1)" opacity="0.4" />
      <circle cx="12" cy="14" r="6" fill="url(#copilotGrad2)" opacity="0.8" />
      <circle cx="20" cy="18" r="6" fill="url(#copilotGrad3)" opacity="0.8" />
      <circle cx="16" cy="16" r="4" fill="#ffffff" opacity="0.9" />
    </svg>
  );
}

const CHIPS = [
  { label: "⚡ Test cache hit", prompt: "What is the capital of France?" },
  { label: "🛡️ Simulate 429 failover", prompt: "Explain API rate limiting in 1 sentence.", sim: "key_1=429" },
  { label: "🧠 Multi-turn memory", prompt: "Remember my favorite framework is FastAPI." },
  { label: "📖 Explain architecture", prompt: "How does KeyFlow perform sequential failover across key pools?" },
  { label: "✨ Make a plan", prompt: "Give me 3 best practices for deploying LLM applications." }
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
  const [showSimModal, setShowSimModal] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [cacheEnabled, setCacheEnabled] = useState(true);
  const [cacheHits, setCacheHits] = useState(0);
  const [activeMessageIndex, setActiveMessageIndex] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [currentModel, setCurrentModel] = useState("gemini-2.5-flash");
  const [toast, setToast] = useState(null);

  const bottomRef = useRef(null);
  const chatInputRef = useRef(null);

  const currentSessionId = activeSessionId || sessions[0]?.id;
  const messages = messagesBySession[currentSessionId] || [];

  const showToast = useCallback((msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleNewSession = () => {
    const id = generateSessionId();
    const label = `Session ${sessions.length + 1}`;
    setSessions((prev) => [{ id, label, createdAt: new Date().toISOString() }, ...prev]);
    setActiveSessionId(id);
    setActiveMessageIndex(null);
    setShowDetails(false);
    setInput("");
    showToast("✨ Started new conversation", "success");
  };

  const handleSelectSession = (id) => {
    setActiveSessionId(id);
    setActiveMessageIndex(null);
    setShowDetails(false);
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
        showToast("⚡ Served from deterministic cache (0 tokens)", "cache");
      } else if (data.metadata?.fallback_attempts > 0) {
        showToast(`🛡️ Failover activated: ${data.metadata.fallback_attempts} fallback(s)`, "warn");
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

  const isKey1Simulated = simulateFailure.includes("key_1") || simulateFailure.includes("*=");
  const isKey2Simulated = simulateFailure.includes("key_2") || simulateFailure.includes("*=");

  const greeting = getGreeting();

  return (
    <div className="copilot-window-root">
      {/* Background wallpaper with dark overlay */}
      <div className="copilot-backdrop-wallpaper" />
      <div className="copilot-backdrop-overlay" />

      {/* Floating Toast */}
      {toast && (
        <div className={`copilot-floating-toast toast-${toast.type}`}>
          <span className="toast-dot" />
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Top Desktop App Navigation Bar */}
      <header className="copilot-top-navbar">
        <div className="nav-brand-group">
          <CopilotRibbon />
          <span className="copilot-brand-title">KeyFlow</span>
          <button className="nav-icon-btn" onClick={handleNewSession} title="New chat session">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </button>
          <div className="session-select-pill" title="Current session ID">
            <span className="status-live-dot" />
            <span>{currentSessionId}</span>
          </div>
        </div>

        <div className="nav-center-status">
          <div className="status-indicator-pill">
            <span className="pill-dot-emerald" />
            <span>All systems operational · 2 Keys configured</span>
          </div>
        </div>

        <div className="nav-window-controls">
          <a
            href={`${API_BASE_URL}/docs`}
            target="_blank"
            rel="noreferrer"
            className="copilot-link-pill"
            title="Open Swagger API documentation"
          >
            Swagger Docs ↗
          </a>
          <button className="win-btn win-min" title="Minimize">─</button>
          <button className="win-btn win-max" title="Maximize">□</button>
          <button className="win-btn win-close" title="Close">✕</button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="copilot-body-layout">
        {messages.length === 0 ? (
          /* ================= HERO VIEW (MATCHING COPILOT DESKTOP SCREENSHOT) ================= */
          <div className="copilot-hero-container">
            {/* Greeting */}
            <div className="hero-greeting-box">
              <h1 className="hero-greeting-title">{greeting}, Rohit</h1>
              <h2 className="hero-greeting-sub">What can I help you with today?</h2>
            </div>

            {/* Central Large Pill Search/Input Box */}
            <div className="copilot-center-input-card">
              <textarea
                data-testid="chat-input"
                rows={2}
                className="center-input-textarea"
                placeholder="Ask anything"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={4000}
              />

              <div className="center-input-bottom-bar">
                {/* Model dropdown pill */}
                <div className="model-selector-pill">
                  <CopilotRibbon />
                  <span className="model-name-text">{currentModel}</span>
                  <span className="chevron-down">▾</span>
                </div>

                <div className="center-actions-right">
                  {/* System Prompt Toggle Button */}
                  <button
                    className={`tool-icon-btn ${showSystemPrompt ? "tool-active" : ""}`}
                    onClick={() => setShowSystemPrompt((p) => !p)}
                    title="Toggle System Prompt Drawer"
                  >
                    +
                  </button>

                  {/* Failover Simulation Icon Button */}
                  <button
                    className={`tool-icon-btn ${simulateFailure ? "tool-sim-on" : ""}`}
                    onClick={() => setShowSimModal((p) => !p)}
                    title="Configure Key Failover Simulation"
                  >
                    🛡️
                  </button>

                  {/* Send Button */}
                  <button
                    data-testid="send-button"
                    className="center-send-circle-btn"
                    disabled={loading || !input.trim()}
                    onClick={() => handleSend()}
                    title="Send message"
                  >
                    {loading ? (
                      <span className="spinner-icon">◌</span>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* System Prompt Expandable Bar */}
            {showSystemPrompt && (
              <div className="center-system-prompt-drawer">
                <span className="sys-badge">System Prompt:</span>
                <input
                  data-testid="system-prompt-input"
                  type="text"
                  className="center-sys-field"
                  placeholder="e.g. You are a concise mathematical assistant."
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                />
                <button className="sys-clear-btn" onClick={() => { setSystemPrompt(""); setShowSystemPrompt(false); }}>✕</button>
              </div>
            )}

            {/* Failover Simulation Popup */}
            {showSimModal && (
              <div className="center-sim-modal">
                <span className="sim-modal-title">Failover Simulation Hook:</span>
                <input
                  type="text"
                  className="sim-modal-input"
                  placeholder="key_1=429"
                  value={simulateFailure}
                  onChange={(e) => setSimulateFailure(e.target.value)}
                />
                <button
                  className="sim-modal-set-btn"
                  onClick={() => {
                    if (!simulateFailure) setSimulateFailure("key_1=429");
                    setShowSimModal(false);
                    showToast("Failover simulation updated", "warn");
                  }}
                >
                  Apply
                </button>
                <button className="sim-modal-clear-btn" onClick={() => { setSimulateFailure(""); setShowSimModal(false); }}>
                  Clear
                </button>
              </div>
            )}

            {/* Suggestion Chips Below Input */}
            <div className="hero-chips-row">
              {CHIPS.map((chip, idx) => (
                <button
                  key={idx}
                  className="copilot-chip-btn"
                  onClick={() => {
                    if (chip.sim) setSimulateFailure(chip.sim);
                    handleSend(chip.prompt, chip.sim);
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* ================= 3 FLOATING FROSTED CARDS AT BOTTOM ================= */}
            <div className="copilot-three-cards-grid">
              {/* Card 1: Provider Keys Pool */}
              <div className="copilot-bottom-card">
                <div className="card-top-row">
                  <div className="card-top-left">
                    <span className="card-icon">🔑</span>
                    <span className="card-title">Provider Keys Pool</span>
                  </div>
                  <span className="card-info-icon" title="LiteLLM Key Pool with sequential failover">ⓘ</span>
                </div>
                <div className="card-items-list">
                  <div className={`card-list-item ${isKey1Simulated ? "item-warn" : ""}`}>
                    <div className="item-icon-box">
                      <span className={`orb ${isKey1Simulated ? "orb-amber" : "orb-green"}`} />
                    </div>
                    <div className="item-text-box">
                      <div className="item-primary-text">key_1 (Primary Key)</div>
                      <div className="item-secondary-text">{isKey1Simulated ? "Simulated 429 · Retrying" : "Healthy · Active"}</div>
                    </div>
                    <span className="item-action-dots">•••</span>
                  </div>

                  <div className={`card-list-item ${isKey2Simulated ? "item-warn" : ""}`}>
                    <div className="item-icon-box">
                      <span className={`orb ${isKey2Simulated ? "orb-amber" : "orb-green"}`} />
                    </div>
                    <div className="item-text-box">
                      <div className="item-primary-text">key_2 (Fallback Key)</div>
                      <div className="item-secondary-text">{isKey2Simulated ? "Simulated Fail" : "Healthy · Standby"}</div>
                    </div>
                    <span className="item-action-dots">•••</span>
                  </div>
                </div>
              </div>

              {/* Card 2: Deterministic Cache & Storage */}
              <div className="copilot-bottom-card">
                <div className="card-top-row">
                  <div className="card-top-left">
                    <span className="card-icon">⚡</span>
                    <span className="card-title">Deterministic Cache</span>
                  </div>
                  <span className="card-info-icon" title="SHA-256 prompt response caching">ⓘ</span>
                </div>
                <div className="card-cache-body">
                  <div className="cache-toggle-line">
                    <span className="cache-status-label">{cacheEnabled ? "Cache Enabled" : "Cache Disabled"}</span>
                    <label className="copilot-switch">
                      <input
                        type="checkbox"
                        checked={cacheEnabled}
                        onChange={(e) => setCacheEnabled(e.target.checked)}
                      />
                      <span className="copilot-slider" />
                    </label>
                  </div>
                  <div className="cache-stats-badge">
                    <span>{cacheHits} total cache hits</span>
                    <span className="cache-tech-tag">SHA-256</span>
                  </div>
                  <div className="cache-desc-text">
                    Identical prompts across sessions return instantly with 0ms token latency.
                  </div>
                </div>
              </div>

              {/* Card 3: Recent Conversations (Session Memory) */}
              <div className="copilot-bottom-card">
                <div className="card-top-row">
                  <div className="card-top-left">
                    <span className="card-icon">💬</span>
                    <span className="card-title">Keep talking to KeyFlow</span>
                  </div>
                  <button className="card-new-btn" onClick={handleNewSession} title="Start new session">＋</button>
                </div>
                <div className="card-items-list">
                  {sessions.slice(0, 3).map((s) => {
                    const isActive = s.id === currentSessionId;
                    const count = (messagesBySession[s.id] || []).length;
                    return (
                      <div
                        key={s.id}
                        className={`card-list-item clickable ${isActive ? "item-active" : ""}`}
                        onClick={() => handleSelectSession(s.id)}
                      >
                        <div className="item-icon-box">💬</div>
                        <div className="item-text-box">
                          <div className="item-primary-text">{s.label}</div>
                          <div className="item-secondary-text">{count > 0 ? `${count} messages` : "Just now"} · {s.id}</div>
                        </div>
                        <span className="item-action-dots">•••</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ================= CHAT VIEW (ACTIVE CONVERSATION) ================= */
          <div className="copilot-chat-container">
            <div className="chat-stream-area">
              {messages.map((m, idx) => {
                if (m.role === "user") {
                  return (
                    <div key={idx} className="copilot-msg-row user-row">
                      <div className="copilot-user-bubble">
                        <div className="msg-content">{m.content}</div>
                        <div className="msg-meta-time">{formatTime(m.timestamp)}</div>
                      </div>
                    </div>
                  );
                }

                if (m.role === "error") {
                  return (
                    <div key={idx} className="copilot-msg-row">
                      <div className="copilot-error-card">
                        <span className="err-icon">⚠️</span>
                        <div>
                          <div className="err-title">Request Error</div>
                          <div className="err-msg">{m.content}</div>
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
                    {/* Failover Alert Banner */}
                    {meta.failover_note && (
                      <div className="copilot-failover-banner">
                        <span className="banner-shield">🛡️</span>
                        <span>{meta.failover_note}</span>
                      </div>
                    )}

                    <div
                      className={`copilot-msg-row assistant-row ${isSelected ? "row-selected" : ""}`}
                      onClick={() => {
                        setActiveMessageIndex(idx);
                        setShowDetails(true);
                      }}
                    >
                      <div className="copilot-avatar-col">
                        <CopilotRibbon />
                      </div>

                      <div className="copilot-assistant-bubble" data-testid="assistant-message">
                        <div className="msg-content">{m.content}</div>

                        {/* Metadata Strip */}
                        <div className="copilot-metadata-strip">
                          <span
                            data-testid="meta-source"
                            className={`badge-source ${isCache ? "badge-cache" : "badge-live"}`}
                          >
                            <span className="badge-dot" />
                            {meta.resolution_source || "LIVE_INFERENCE"}
                          </span>

                          {meta.fallback_attempts > 0 && (
                            <span className="badge-fallback">
                              🔄 {meta.fallback_attempts} fallback(s)
                            </span>
                          )}

                          <span data-testid="meta-latency" className="badge-chip">
                            ⏱️ {meta.latency_ms} ms
                          </span>

                          <span className="badge-chip">
                            <strong data-testid="meta-input-tokens">{meta.input_tokens}</strong> in ·{" "}
                            <strong data-testid="meta-output-tokens">{meta.output_tokens}</strong> out
                          </span>

                          {meta.key_id && (
                            <span className="badge-chip badge-key-mono">
                              🔑 {meta.key_id}
                            </span>
                          )}

                          <span data-testid="meta-model" style={{ display: "none" }}>
                            {meta.model || currentModel}
                          </span>

                          <div className="bubble-actions-right">
                            <CopyButton text={m.content} />
                            <button
                              className="copilot-inspect-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMessageIndex(idx);
                                setShowDetails(true);
                              }}
                            >
                              Details ↗
                            </button>
                          </div>
                        </div>

                        <div className="msg-meta-time">{formatTime(m.timestamp)}</div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}

              {loading && (
                <div className="copilot-msg-row assistant-row">
                  <div className="copilot-avatar-col">
                    <CopilotRibbon />
                  </div>
                  <div className="copilot-typing-bubble">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-label">KeyFlow is resolving with LiteLLM...</span>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Bottom Input Area in Active Chat */}
            <div className="copilot-bottom-input-deck">
              {showSystemPrompt && (
                <div className="center-system-prompt-drawer">
                  <span className="sys-badge">System Prompt:</span>
                  <input
                    data-testid="system-prompt-input"
                    type="text"
                    className="center-sys-field"
                    placeholder="e.g. You are a concise mathematical assistant."
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                  />
                  <button className="sys-clear-btn" onClick={() => { setSystemPrompt(""); setShowSystemPrompt(false); }}>✕</button>
                </div>
              )}

              <div className="copilot-center-input-card compact">
                <textarea
                  data-testid="chat-input"
                  rows={2}
                  className="center-input-textarea"
                  placeholder="Ask a follow-up question..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  maxLength={4000}
                />

                <div className="center-input-bottom-bar">
                  <div className="model-selector-pill">
                    <CopilotRibbon />
                    <span className="model-name-text">{currentModel}</span>
                  </div>

                  <div className="center-actions-right">
                    <button
                      className={`tool-icon-btn ${showSystemPrompt ? "tool-active" : ""}`}
                      onClick={() => setShowSystemPrompt((p) => !p)}
                      title="System prompt"
                    >
                      +
                    </button>

                    <div className="failover-inline-pill" title="Failover test simulation hook">
                      <span>🛡️</span>
                      <input
                        type="text"
                        className="inline-sim-input"
                        placeholder="key_1=429"
                        value={simulateFailure}
                        onChange={(e) => setSimulateFailure(e.target.value)}
                      />
                    </div>

                    <button
                      data-testid="send-button"
                      className="center-send-circle-btn"
                      disabled={loading || !input.trim()}
                      onClick={() => handleSend()}
                    >
                      ➔
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= RIGHT INSPECTOR SIDEBAR ================= */}
        {showDetails && selectedAssistant && (
          <aside className="copilot-details-drawer">
            <div className="drawer-top-row">
              <div>
                <h3 className="drawer-title">Request Details</h3>
                <span className="drawer-sub">Reply {currentAssistantIndex + 1} of {assistantReplies.length}</span>
              </div>
              <button className="copilot-action-icon" onClick={() => setShowDetails(false)}>✕</button>
            </div>

            {/* Resolution Card */}
            <div className={`drawer-resolution-card ${selectedAssistant.metadata?.resolution_source === "LLM_CACHE" ? "res-cache" : "res-live"}`}>
              <div className="res-icon">
                {selectedAssistant.metadata?.resolution_source === "LLM_CACHE" ? "⚡" : "✓"}
              </div>
              <div>
                <div className="res-title">
                  {selectedAssistant.metadata?.resolution_source === "LLM_CACHE" ? "Deterministic LLM Cache" : "Live Model Inference"}
                </div>
                <div className="res-desc">
                  {selectedAssistant.metadata?.resolution_source === "LLM_CACHE"
                    ? "Exact match found in SQLite local cache. 0 token cost incurred."
                    : selectedAssistant.metadata?.fallback_attempts > 0
                    ? `Answered by ${selectedAssistant.metadata?.key_id} after ${selectedAssistant.metadata?.fallback_attempts} fallback(s).`
                    : `Answered directly by ${selectedAssistant.metadata?.key_id}.`}
                </div>
              </div>
            </div>

            {/* 2x2 Metric Grid */}
            <div className="drawer-metrics-grid">
              <div className="drawer-metric-tile">
                <span className="dm-label">LATENCY</span>
                <span className="dm-val">{selectedAssistant.metadata?.latency_ms?.toLocaleString()} <span className="dm-unit">ms</span></span>
              </div>
              <div className="drawer-metric-tile">
                <span className="dm-label">FALLBACKS</span>
                <span className={`dm-val ${(selectedAssistant.metadata?.fallback_attempts || 0) > 0 ? "dm-warn" : ""}`}>
                  {selectedAssistant.metadata?.fallback_attempts || 0}
                </span>
              </div>
              <div className="drawer-metric-tile">
                <span className="dm-label">INPUT TOKENS</span>
                <span className="dm-val">{selectedAssistant.metadata?.input_tokens || 0}</span>
              </div>
              <div className="drawer-metric-tile">
                <span className="dm-label">OUTPUT TOKENS</span>
                <span className="dm-val">{selectedAssistant.metadata?.output_tokens || 0}</span>
              </div>
            </div>

            {/* Timeline */}
            <div className="drawer-section">
              <span className="drawer-section-title">RESOLUTION TIMELINE</span>
              <div className="drawer-timeline-list">
                {selectedAssistant.metadata?.timeline?.map((step, sIdx) => (
                  <div key={sIdx} className="timeline-item-row">
                    <div className="t-left">
                      <span className={`t-orb ${step.status === 200 ? "orb-green" : "orb-amber"}`} />
                      <span className="t-key">{step.key_id}</span>
                      <span className={`t-code ${step.status === 200 ? "code-200" : "code-fail"}`}>{step.status}</span>
                    </div>
                    <span className="t-ms">{step.latency_ms?.toLocaleString()} ms</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Engine Specs */}
            <div className="drawer-section">
              <span className="drawer-section-title">ENGINE SPECIFICATIONS</span>
              <div className="spec-table">
                <div className="spec-row">
                  <span className="spec-key">Model</span>
                  <span className="spec-val-mono">{selectedAssistant.metadata?.model || currentModel}</span>
                </div>
                <div className="spec-row">
                  <span className="spec-key">Provider</span>
                  <span className="spec-val">LiteLLM Key Pool</span>
                </div>
                <div className="spec-row">
                  <span className="spec-key">Persistence</span>
                  <span className="spec-val">SQLite (Session History)</span>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Footer Disclaimer */}
      <footer className="copilot-footer-bar">
        KeyFlow AI may make mistakes. Powered by LiteLLM key failover & deterministic response cache.
      </footer>
    </div>
  );
}
