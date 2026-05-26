import OpenAI from "openai";

export interface TranslateOptions {
  apiKey: string;
  model: string;
  targetLocale: string;
}

const MAX_KEYS_PER_REQUEST = 50;
const MAX_RETRIES = 3;

/**
 * Translate a map of {key: sourceText} into the target locale.
 * Keys are opaque identifiers and are preserved exactly so values can be merged
 * back into the locale file. Large maps are chunked across multiple requests.
 */
export async function translateBatch(
  entries: Record<string, string>,
  opts: TranslateOptions
): Promise<Record<string, string>> {
  const keys = Object.keys(entries);
  if (keys.length === 0) return {};

  const client = new OpenAI({ apiKey: opts.apiKey });
  const result: Record<string, string> = {};

  for (let i = 0; i < keys.length; i += MAX_KEYS_PER_REQUEST) {
    const chunk: Record<string, string> = {};
    for (const key of keys.slice(i, i + MAX_KEYS_PER_REQUEST)) {
      chunk[key] = entries[key];
    }
    Object.assign(result, await translateChunk(client, chunk, opts));
  }

  return result;
}

async function translateChunk(
  client: OpenAI,
  entries: Record<string, string>,
  opts: TranslateOptions
): Promise<Record<string, string>> {
  const system = [
    "You are a professional software localization engine.",
    `Translate the VALUES of the given JSON object into the locale code "${opts.targetLocale}".`,
    "Rules:",
    "- Return a JSON object with the EXACT same keys as the input.",
    "- Translate only the values, never the keys.",
    "- Preserve placeholders such as {name}, {{count}}, %s, :id, and HTML tags verbatim.",
    "- Preserve leading/trailing whitespace and punctuation style.",
    "- Do not add, remove, or reorder keys.",
  ].join("\n");

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: opts.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(entries) },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("Translation provider returned an empty response.");

      const parsed = JSON.parse(content) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const key of Object.keys(entries)) {
        if (typeof parsed[key] === "string") out[key] = parsed[key] as string;
      }
      return out;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await delay(500 * 2 ** (attempt - 1));
      }
    }
  }
  throw new Error(`Translation failed after ${MAX_RETRIES} attempts: ${(lastError as Error).message}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
