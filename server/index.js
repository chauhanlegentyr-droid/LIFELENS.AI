import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config({ path: "./server/.env" });

/* ---------- config ---------- */

const PORT = Number(process.env.PORT || 3001);
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.error("ERROR: GEMINI_API_KEY was not found in server/.env");
  process.exit(1);
}

// Override with comma-separated env vars, e.g. ANALYSIS_MODELS=a,b,c
const listFromEnv = (name, fallback) =>
  process.env[name] ? process.env[name].split(",").map((m) => m.trim()).filter(Boolean) : fallback;

const ANALYSIS_MODELS = listFromEnv("ANALYSIS_MODELS", [
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.8-flash",
  "gemini-flash-latest",
]);

const IMAGE_MODELS = listFromEnv("IMAGE_MODELS", [
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-2.5-flash-image",
]);

const MAX_IMAGES = 8;
const MAX_IMAGE_BASE64_LENGTH = 12 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
const SEVERITIES = ["critical", "high", "medium", "low"];

const ai = new GoogleGenAI({ apiKey: API_KEY });
const app = express();

app.use(cors({ origin: [FRONTEND_URL, "http://localhost:5173", "http://localhost:4173"] }));
app.use(express.json({ limit: "30mb" }));

/* ---------- errors ---------- */

class HttpError extends Error {
  constructor(status, message, code, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errorStatus = (e) => e?.status || e?.code || e?.response?.status || null;

function errorMessage(e) {
  if (!e) return "Unknown Gemini error.";
  if (typeof e.message === "string") return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

const isTemporary = (e) => [500, 502, 503, 504].includes(errorStatus(e));
const isModelUnavailable = (e) => [400, 404].includes(errorStatus(e));

function isQuotaError(e) {
  const msg = errorMessage(e).toLowerCase();
  return (
    errorStatus(e) === 429 ||
    ["resource_exhausted", "quota exceeded", "current quota", "free_tier"].some((s) => msg.includes(s))
  );
}

/* ---------- Gemini helpers ---------- */

function withTimeout(promise, ms = REQUEST_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Gemini request timed out. Please try again.")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function generateWithRetry(model, request, attempts = 2) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTimeout(ai.models.generateContent({ model, ...request }));
    } catch (error) {
      console.error(`${model} failed (${attempt}/${attempts}):`, errorMessage(error));
      if (isQuotaError(error) || isModelUnavailable(error) || !isTemporary(error) || attempt >= attempts) {
        throw error;
      }
      await sleep(attempt * 2500);
    }
  }
}

// Models that just hit their quota are skipped for a while so we don't waste calls on them.
const QUOTA_COOLDOWN_MS = 2 * 60 * 1000;
const exhaustedUntil = new Map();

const isCoolingDown = (model) => (exhaustedUntil.get(model) || 0) > Date.now();

/**
 * Tries each model in order. Quota-exhausted, missing and failing models are skipped
 * and the next one is tried. Only fails when every model has been tried without success.
 */
async function runWithFallback(models, request, attempts, quotaError, unavailableError) {
  let quotaHits = 0;
  let lastQuotaStatus = null;

  // Models not on cooldown go first; cooled-down ones are retried last as a final resort.
  const ordered = [
    ...models.filter((m) => !isCoolingDown(m)),
    ...models.filter((m) => isCoolingDown(m)),
  ];

  for (const model of ordered) {
    try {
      console.log(`Trying model: ${model}`);
      const response = await generateWithRetry(model, request, attempts);
      exhaustedUntil.delete(model);
      return { response, model };
    } catch (error) {
      if (isQuotaError(error)) {
        quotaHits++;
        lastQuotaStatus = errorStatus(error);
        exhaustedUntil.set(model, Date.now() + QUOTA_COOLDOWN_MS);
        console.warn(`${model} quota exhausted, switching to the next model...`);
      } else {
        console.warn(`${model} unavailable (${errorMessage(error)}), switching to the next model...`);
      }
    }
  }

  // Every model failed. If they all ran out of quota, say so; otherwise it's an outage.
  if (quotaHits === ordered.length) {
    throw new HttpError(429, quotaError.message, quotaError.code, { status: lastQuotaStatus });
  }
  throw new HttpError(503, unavailableError.message, unavailableError.code);
}

function extractJson(text) {
  if (!text) throw new Error("Gemini returned an empty response.");

  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last > first) cleaned = cleaned.slice(first, last + 1);

  return JSON.parse(cleaned);
}

/* ---------- validation ---------- */

const clamp = (value, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : 0;
};

const clean = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const asSeverity = (value) => (SEVERITIES.includes(value) ? value : "medium");

