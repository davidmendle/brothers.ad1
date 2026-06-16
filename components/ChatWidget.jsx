"use client";

import { useState } from "react";

const starterMessages = [
  {
    role: "assistant",
    content:
      "Hi, I am the Brothers.ad AI assistant. Ask about sales follow-up, AI operations, review automation, or what to automate first."
  }
];

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(starterMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendMessage(event) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const nextMessages = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed })
      });
      const data = await response.json();
      setMessages([...nextMessages, { role: "assistant", content: data.reply }]);
    } catch {
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content:
            "I had trouble answering that. For a fast audit, call 857-636-0833 or use the audit form on this page."
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  function openChat() {
    window.dispatchEvent(new Event("brothers-ad-chat-open"));
    setOpen(true);
  }

  return (
    <>
      {open ? (
        <aside className="chat-panel" aria-label="AI chat assistant">
          <div className="chat-head">
            <div>
              <strong>Brothers.ad Assistant</strong>
              <span>AI automation guidance</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat">
              x
            </button>
          </div>
          <div className="chat-messages">
            {messages.map((message, index) => (
              <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
                {message.content}
              </div>
            ))}
            {loading ? <div className="chat-message assistant">Thinking...</div> : null}
          </div>
          <form className="chat-input" onSubmit={sendMessage}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask what AI should automate..."
              aria-label="Ask the AI assistant"
            />
            <button type="submit" disabled={loading || !input.trim()}>
              Send
            </button>
          </form>
        </aside>
      ) : null}
      <button className="chat" type="button" aria-label="Open AI chat" onClick={openChat}>
        ?
      </button>
    </>
  );
}
