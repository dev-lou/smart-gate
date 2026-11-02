// Server-only Gemini helper — never import from a client component.
// The API key lives in GEMINI_API_KEY (server env) and never reaches
// the browser. Uses the plain REST endpoint so no extra SDK is needed.

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

export function isAiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export async function generateText(prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("AI_NOT_CONFIGURED");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 600 },
      }),
    },
  );

  if (res.status === 429) throw new Error("AI_BUSY");
  if (!res.ok) throw new Error(`AI_ERROR_${res.status}`);

  const json = await res.json();
  const text: string | undefined =
    json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
  if (!text) throw new Error("AI_EMPTY");
  return text.trim();
}
