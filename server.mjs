/**
 * InterSearch - smart fallback search + "I" AI assistant
 * Node 18+ recommended
 */

import express from "express";
import fetch from "node-fetch";
import LRU from "lru-cache";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";
const GOOGLE_CX = process.env.GOOGLE_CX || "";

const cache = new LRU({ max: 500, ttl: 1000 * 60 * 5 });

function cleanText(t) {
  return (t || "").toString().trim();
}

async function primarySearch(q) {
  // Replace with your local DB/vector search later
  return [];
}

async function googleSearch(q) {
  if (!GOOGLE_API_KEY || !GOOGLE_CX)
    throw new Error("Google API key or CX not configured.");

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", GOOGLE_API_KEY);
  url.searchParams.set("cx", GOOGLE_CX);
  url.searchParams.set("q", q);
  url.searchParams.set("num", "5");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google API error ${res.status}`);
  const data = await res.json();
  return (data.items || []).map((it) => ({
    title: it.title,
    snippet: it.snippet,
    link: it.link,
    source: "google",
  }));
}

async function openaiChatAnswer(q, context = []) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set.");

  const messages = [
    {
      role: "system",
      content:
        'You are "I", an assistant that gives clear, factual answers using provided context when possible.',
    },
    ...context.map((c) => ({
      role: "system",
      content: `Context: ${c.title}\n${c.snippet}\n${c.link}`,
    })),
    { role: "user", content: q },
  ];

  const body = JSON.stringify({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.3,
    max_tokens: 800,
  });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${txt}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return { text: cleanText(text), raw: data };
}

/* ---------- /search endpoint ---------- */
app.get("/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "Missing ?q=" });

    if (cache.has(q)) return res.json({ ...cache.get(q), cached: true });

    const primary = await primarySearch(q);
    if (primary.length) {
      const result = { source: "primary", results: primary };
      cache.set(q, result);
      return res.json(result);
    }

    let googleResults = [];
    try {
      googleResults = await googleSearch(q);
      if (googleResults.length) {
        const result = { source: "google", results: googleResults };
        cache.set(q, result);
        return res.json(result);
      }
    } catch (err) {
      console.warn("Google search failed:", err.message);
    }

    const ai = await openaiChatAnswer(q, googleResults);
    const result = { source: "openai", answer: ai.text };
    cache.set(q, result);
    res.json(result);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ---------- /ai endpoint ---------- */
app.post("/ai", async (req, res) => {
  try {
    const prompt = cleanText(req.body?.prompt);
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    const messages = [
      {
        role: "system",
        content:
          'You are "I", an intelligent assistant similar to ChatGPT. Be accurate, clear, and safe.',
      },
      { role: "user", content: prompt },
    ];

    const body = JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.3,
      max_tokens: 1000,
    });

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body,
    });

    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`OpenAI error ${r.status}: ${txt}`);
    }

    const data = await r.json();
    const reply = cleanText(data?.choices?.[0]?.message?.content ?? "");
    res.json({ assistant: "I", reply });
  } catch (err) {
    console.error("/ai error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok", ts: Date.now() }));

app.listen(PORT, () => {
  console.log(`✅ InterSearch running on http://localhost:${PORT}`);
});