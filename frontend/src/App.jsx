import React, { useState, useRef, useEffect } from "react";

const API_BASE_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:8000"
).replace(/\/$/, "");

function generateSessionId() {
  return `s-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`;
}

export default function App() {
  const [sessionId] = useState(() => generateSessionId());
  const [systemPrompt, setSystemPrompt] = useState("");
  const [simulateFailure, setSimulateFailure] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    setInput("");
    setLoading(true);
    // Persist user turn in active chat stream without clearing on subsequent error
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);

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
        const errMsg = `Error (${res.status}): ${detail}`;
        // Render inline readable error message in the chat stream without blanking or clearing messages
        setMessages((prev) => [
          ...prev,
          { role: "error", content: errMsg },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply, metadata: data.metadata },
      ]);
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

  return (
    <div className="app-container">
      <header className="app-header">
        <div>
          <h1>KeyFlow AI Gateway</h1>
          <div className="session-badge">Session: {sessionId}</div>
        </div>
        <div className="header-controls">
          <div className="system-prompt-box">
            <label htmlFor="sys-prompt">System Prompt:</label>
            <input
              id="sys-prompt"
              data-testid="system-prompt-input"
              type="text"
              placeholder="Optional system prompt..."
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </div>
          <div className="simulate-box">
            <label htmlFor="sim-failure">Simulate Fail:</label>
            <input
              id="sim-failure"
              type="text"
              placeholder="e.g. key_1=429"
              value={simulateFailure}
              onChange={(e) => setSimulateFailure(e.target.value)}
            />
          </div>
        </div>
      </header>

      <main className="chat-window">
        {messages.length === 0 && (
          <div className="welcome-banner">
            <h3>KeyFlow AI — Resilient Multi-Turn LLM Chatbot Gateway</h3>
            <p>
              Features: Multi-Turn Conversation Memory, LiteLLM Deterministic Caching,
              and Key Pool Sequential Failover.
            </p>
          </div>
        )}

        {messages.map((m, idx) => {
          if (m.role === "user") {
            return (
              <div key={idx} className="message-row user-row">
                <div className="bubble user-bubble">{m.content}</div>
              </div>
            );
          }

          if (m.role === "error") {
            return (
              <div key={idx} className="message-row error-row">
                <div className="error-banner">
                  <strong>Notice:</strong> {m.content}
                </div>
              </div>
            );
          }

          return (
            <div key={idx} className="message-row assistant-row">
              <div
                className="bubble assistant-bubble"
                data-testid="assistant-message"
              >
                <div className="assistant-text">{m.content}</div>
                {m.metadata && (
                  <div className="meta-bar">
                    <span
                      data-testid="meta-source"
                      className={`badge ${
                        m.metadata.resolution_source === "LLM_CACHE"
                          ? "badge-cache"
                          : "badge-live"
                      }`}
                    >
                      {m.metadata.resolution_source}
                    </span>
                    <span data-testid="meta-model" className="meta-item">
                      {m.metadata.model}
                    </span>
                    <span data-testid="meta-latency" className="meta-item">
                      {m.metadata.latency_ms} ms
                    </span>
                    <span className="meta-item">
                      In:{" "}
                      <strong data-testid="meta-input-tokens">
                        {m.metadata.input_tokens}
                      </strong>
                    </span>
                    <span className="meta-item">
                      Out:{" "}
                      <strong data-testid="meta-output-tokens">
                        {m.metadata.output_tokens}
                      </strong>
                    </span>
                    {m.metadata.key_id && (
                      <span className="meta-item">
                        Key: {m.metadata.key_id}
                      </span>
                    )}
                    {m.metadata.fallback_attempts > 0 && (
                      <span className="meta-item meta-fallback">
                        Fallback: {m.metadata.fallback_attempts}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="loading-indicator">Generating response...</div>
        )}
        <div ref={bottomRef} />
      </main>

      <form className="input-bar" onSubmit={handleSend}>
        <textarea
          data-testid="chat-input"
          rows={2}
          placeholder="Type your message... (Press Enter to send, Shift+Enter for new line)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          data-testid="send-button"
          type="submit"
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
}
