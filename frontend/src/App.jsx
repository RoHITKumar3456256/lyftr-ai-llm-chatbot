import React, { useState, useRef, useEffect } from "react";

const API_BASE_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:8000"
).replace(/\/$/, "");

function generateSessionId() {
  return `s-${Math.random().toString(36).substring(2, 6)}`;
}

export default function App() {
  const [sessionId, setSessionId] = useState(() => generateSessionId());
  const [systemPrompt, setSystemPrompt] = useState("");
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [simulateFailure, setSimulateFailure] = useState("key_1=429");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cacheEnabled, setCacheEnabled] = useState(true);
  const [cacheHits, setCacheHits] = useState(0);
  const [activeMessageIndex, setActiveMessageIndex] = useState(null);
  const [showDetails, setShowDetails] = useState(true);
  const [currentModel, setCurrentModel] = useState("gemini-2.5-flash");

  const bottomRef = useRef(null);
  const chatInputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleNewSession = () => {
    setSessionId(generateSessionId());
    setMessages([]);
    setActiveMessageIndex(null);
    setInput("");
  };

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    setInput("");
    setLoading(true);

    const userMsg = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const payload = { session_id: sessionId, message: trimmed };
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
          { role: "error", content: `Error (${res.status}): ${detail}` },
        ]);
        return;
      }

      if (data.metadata?.resolution_source === "LLM_CACHE") {
        setCacheHits((c) => c + 1);
      }
      if (data.metadata?.model) {
        setCurrentModel(data.metadata.model.replace("gemini/", ""));
      }

      const assistantMsg = {
        role: "assistant",
        content: data.reply,
        metadata: data.metadata,
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
        { role: "error", content: `Network error: ${err.message}` },
      ]);
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

  // Determine provider key states from current failover simulation or timeline
  const isKey1RateLimited =
    simulateFailure.includes("key_1=429") || simulateFailure.includes("*=");

  return (
    <div className="layout-root">
      {/* LEFT SIDEBAR */}
      <aside className="sidebar-left">
        <div className="sidebar-header">
          <div className="brand">
            <svg
              className="brand-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            <span className="brand-title">KeyFlow</span>
          </div>

          <button className="btn-new-session" onClick={handleNewSession}>
            <span className="plus-sign">+</span> New session
          </button>
        </div>

        <div className="sidebar-section">
          <div className="section-label">SESSION</div>
          <div className="session-card">
            <div className="session-id">{sessionId}</div>
            <div className="session-sub">
              {messages.length} messages · started just now
            </div>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="section-label">PROVIDER KEYS</div>
          <div className="keys-list">
            <div className="key-item">
              <span className="key-name">
                <span
                  className={`dot ${isKey1RateLimited ? "dot-amber" : "dot-green"}`}
                ></span>
                key_1
              </span>
              <span
                className={`key-badge ${
                  isKey1RateLimited ? "badge-rate-limited" : "badge-healthy"
                }`}
              >
                {isKey1RateLimited ? "Rate limited" : "Healthy"}
              </span>
            </div>

            <div className="key-item">
              <span className="key-name">
                <span className="dot dot-green"></span>
                key_2
              </span>
              <span className="key-badge badge-healthy">Healthy</span>
            </div>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="section-label">RESPONSE CACHE</div>
          <div className="cache-card">
            <div className="cache-card-header">
              <span className="cache-card-title">Enabled</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={cacheEnabled}
                  onChange={(e) => setCacheEnabled(e.target.checked)}
                />
                <span className="slider"></span>
              </label>
            </div>
            <div className="cache-sub">
              Disk · {cacheHits} {cacheHits === 1 ? "hit" : "hits"} this session
            </div>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="user-avatar">G</div>
          <div className="user-label">Guest session</div>
        </div>
      </aside>

      {/* CENTER CHAT AREA */}
      <main className="main-chat">
        {/* Top Navbar */}
        <header className="chat-navbar">
          <div className="nav-left">
            <div className="model-pill">
              <span>{currentModel}</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>

          <div className="nav-center">
            <div className="status-badge">
              <span className="status-dot"></span>
              <span>All systems normal</span>
            </div>
          </div>

          <div className="nav-right">
            <div className="simulate-pill">
              <span className="simulate-label">Simulate:</span>
              <input
                type="text"
                className="simulate-input"
                placeholder="key_1=429"
                value={simulateFailure}
                onChange={(e) => setSimulateFailure(e.target.value)}
                title="Edit or clear to test failure simulation"
              />
              <button
                className="simulate-toggle-btn"
                onClick={() =>
                  setSimulateFailure((prev) =>
                    prev ? "" : "key_1=429"
                  )
                }
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
              <div className="empty-title">KeyFlow AI Gateway</div>
              <div className="empty-desc">
                Multi-Turn Conversation Memory, LiteLLM Key Failover & Deterministic Response Caching.
              </div>
            </div>
          )}

          {messages.map((m, idx) => {
            if (m.role === "user") {
              return (
                <div key={idx} className="msg-row user-row">
                  <div className="user-bubble">{m.content}</div>
                </div>
              );
            }

            if (m.role === "error") {
              return (
                <div key={idx} className="msg-row error-row">
                  <div className="error-card">
                    <span className="error-icon">⚠️</span>
                    <span>{m.content}</span>
                  </div>
                </div>
              );
            }

            const meta = m.metadata || {};
            const isCache = meta.resolution_source === "LLM_CACHE";

            return (
              <React.Fragment key={idx}>
                {/* Failover Alert Banner if previous key failed */}
                {meta.failover_note && (
                  <div className="failover-notice">
                    <svg
                      className="rotate-icon"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                    >
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                    <span>{meta.failover_note}</span>
                  </div>
                )}

                <div
                  className={`msg-row assistant-row ${
                    activeMessageIndex === idx ? "row-selected" : ""
                  }`}
                  onClick={() => {
                    setActiveMessageIndex(idx);
                    setShowDetails(true);
                  }}
                >
                  <div
                    className="assistant-container"
                    data-testid="assistant-message"
                  >
                    <div className="assistant-text">{m.content}</div>

                    <div className="metadata-strip">
                      <span
                        data-testid="meta-source"
                        className={`source-badge ${
                          isCache ? "source-cache" : "source-live"
                        }`}
                      >
                        <span className="badge-dot"></span>
                        {meta.resolution_source || "LIVE_INFERENCE"}
                      </span>

                      {meta.fallback_attempts > 0 && (
                        <span className="fallback-badge">
                          {meta.fallback_attempts}{" "}
                          {meta.fallback_attempts === 1
                            ? "fallback"
                            : "fallbacks"}
                        </span>
                      )}

                      <span data-testid="meta-latency" className="meta-text">
                        {meta.latency_ms} ms
                      </span>

                      <span className="meta-tokens">
                        <strong data-testid="meta-input-tokens">
                          {meta.input_tokens}
                        </strong>{" "}
                        in ·{" "}
                        <strong data-testid="meta-output-tokens">
                          {meta.output_tokens}
                        </strong>{" "}
                        out
                      </span>

                      <span className="meta-key">
                        {meta.key_id ? `key_${meta.key_id.replace('key_', '')}` : "key null"}
                      </span>

                      <span
                        data-testid="meta-model"
                        style={{ display: "none" }}
                      >
                        {meta.model || currentModel}
                      </span>
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })}

          {loading && (
            <div className="loading-row">
              <div className="loading-pulse">Thinking & resolving...</div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Bottom Input Area */}
        <div className="chat-input-wrapper">
          <div className="input-card">
            {/* System prompt expander */}
            {showSystemPrompt && (
              <div className="system-prompt-drawer">
                <label htmlFor="sys-input" className="sys-label">
                  System Prompt:
                </label>
                <input
                  id="sys-input"
                  data-testid="system-prompt-input"
                  type="text"
                  className="sys-input"
                  placeholder="e.g. You are a concise geography assistant."
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                />
              </div>
            )}

            <textarea
              ref={chatInputRef}
              data-testid="chat-input"
              rows={2}
              className="chat-textarea"
              placeholder="Ask anything"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />

            <div className="input-actions-bar">
              <div className="actions-left">
                <button
                  type="button"
                  className={`btn-sys-prompt ${
                    systemPrompt ? "btn-sys-prompt-active" : ""
                  }`}
                  onClick={() => setShowSystemPrompt((prev) => !prev)}
                >
                  System prompt
                </button>
              </div>

              <div className="actions-right">
                <span className="char-count">{input.length} / 4000</span>
                <button
                  data-testid="send-button"
                  type="button"
                  className="btn-send-round"
                  disabled={loading || !input.trim()}
                  onClick={handleSend}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div className="input-footer-note">
            Identical prompts are served from cache. Enter to send, Shift+Enter for a new line.
          </div>
        </div>
      </main>

      {/* RIGHT SIDEBAR (REQUEST DETAILS) */}
      {showDetails && selectedAssistant && (
        <aside className="sidebar-right">
          <div className="details-header">
            <div>
              <div className="details-title">Request details</div>
              <div className="details-sub">
                Reply {currentAssistantIndex + 1} of {assistantReplies.length}
              </div>
            </div>
            <button
              className="btn-close-details"
              onClick={() => setShowDetails(false)}
            >
              ✕
            </button>
          </div>

          {/* Success / Fallback Status Banner */}
          <div
            className={`details-status-card ${
              selectedAssistant.metadata?.resolution_source === "LLM_CACHE"
                ? "status-card-cache"
                : "status-card-live"
            }`}
          >
            <div className="status-check">✓</div>
            <div className="status-msg">
              {selectedAssistant.metadata?.resolution_source === "LLM_CACHE"
                ? "Served instantly from deterministic local cache."
                : selectedAssistant.metadata?.fallback_attempts > 0
                ? `Answered by ${selectedAssistant.metadata?.key_id} after ${
                    selectedAssistant.metadata?.fallback_attempts === 1
                      ? "one automatic fallback."
                      : `${selectedAssistant.metadata?.fallback_attempts} automatic fallbacks.`
                  }`
                : `Answered directly by ${selectedAssistant.metadata?.key_id} with live inference.`}
            </div>
          </div>

          {/* 2x2 Metric Cards */}
          <div className="metrics-grid">
            <div className="metric-box">
              <div className="metric-label">Latency</div>
              <div className="metric-value">
                {selectedAssistant.metadata?.latency_ms?.toLocaleString()} ms
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Fallbacks</div>
              <div className="metric-value">
                {selectedAssistant.metadata?.fallback_attempts || 0}
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Input tokens</div>
              <div className="metric-value">
                {selectedAssistant.metadata?.input_tokens || 0}
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Output tokens</div>
              <div className="metric-value">
                {selectedAssistant.metadata?.output_tokens || 0}
              </div>
            </div>
          </div>

          {/* TIMELINE */}
          <div className="details-section">
            <div className="details-section-label">TIMELINE</div>
            <div className="timeline-bar">
              {selectedAssistant.metadata?.timeline &&
              selectedAssistant.metadata.timeline.length > 1 ? (
                <>
                  <div className="bar-segment bar-amber" style={{ width: "20%" }}></div>
                  <div className="bar-segment bar-green" style={{ width: "80%" }}></div>
                </>
              ) : (
                <div className="bar-segment bar-green" style={{ width: "100%" }}></div>
              )}
            </div>

            <div className="timeline-rows">
              {selectedAssistant.metadata?.timeline?.map((step, sIdx) => (
                <div key={sIdx} className="timeline-row">
                  <div className="timeline-row-left">
                    <span
                      className={`dot ${
                        step.status === 200 ? "dot-green" : "dot-amber"
                      }`}
                    ></span>
                    <span>
                      {step.key_id} · {step.status}
                    </span>
                  </div>
                  <div className="timeline-row-right">
                    {step.latency_ms?.toLocaleString()} ms
                  </div>
                </div>
              ))}
              {!selectedAssistant.metadata?.timeline && (
                <div className="timeline-row">
                  <div className="timeline-row-left">
                    <span className="dot dot-green"></span>
                    <span>
                      {selectedAssistant.metadata?.key_id || "cache"} · 200
                    </span>
                  </div>
                  <div className="timeline-row-right">
                    {selectedAssistant.metadata?.latency_ms} ms
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* CACHE EXPLANATION */}
          <div className="details-section">
            <div className="details-section-label">CACHE</div>
            <div className="cache-explanation">
              {selectedAssistant.metadata?.resolution_source === "LLM_CACHE"
                ? "Served from cache. Exact prompt match found in SQLite / LiteLLM cache store. 0 token cost incurred."
                : "Not served from cache. This reply is now stored, so the same prompt in any session returns LLM_CACHE."}
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
