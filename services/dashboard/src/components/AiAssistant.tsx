"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Send, RefreshCw, Bot, User } from "lucide-react";

// Shown when no API key is configured (or the room is offline): the panel
// always has something sensible to display for a demo.
const SAMPLE_BRIEFING =
  "Good morning. The gate is calm so far — connect the AI key to get a live briefing generated from today's real entries, denials, and guest passes.";

const SAMPLE_QUESTIONS = [
  "Who was late today?",
  "Any unknown faces this morning?",
  "How many guests entered?",
];

interface ChatMsg {
  role: "user" | "ai";
  text: string;
}

export function AiBriefing() {
  const [briefing, setBriefing] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [unconfigured, setUnconfigured] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/briefing");
      const json = await res.json();
      setBriefing(json.briefing ?? null);
    } catch {
      /* offline — sample text covers the demo */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/ai/briefing", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 503) setUnconfigured(true);
        setError(json.error || "Could not generate the briefing.");
        return;
      }
      setBriefing(json.briefing);
    } catch {
      setError("No connection to the server.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-violet-600" />
          </div>
          <div>
            <p className="font-bold text-surface-900 text-sm">AI Daily Briefing</p>
            <p className="text-[11px] font-medium text-surface-400">
              {unconfigured ? "Demo text — add an API key for live briefings" : "Generated from today's gate log"}
            </p>
          </div>
        </div>
        <button
          onClick={generate}
          disabled={generating}
          className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-2 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${generating ? "animate-spin" : ""}`} />
          {generating ? "Writing…" : briefing ? "Regenerate" : "Generate"}
        </button>
      </div>
      <p className="text-sm text-surface-700 font-medium leading-relaxed whitespace-pre-line">
        {briefing ?? SAMPLE_BRIEFING}
      </p>
      {error && <p className="text-xs font-bold text-amber-600 mt-2">{error}</p>}
    </div>
  );
}

export function AiChat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [unconfigured, setUnconfigured] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, asking]);

  async function ask(q?: string) {
    const question = (q ?? input).trim();
    if (!question || asking) return;
    setInput("");
    setAsking(true);
    setMessages((m) => [...m, { role: "user", text: question }]);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 503) setUnconfigured(true);
        setMessages((m) => [...m, { role: "ai", text: json.error || "The AI could not answer." }]);
        return;
      }
      setMessages((m) => [...m, { role: "ai", text: json.answer }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "ai", text: "No connection to the server — the gate log on this page is still live." },
      ]);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="glass-card p-5 flex flex-col">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-9 h-9 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center">
          <Bot className="w-4 h-4 text-primary-600" />
        </div>
        <div>
          <p className="font-bold text-surface-900 text-sm">Ask the Gate Log</p>
          <p className="text-[11px] font-medium text-surface-400">
            {unconfigured ? "Demo mode — add an API key for live answers" : "Plain-English answers from today's data"}
          </p>
        </div>
      </div>

      <div className="max-h-56 overflow-y-auto space-y-2.5 my-3 pr-1">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {SAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => ask(q)}
                className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-surface-50 border border-surface-200 text-surface-600 hover:bg-surface-100 transition-colors cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "ai" && (
              <div className="w-6 h-6 rounded-lg bg-violet-50 border border-violet-100 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-violet-600" />
              </div>
            )}
            <p
              className={`max-w-[85%] text-xs font-medium leading-relaxed px-3 py-2 rounded-xl ${
                m.role === "user"
                  ? "bg-primary-600 text-white rounded-br-sm"
                  : "bg-surface-50 border border-surface-200 text-surface-800 rounded-bl-sm"
              }`}
            >
              {m.text}
            </p>
            {m.role === "user" && (
              <div className="w-6 h-6 rounded-lg bg-surface-100 border border-surface-200 flex items-center justify-center shrink-0 mt-0.5">
                <User className="w-3.5 h-3.5 text-surface-500" />
              </div>
            )}
          </div>
        ))}
        {asking && (
          <div className="flex gap-2 justify-start">
            <div className="w-6 h-6 rounded-lg bg-violet-50 border border-violet-100 flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 text-violet-600" />
            </div>
            <p className="text-xs font-bold text-surface-400 px-3 py-2 animate-pulse">Thinking…</p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
        className="flex gap-2 mt-auto"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about today's gate activity…"
          className="flex-1 px-3.5 py-2.5 bg-white border border-surface-200 rounded-xl text-sm text-surface-900 placeholder-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-colors"
        />
        <button
          type="submit"
          disabled={asking || !input.trim()}
          className="px-3.5 py-2.5 bg-primary-600 hover:bg-primary-500 disabled:opacity-40 text-white rounded-xl transition-colors cursor-pointer"
          aria-label="Send question"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