function validateAnalysis(raw, imageCount) {
  if (!raw || typeof raw !== "object") throw new Error("Invalid AI analysis.");

  const scores = {};
  for (const key of ["safety", "accessibility", "movement", "organization"]) {
    scores[key] = clamp(raw.scores?.[key], 0, 100);
  }

  const average = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / 4);
  const list = (value) => (Array.isArray(value) ? value : []);

  return {
    spaceType: clean(raw.spaceType, "Physical space"),
    summary: clean(raw.summary, "LifeLens analyzed the supplied space using visible evidence."),
    scores,
    overallScore: typeof raw.overallScore === "number" ? clamp(raw.overallScore, 0, 100) : average,

    objects: list(raw.objects).map((o) => ({
      name: clean(o.name, "Object"),
      description: clean(o.description),
    })),

    issues: list(raw.issues).map((issue, i) => {
      const hasPoint = Number.isFinite(Number(issue.x)) && Number.isFinite(Number(issue.y)) &&
        issue.x !== null && issue.y !== null;
      return {
        number: i + 1,
        title: clean(issue.title, `Issue ${i + 1}`),
        severity: asSeverity(issue.severity),
        description: clean(issue.description),
        reason: clean(issue.reason),
        // Normalised 0–100 position on the image; omitted if the model could not locate it
        ...(hasPoint && {
          x: clamp(issue.x, 0, 100),
          y: clamp(issue.y, 0, 100),
          imageIndex: clamp(issue.imageIndex, 0, imageCount - 1),
        }),
      };
    }),

    recommendations: list(raw.recommendations).map((r) => ({
      title: clean(r.title, "Recommended improvement"),
      priority: asSeverity(r.priority),
      action: clean(r.action),
      reason: clean(r.reason),
      expectedImpact: clean(r.expectedImpact),
    })),

    uncertainties: list(raw.uncertainties).filter((u) => typeof u === "string" && u.trim()),
  };
}

function validateImage(image, index = 0) {
  const label = `Image ${index + 1}`;
  if (!image || typeof image !== "object") throw new HttpError(400, `${label} is invalid.`, "INVALID_IMAGE");
  if (!image.data) throw new HttpError(400, `${label} has no image data.`, "INVALID_IMAGE");
  if (!image.mimeType?.startsWith("image/")) throw new HttpError(400, `${label} is not a valid image.`, "INVALID_IMAGE");
  if (image.data.length > MAX_IMAGE_BASE64_LENGTH) {
    throw new HttpError(400, `${label} is too large. Please use an image under about 9 MB.`, "IMAGE_TOO_LARGE");
  }
}

const toPart = (image) => ({ inlineData: { mimeType: image.mimeType, data: image.data } });

/* ---------- prompts ---------- */

const ANALYSIS_PROMPT = `
You are LifeLens, an AI spatial intelligence system analyzing photographs of a real physical environment.
Inspect the supplied image(s) genuinely. Do not give a generic room analysis.

Look at: furniture, key objects, visible entrances/exits, walking paths, circulation, blocked or narrow
pathways, clutter, furniture placement, accessibility barriers, visible safety hazards, organization
problems, inefficient use of space, and opportunities for improvement.

Rules:
1. Report only what is supported by visual evidence. Never invent objects, doors, exits or measurements.
2. Multiple images may show the same space. Combine evidence and do not duplicate problems.
3. Recommendations must be practical, realistic and prioritized by impact.
4. Explain WHY each issue matters.
5. Put anything that cannot be determined into "uncertainties".
6. Keep the summary concise.
7. For every issue, give "imageIndex" (0-based index of the image where it is best visible) and "x","y":
   the approximate centre of the problem as a percentage (0-100) of that image's width and height
   (x from the left edge, y from the top edge). Use null for x and y if you cannot locate it.
8. Score safety, accessibility, movement and organization from 0 to 100 (higher is better).
9. Return valid JSON only.

Return ONLY this JSON shape:
{
  "spaceType": "string",
  "overallScore": 0,
  "scores": { "safety": 0, "accessibility": 0, "movement": 0, "organization": 0 },
  "summary": "short evidence-based explanation",
  "objects": [{ "name": "string", "description": "what is visibly present" }],
  "issues": [{
    "title": "specific visible problem",
    "severity": "critical | high | medium | low",
    "description": "what is visibly wrong",
    "reason": "why it matters",
    "imageIndex": 0,
    "x": 0,
    "y": 0
  }],
  "recommendations": [{
    "title": "specific improvement",
    "priority": "critical | high | medium | low",
    "action": "what should be changed",
    "reason": "why this improves the space",
    "expectedImpact": "expected practical benefit"
  }],
  "uncertainties": ["things that cannot reliably be determined from the image"]
}
`;

const optimizationPrompt = (analysis) => {
  const issues = (analysis.issues || [])
    .map((i, n) => `${n + 1}. [${i.severity}] ${i.title}: ${i.description}`)
    .join("\n");
  const fixes = (analysis.recommendations || [])
    .map((r, n) => `${n + 1}. ${r.title}: ${r.action}`)
    .join("\n");

  return `
You are LifeLens. You are given a photograph of a real space and a list of problems found in it.

Generate a NEW photorealistic image of the SAME space as it would look if EVERY problem below were
fixed. It must read as a believable "after" photo of this exact room.

PROBLEMS TO RESOLVE (fix all of them, each must be visibly resolved in the result):
${issues || "None listed. Keep the space as it is."}

HOW TO FIX THEM:
${fixes || "Use sensible, practical fixes."}

KEEP EXACTLY THE SAME: the room, walls, floor, windows, doors, major architecture, camera angle,
lighting, and the style and appearance of the existing furniture and objects.

CHANGE ONLY what is needed to resolve the problems: move, remove, tidy or rearrange items so that
pathways are clear, exits are unblocked, hazards are gone and the layout works better for everyone.

DO NOT invent new doors, windows or architectural features, redesign the room, add luxury or
unrealistic furniture, or turn it into a different place. Do not add text or labels to the image.

Generate only the fixed version of the supplied image.
`;
};

