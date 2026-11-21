import React, { useState, useRef, useEffect, useCallback } from "react";

const API_BASE_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:8000"
).replace(/\/$/, "");

function generateSessionId() {
  return `s-${Math.random().toString(36).substring(2, 9)}`;
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
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button className="copy-btn" onClick={handleCopy} title="Copy response">
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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

function TypingIndicator() {
  return (
    <div className="typing-indicator">
      <div className="ai-avatar small">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
      </div>
      <div className="typing-dots">
        <span /><span /><span />
      </div>
    </div>
  );
}

function Toast({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [sessions, setSessions] = useState(() => {
    const id = generateSessionId();
    return [{ id, label: "Session 1", createdAt: new Date().toISOString() }];
  });
  const [activeSessionId, setActiveSessionId] = useState(() => null);
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
  const [toasts, setToasts] = useState([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const bottomRef = useRef(null);
  const chatInputRef = useRef(null);
  const toastIdRef = useRef(0);

  // Init active session
  const currentSessionId = activeSessionId || sessions[0]?.id;
  const messages = messagesBySession[currentSessionId] || [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const addToast = useCallback((msg, type = "info") => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  const handleNewSession = () => {
    const id = generateSessionId();
    const label = `Session ${sessions.length + 1}`;
    setSessions((prev) => [...prev, { id, label, createdAt: new Date().toISOString() }]);
    setActiveSessionId(id);
    setActiveMessageIndex(null);
    setInput("");
    setShowDetails(false);
    addToast("New session started", "success");
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

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;

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
      if (simulateFailure.trim()) {
        headers["X-Simulate-Failure"] = simulateFailure.trim();
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
            : JSON.stringify(data.detail || "Error");
        setMessages((prev) => [
          ...prev,
          { role: "error", content: `Error (${res.status}): ${detail}`, timestamp: new Date().toISOString() },
        ]);
        addToast(`Request failed: ${res.status}`, "error");
        return;
      }

      if (data.metadata?.resolution_source === "LLM_CACHE") {
        setCacheHits((c) => c + 1);
        addToast("Served from cache ⚡", "cache");
      } else if (data.metadata?.fallback_attempts > 0) {
        addToast(`Failover used: ${data.metadata.fallback_attempts} key(s) tried`, "warn");
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
          content: `Network error: ${err.message}. Check that the backend is running and VITE_API_URL is correct.`,
          timestamp: new Date().toISOString(),
        },
      ]);
      addToast("Network error — check backend", "error");
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

  // Find assistant replies for details panel
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

  const filteredSessions = sessions.filter((s) =>
    s.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalMessages = Object.values(messagesBySession).reduce(
    (acc, msgs) => acc + (msgs || []).filter((m) => m.role === "assistant").length,
    0
  );

  return (
    <div className="layout-root">
      <Toast toasts={toasts} />

      {/* LEFT SIDEBAR */}
      <aside className={`sidebar-left ${sidebarCollapsed ? "collapsed" : ""}`}>
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="brand-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </div>
          {!sidebarCollapsed && (
            <div className="brand-text">
              <span className="brand-title">KeyFlow</span>
              <span className="brand-sub">AI Gateway</span>
            </div>
          )}
          <button className="sidebar-toggle" onClick={() => setSidebarCollapsed((p) => !p)} title="Toggle sidebar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {sidebarCollapsed ? <polyline points="9 18 15 12 9 6" /> : <polyline points="15 18 9 12 15 6" />}
            </svg>
          </button>
        </div>

        {!sidebarCollapsed && (
          <>
            {/* New Session Button */}
            <button className="btn-new-session" onClick={handleNewSession}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Session
            </button>

            {/* Search */}
            <div className="search-box">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Search sessions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>

            {/* Sessions List */}
            <div className="sidebar-section">
              <div className="section-label">SESSIONS</div>
              <div className="sessions-list">
                {filteredSessions.map((s) => {
                  const sessionMsgs = messagesBySession[s.id] || [];
                  const msgCount = sessionMsgs.filter((m) => m.role !== "error").length;
                  const isActive = s.id === currentSessionId;
                  return (
                    <button
                      key={s.id}
                      className={`session-item ${isActive ? "session-active" : ""}`}
                      onClick={() => handleSelectSession(s.id)}
                    >
                      <div className="session-item-icon">{isActive ? "●" : "○"}</div>
                      <div className="session-item-info">
                        <div className="session-item-label">{s.label}</div>
                        <div className="session-item-meta">
                          <span className="session-id-mono">{s.id}</span>
                          {msgCount > 0 && <span>· {msgCount} msgs</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Provider Keys */}
            <div className="sidebar-section">
              <div className="section-label">PROVIDER KEYS</div>
              <div className="keys-list">
                <div className="key-item">
                  <div className="key-left">
                    <span className={`dot ${isKey1Simulated ? "dot-amber pulse-amber" : "dot-green pulse-green"}`} />
                    <span className="key-name">key_1</span>
                  </div>
                  <span className={`key-badge ${isKey1Simulated ? "badge-limited" : "badge-healthy"}`}>
                    {isKey1Simulated ? "Simulated" : "Active"}
                  </span>
                </div>
                <div className="key-item">
                  <div className="key-left">
                    <span className={`dot ${isKey2Simulated ? "dot-amber pulse-amber" : "dot-green pulse-green"}`} />
                    <span className="key-name">key_2</span>
                  </div>
                  <span className={`key-badge ${isKey2Simulated ? "badge-limited" : "badge-healthy"}`}>
                    {isKey2Simulated ? "Simulated" : "Active"}
                  </span>
                </div>
              </div>
            </div>

            {/* Cache Status */}
            <div className="sidebar-section">
              <div className="section-label">RESPONSE CACHE</div>
              <div className="cache-card">
                <div className="cache-row">
                  <div className="cache-info">
                    <div className="cache-status-text">
                      {cacheEnabled ? "Enabled" : "Disabled"}
                    </div>
                    <div className="cache-detail">SHA-256 deterministic · {cacheHits} {cacheHits === 1 ? "hit" : "hits"}</div>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={cacheEnabled}
                      onChange={(e) => setCacheEnabled(e.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                </div>
                {totalMessages > 0 && (
                  <div className="cache-stats-bar">
                    <div
                      className="cache-stats-fill"
                      style={{ width: `${totalMessages > 0 ? Math.min(100, (cacheHits / totalMessages) * 100) : 0}%` }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="sidebar-section sidebar-stats">
              <div className="stat-row">
                <span className="stat-label">Total responses</span>
                <span className="stat-val">{totalMessages}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Model</span>
                <span className="stat-val model-chip">{currentModel}</span>
              </div>
            </div>
          </>
        )}

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="user-avatar">G</div>
          {!sidebarCollapsed && <span className="user-label">Guest</span>}
        </div>
      </aside>

      {/* CENTER CHAT */}
      <main className="main-chat">
        {/* Navbar */}
        <header className="chat-navbar">
          <div className="nav-left">
            <div className="model-pill">
              <span className="model-dot" />
              <span>{currentModel}</span>
            </div>
            {messages.length > 0 && (
              <div className="session-pill">{currentSessionId}</div>
            )}
          </div>

          <div className="nav-center">
            {!simulateFailure ? (
              <div className="status-badge status-normal">
                <span className="status-dot pulse-green-sm" />
                All systems normal
              </div>
            ) : (
              <div className="status-badge status-warn">
                <span className="status-dot-warn" />
                Failure simulation active
              </div>
            )}
          </div>

          <div className="nav-right">
            <div className={`simulate-pill ${simulateFailure ? "simulate-active" : ""}`}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span className="simulate-label">Simulate:</span>
              <input
                type="text"
                className="simulate-input"
                placeholder="key_1=429"
                value={simulateFailure}
                onChange={(e) => setSimulateFailure(e.target.value)}
                title="Format: key_1=429, key_2=500, *=429 (all keys)"
              />
              <button
                className="simulate-toggle-btn"
                onClick={() => setSimulateFailure((prev) => (prev ? "" : "key_1=429"))}
              >
                {simulateFailure ? "Clear" : "Set"}
              </button>
            </div>
          </div>
        </header>

        {/* Chat Stream */}
        <div className="chat-stream">
          {messages.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
              </div>
              <div className="empty-title">KeyFlow AI Gateway</div>
              <div className="empty-desc">
                Multi-turn conversation memory · LiteLLM key failover · Deterministic response caching
              </div>
              <div className="feature-cards">
                <div className="feature-card">
                  <div className="feature-icon fc-blue">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <div className="feature-label">Multi-Turn Memory</div>
                  <div className="feature-desc">Full conversation history stored in SQLite per session</div>
                </div>
                <div className="feature-card">
                  <div className="feature-icon fc-purple">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                    </svg>
                  </div>
                  <div className="feature-label">Response Cache</div>
                  <div className="feature-desc">SHA-256 deterministic cache — identical prompts served instantly</div>
                </div>
                <div className="feature-card">
                  <div className="feature-icon fc-amber">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                  </div>
                  <div className="feature-label">Key Failover</div>
                  <div className="feature-desc">Sequential fallback across API key pool on 429/500 errors</div>
                </div>
              </div>
              <div className="simulate-hint">
                <code>key_1=429</code> → test failover &nbsp;|&nbsp; <code>*=429</code> → all keys fail
              </div>
            </div>
          )}

          {messages.map((m, idx) => {
            if (m.role === "user") {
              return (
                <div key={idx} className="msg-row user-row">
                  <div className="user-bubble">
                    <div className="user-bubble-text">{m.content}</div>
                    <div className="msg-timestamp">{formatTime(m.timestamp)}</div>
                  </div>
                  <div className="user-avatar-sm">U</div>
                </div>
              );
            }

            if (m.role === "error") {
              return (
                <div key={idx} className="msg-row">
                  <div className="error-card">
                    <div className="error-icon-wrap">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                    </div>
                    <div className="error-content">
                      <div className="error-title">Request Failed</div>
                      <div className="error-msg">{m.content}</div>
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
                {meta.failover_note && (
                  <div className="failover-banner">
                    <svg className="failover-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                    <span>{meta.failover_note}</span>
                  </div>
                )}

                <div
                  className={`msg-row assistant-row ${isSelected ? "row-selected" : ""}`}
                  onClick={() => {
                    setActiveMessageIndex(idx);
                    setShowDetails(true);
                  }}
                >
                  <div className="ai-avatar">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                    </svg>
                  </div>

                  <div className="assistant-container" data-testid="assistant-message">
                    <div className="assistant-text">{m.content}</div>

                    <div className="metadata-strip">
                      <span
                        data-testid="meta-source"
                        className={`source-badge ${isCache ? "source-cache" : "source-live"}`}
                      >
                        <span className="badge-dot" />
                        {meta.resolution_source || "LIVE_INFERENCE"}
                      </span>

                      {meta.fallback_attempts > 0 && (
                        <span className="fallback-badge">
                          {meta.fallback_attempts} {meta.fallback_attempts === 1 ? "fallback" : "fallbacks"}
                        </span>
                      )}

                      <span data-testid="meta-latency" className="meta-chip">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                        </svg>
                        {meta.latency_ms} ms
                      </span>

                      <span className="meta-chip">
                        <strong data-testid="meta-input-tokens">{meta.input_tokens}</strong>
                        {" in · "}
                        <strong data-testid="meta-output-tokens">{meta.output_tokens}</strong>
                        {" out"}
                      </span>

                      {meta.key_id && (
                        <span className="meta-chip meta-key-chip">{meta.key_id}</span>
                      )}

                      <span data-testid="meta-model" style={{ display: "none" }}>
                        {meta.model || currentModel}
                      </span>

                      <div className="meta-actions">
                        <CopyButton text={m.content} />
                        <button
                          className="details-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMessageIndex(idx);
                            setShowDetails(true);
                          }}
                          title="View request details"
                        >
                          Details
                        </button>
                      </div>
                    </div>

                    <div className="msg-timestamp">{formatTime(m.timestamp)}</div>
                  </div>
                </div>
              </React.Fragment>
            );
          })}

          {loading && <TypingIndicator />}

          <div ref={bottomRef} />
        </div>

        {/* Input Area */}
        <div className="chat-input-wrapper">
          {showSystemPrompt && (
            <div className="system-prompt-bar">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <label className="sys-label">System prompt</label>
              <input
                id="sys-input"
                data-testid="system-prompt-input"
                type="text"
                className="sys-input"
                placeholder="e.g. You are a concise geography assistant."
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
              />
              <button className="sys-clear" onClick={() => { setSystemPrompt(""); setShowSystemPrompt(false); }}>✕</button>
            </div>
          )}

          <div className="input-card">
            <textarea
              ref={chatInputRef}
              data-testid="chat-input"
              rows={3}
              className="chat-textarea"
              placeholder="Message KeyFlow AI..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={4000}
            />

            <div className="input-actions-bar">
              <div className="actions-left">
                <button
                  type="button"
                  className={`btn-action-pill ${showSystemPrompt || systemPrompt ? "pill-active" : ""}`}
                  onClick={() => setShowSystemPrompt((prev) => !prev)}
                  title="Set system prompt"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  System prompt
                  {systemPrompt && <span className="pill-dot" />}
                </button>

                <div className={`simulate-inline-pill ${simulateFailure ? "sim-on" : ""}`}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>{simulateFailure ? `Fail: ${simulateFailure}` : "Simulate failure"}</span>
                </div>
              </div>

              <div className="actions-right">
                <span className={`char-count ${input.length > 3800 ? "char-warn" : ""}`}>
                  {input.length}/4000
                </span>
                <button
                  data-testid="send-button"
                  type="button"
                  className="btn-send"
                  disabled={loading || !input.trim()}
                  onClick={handleSend}
                >
                  {loading ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="spin">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
          <div className="input-hint">
            Enter to send · Shift+Enter for new line · Same prompt → cache hit
          </div>
        </div>
      </main>

      {/* RIGHT SIDEBAR */}
      {showDetails && selectedAssistant && (
        <aside className="sidebar-right">
          <div className="details-header">
            <div>
              <div className="details-title">Request Details</div>
              <div className="details-sub">
                Reply {currentAssistantIndex + 1} of {assistantReplies.length}
              </div>
            </div>
            <button className="btn-close-details" onClick={() => setShowDetails(false)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Status Card */}
          <div className={`status-card ${selectedAssistant.metadata?.resolution_source === "LLM_CACHE" ? "status-cache" : "status-live"}`}>
            <div className="status-icon">
              {selectedAssistant.metadata?.resolution_source === "LLM_CACHE" ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
            <div className="status-text">
              {selectedAssistant.metadata?.resolution_source === "LLM_CACHE"
                ? "Served instantly from deterministic local cache."
                : selectedAssistant.metadata?.fallback_attempts > 0
                ? `Answered by ${selectedAssistant.metadata?.key_id} after ${selectedAssistant.metadata?.fallback_attempts === 1 ? "one automatic fallback" : `${selectedAssistant.metadata?.fallback_attempts} fallbacks`}.`
                : `Live inference via ${selectedAssistant.metadata?.key_id}.`}
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="metrics-grid">
            <div className="metric-box">
              <div className="metric-label">Latency</div>
              <div className="metric-value">{selectedAssistant.metadata?.latency_ms?.toLocaleString()}<span className="metric-unit"> ms</span></div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Fallbacks</div>
              <div className={`metric-value ${(selectedAssistant.metadata?.fallback_attempts || 0) > 0 ? "metric-warn" : ""}`}>
                {selectedAssistant.metadata?.fallback_attempts || 0}
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Input tokens</div>
              <div className="metric-value">{selectedAssistant.metadata?.input_tokens || 0}</div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Output tokens</div>
              <div className="metric-value">{selectedAssistant.metadata?.output_tokens || 0}</div>
            </div>
          </div>

          {/* Timeline */}
          <div className="details-section">
            <div className="details-section-label">KEY RESOLUTION TIMELINE</div>

            {selectedAssistant.metadata?.timeline && selectedAssistant.metadata.timeline.length > 1 && (
              <div className="timeline-bar-wrap">
                {selectedAssistant.metadata.timeline.map((step, si) => (
                  <div
                    key={si}
                    className={`bar-seg ${step.status === 200 ? "bar-green" : "bar-amber"}`}
                    style={{ flex: 1 }}
                    title={`${step.key_id}: ${step.status} (${step.latency_ms}ms)`}
                  />
                ))}
              </div>
            )}

            <div className="timeline-rows">
              {selectedAssistant.metadata?.timeline?.map((step, sIdx) => (
                <div key={sIdx} className="timeline-row">
                  <div className="timeline-row-left">
                    <span className={`dot ${step.status === 200 ? "dot-green" : "dot-amber"}`} />
                    <span className="timeline-key">{step.key_id}</span>
                    <span className={`timeline-code ${step.status === 200 ? "code-ok" : "code-err"}`}>
                      {step.status}
                    </span>
                  </div>
                  <div className="timeline-row-right">{step.latency_ms?.toLocaleString()} ms</div>
                </div>
              ))}
              {!selectedAssistant.metadata?.timeline && (
                <div className="timeline-row">
                  <div className="timeline-row-left">
                    <span className="dot dot-green" />
                    <span className="timeline-key">{selectedAssistant.metadata?.key_id || "cache"}</span>
                    <span className="timeline-code code-ok">200</span>
                  </div>
                  <div className="timeline-row-right">{selectedAssistant.metadata?.latency_ms} ms</div>
                </div>
              )}
            </div>
          </div>

          {/* Cache Section */}
          <div className="details-section">
            <div className="details-section-label">CACHE STATUS</div>
            <div className={`cache-status-box ${selectedAssistant.metadata?.resolution_source === "LLM_CACHE" ? "cache-hit" : "cache-miss"}`}>
              <div className="cache-status-row">
                <span>{selectedAssistant.metadata?.resolution_source === "LLM_CACHE" ? "HIT" : "MISS"}</span>
                <span className="cache-status-badge">
                  {selectedAssistant.metadata?.resolution_source === "LLM_CACHE" ? "0 tokens used" : "Stored for future"}
                </span>
              </div>
              <div className="cache-status-desc">
                {selectedAssistant.metadata?.resolution_source === "LLM_CACHE"
                  ? "Exact prompt match found. No LLM call made — 0 token cost incurred."
                  : "Reply stored in cache. Same prompt next time returns LLM_CACHE instantly."}
              </div>
            </div>
          </div>

          {/* Model Info */}
          <div className="details-section">
            <div className="details-section-label">MODEL</div>
            <div className="model-info-box">
              <div className="model-info-name">{selectedAssistant.metadata?.model || currentModel}</div>
              <div className="model-info-sub">via LiteLLM · gemini provider</div>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
