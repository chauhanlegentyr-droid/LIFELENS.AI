# LifeLens AI

**Snap a room. Find the hazards. See the fix.**

LifeLens AI analyzes photos of a physical space, finds safety, accessibility and movement problems, scores the space, and generates an image of the same room with the problems fixed.

> Built for **ImpactHack 2026**.

---

## Why we built it

On 24 May 2019, a fire in a Surat coaching centre killed 22 students. The classes were on the top floor and the only way down was a wooden staircase. When it burned, the students were trapped. In 2004, 94 children died in the Kumbakonam school fire.

Dangers like a single exit, a blocked path or a crowded room are visible before anything goes wrong, but most spaces are never reviewed with evacuation in mind. LifeLens lets anyone with a phone camera ask: *"If something went wrong here, could everyone get out?"*

## Features

- **Multi-photo analysis:** upload up to 8 photos of the same room and have them analyzed together.
- **Space score:** 0 to 100 overall, plus safety, accessibility, movement and organization scores.
- **Issue detection:** blocked exits, narrow paths, trip hazards, clutter and poor layout, each with a severity level.
- **Visual markers:** issues are pinned on the photo where the AI sees them.
- **Recommendations:** prioritized, practical fixes with the reason and expected impact.
- **Optimization preview:** one click generates the same room with the detected problems resolved.
- **Honest uncertainty:** the AI lists what it can't determine from the photos.
- **Demo room:** try the app without uploading anything.

## How it works

```
Photos → React frontend → Express API → Gemini vision model
                                              │
                          structured JSON (scores, issues, coordinates, fixes)
                                              │
                         validated and cleaned by the server
                                              │
          markers, scores and recommendations → "Create optimization plan"
                                              │
                          Gemini image model → fixed version of the room
```

1. The frontend sends the photos to `POST /api/analyze`.
2. The server prompts a Gemini vision model to report only what is visible and return strict JSON. The response is validated, and scores and coordinates are clamped to valid ranges.
3. The frontend shows scores, markers, issues and recommendations.
4. `POST /api/optimize` sends the photo and the issue list to a Gemini image model, which returns the improved room.
5. If a model hits its quota or fails, the server switches to the next model in the list automatically.

## Tech stack

| Area | Technology |
| --- | --- |
| Frontend | React, Vite, JavaScript, CSS, Lucide icons |
| Backend | Node.js, Express |
| AI | Google Gemini (vision analysis and image generation) via `@google/genai` |

## Getting started

### Prerequisites

- Node.js 18 or newer
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/)

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/YOUR-USERNAME/lifelens-ai.git
cd lifelens-ai

# 2. Install dependencies
npm install

# 3. Add your API key
cp server/.env.example server/.env
# then open server/.env and set GEMINI_API_KEY
```

On Windows Command Prompt, use `copy server\.env.example server\.env` instead of `cp`.

### Run

Use two terminals from the project root.

```bash
# Terminal 1: backend (http://localhost:3001)
node server/index.js

# Terminal 2: frontend (http://localhost:5173)
npm run dev
```

Open `http://localhost:5173`, click **Analyze Demo Room**, or upload your own photos.

### Environment variables

Set these in `server/.env`:

| Variable | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Your Gemini API key |
| `PORT` | No | Server port (default `3001`) |
| `FRONTEND_URL` | No | Allowed frontend origin (default `http://localhost:5173`) |
| `ANALYSIS_MODELS` | No | Comma-separated model names to try for analysis, in order |
| `IMAGE_MODELS` | No | Comma-separated model names to try for image generation, in order |

For the frontend, set `VITE_API_URL` if the backend isn't on `http://localhost:3001`.

> Never commit `server/.env`. It is listed in `.gitignore`.

## Project structure

```
lifelens-ai/
├── public/
│   └── demo-room.jpg        # demo image
├── server/
│   ├── index.js             # Express API and Gemini integration
│   └── .env.example         # example environment file
├── src/
│   ├── App.jsx              # main application
│   ├── main.jsx
│   └── index.css            # styles
└── package.json
```

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Server status and configured models |
| `POST` | `/api/analyze` | Analyze 1 to 8 images, returns scores, issues, recommendations |
| `POST` | `/api/optimize` | Generate the improved version of a room image |

## Limitations

- LifeLens is an AI-assisted aid based on photographs. It is **not** a certified safety inspection and does not replace a qualified fire-safety or accessibility audit.
- The AI judges only what is visible in the photos. Hidden exits, materials and measurements can't be assessed.
- The projected score after optimization is an estimate, not a new analysis of the generated image.
- Generated "after" images are illustrations and may not match every recommended change exactly.
- Free-tier Gemini quotas are small, so heavy use can reach the limits.

## Roadmap

- Re-analyze the generated image to measure the improved score.
- Compare findings against fire and accessibility standards, such as the National Building Code of India.
- Video walkthroughs and evacuation simulations ("What if 30 people leave at once?").
- Support for hospitals, offices, laboratories and public buildings.

## Screenshots

| Home | Analysis | Optimization |
| --- | --- | --- |
| ![Home](docs/home.png) | ![Analysis](docs/analysis.png) | ![Optimization](docs/optimization.png) |

## Team

- Your Name: role

## Acknowledgements

Built with the help of AI coding assistants. *In memory of the students who lost their lives because there was no safe way out.*