/* ---------- routes ---------- */

const route = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message, code: error.code, ...error.extra });
    }
    console.error("Unhandled route error:", error);
    return res.status(500).json({ error: errorMessage(error), code: "SERVER_ERROR" });
  }
};

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "LifeLens AI",
    timestamp: new Date().toISOString(),
    analysisModels: ANALYSIS_MODELS,
    imageModels: IMAGE_MODELS,
  });
});

app.post("/api/analyze", route(async (req, res) => {
  const { images } = req.body;

  if (!Array.isArray(images) || images.length === 0) {
    throw new HttpError(400, "No images were provided.", "NO_IMAGES");
  }
  if (images.length > MAX_IMAGES) {
    throw new HttpError(400, `You can analyze up to ${MAX_IMAGES} images at once.`, "TOO_MANY_IMAGES");
  }
  images.forEach(validateImage);

  console.log(`Analyzing ${images.length} image(s)...`);

  const { response, model } = await runWithFallback(
    ANALYSIS_MODELS,
    {
      contents: [{ role: "user", parts: [...images.map(toPart), { text: ANALYSIS_PROMPT }] }],
      config: { responseMimeType: "application/json" },
    },
    2,
    {
      message: "Gemini analysis quota has been reached. Check your Gemini API plan or quota settings.",
      code: "GEMINI_QUOTA_EXCEEDED",
    },
    {
      message: "Gemini is temporarily unavailable. LifeLens tried multiple models. Please try again.",
      code: "GEMINI_ANALYSIS_UNAVAILABLE",
    }
  );

  let parsed;
  try {
    parsed = extractJson(response.text);
  } catch {
    console.error("Invalid Gemini JSON:", response.text);
    throw new HttpError(500, "Gemini returned an unexpected analysis format.", "INVALID_GEMINI_JSON");
  }

  const analysis = {
    ...validateAnalysis(parsed, images.length),
    analysisModel: model,
    analyzedAt: new Date().toISOString(),
    imageCount: images.length,
  };

  console.log(`Found ${analysis.issues.length} issue(s).`);
  res.json(analysis);
}));

app.post("/api/optimize", route(async (req, res) => {
  const { image, analysis } = req.body;

  if (!image?.data || !image?.mimeType) {
    throw new HttpError(400, "No source image was provided.", "NO_SOURCE_IMAGE");
  }
  validateImage(image, 0);
  if (!analysis) throw new HttpError(400, "No AI analysis was provided.", "NO_ANALYSIS");

  console.log("Generating optimized space...");

  const { response, model } = await runWithFallback(
    IMAGE_MODELS,
    {
      contents: [{ role: "user", parts: [toPart(image), { text: optimizationPrompt(analysis) }] }],
      config: { responseModalities: ["TEXT", "IMAGE"] },
    },
    1,
    {
      message: "Image generation quota has been reached. Check your Gemini plan or wait for it to reset.",
      code: "GEMINI_IMAGE_QUOTA_EXCEEDED",
    },
    {
      message: "AI image generation is temporarily unavailable. Please try again later.",
      code: "GEMINI_IMAGE_UNAVAILABLE",
    }
  );

  let generatedImage = null;
  let text = "";

  for (const part of response?.candidates?.[0]?.content?.parts || []) {
    if (part.text) text += part.text;
    if (part.inlineData?.data) {
      generatedImage = { data: part.inlineData.data, mimeType: part.inlineData.mimeType || "image/png" };
    }
  }

  if (!generatedImage) {
    throw new HttpError(500, "Gemini did not return an optimized image.", "NO_GENERATED_IMAGE", { model, text });
  }

  res.json({
    success: true,
    model,
    image: generatedImage,
    description: text || "AI-generated optimized version of the space.",
    generatedAt: new Date().toISOString(),
  });
}));

/* ---------- fallbacks ---------- */

app.use("/api", (req, res) => {
  res.status(404).json({ error: "LifeLens API endpoint not found.", path: req.originalUrl });
});

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error);
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request is too large. Please use smaller images.", code: "REQUEST_TOO_LARGE" });
  }
  res.status(500).json({ error: "Unexpected LifeLens server error.", code: "SERVER_ERROR" });
});

app.listen(PORT, () => {
  console.log(`LifeLens AI server running on http://localhost:${PORT}`);
  console.log(`Frontend origin: ${FRONTEND_URL}`);
  console.log(`Analysis models: ${ANALYSIS_MODELS.join(", ")}`);
  console.log(`Image models: ${IMAGE_MODELS.join(", ")}`);
});