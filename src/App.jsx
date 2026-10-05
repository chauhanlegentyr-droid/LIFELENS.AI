import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ScanSearch, Sparkles, AlertTriangle, CheckCircle2, ArrowRight, RotateCcw,
  Upload, X, Image as ImageIcon, Lightbulb, ShieldCheck, Accessibility, Move,
  Boxes, ChevronLeft, ChevronRight, RefreshCw, Loader2,
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
const DEMO_IMAGE = "/demo-room.jpg";
const MAX_IMAGES = 8;
const MAX_FILE_SIZE_MB = 12;
const OPTIMIZED_SCORE_BOOST = 15;

/* ---------- helpers ---------- */

function blobToPayload(blob, name) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () =>
      resolve({
        data: String(reader.result).split(",")[1],
        mimeType: blob.type || "image/jpeg",
        name,
      });
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function demoPayload() {
  const response = await fetch(DEMO_IMAGE);
  if (!response.ok) throw new Error("Could not load the demo image.");
  return blobToPayload(await response.blob(), "demo-room.jpg");
}

async function postJson(path, body, fallbackError) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an invalid response.");
  }
  if (!response.ok) throw new Error(data.error || fallbackError);
  return data;
}

const scoreColor = (score) =>
  score >= 80 ? "var(--good)" : score >= 60 ? "var(--medium)" : "var(--high)";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ---------- small components ---------- */

function Metric({ icon, label, value }) {
  return (
    <div className="card metric">
      <div className="metric-label">{icon}{label}</div>
      <div className="metric-value" style={{ color: scoreColor(value) }}>
        {value}<small>/100</small>
      </div>
    </div>
  );
}

function SectionHead({ title, count }) {
  return (
    <div className="section-head">
      <h3>{title}</h3>
      <span>{count}</span>
    </div>
  );
}

function ErrorAlert({ message }) {
  return message ? <div role="alert" className="alert">{message}</div> : null;
}

/* ---------- app ---------- */

export default function App() {
  const [stage, setStage] = useState("home");
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState("");

  const [uploads, setUploads] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const [optimizing, setOptimizing] = useState(false);
  const [optimizedImage, setOptimizedImage] = useState(null);
  const [progress, setProgress] = useState(12);

  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;

  // Release object URLs on unmount (ref avoids a stale closure)
  useEffect(
    () => () => uploadsRef.current.forEach((i) => URL.revokeObjectURL(i.preview)),
    []
  );

  // Fake-but-gentle progress while the real request runs
  useEffect(() => {
    if (stage !== "scanning") return undefined;
    setProgress(12);
    const id = window.setInterval(
      () => setProgress((p) => (p >= 92 ? p : Math.min(p + 2 + Math.floor(Math.random() * 7), 92))),
      700
    );
    return () => window.clearInterval(id);
  }, [stage]);

  const images = useMemo(
    () => (uploads.length ? uploads : [{ id: "demo", preview: DEMO_IMAGE, file: null }]),
    [uploads]
  );
  const safeIndex = Math.min(activeIndex, images.length - 1);
  const activeImage = images[safeIndex];
  const optimized = Boolean(optimizedImage);

  /* ----- uploads ----- */

  const handleUpload = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;

    const slots = MAX_IMAGES - uploads.length;
    if (slots <= 0) return setError(`You can upload up to ${MAX_IMAGES} images per analysis.`);

    const picked = files.slice(0, slots);
    if (picked.some((f) => !f.type.startsWith("image/"))) return setError("Please select image files only.");
    if (picked.some((f) => f.size > MAX_FILE_SIZE_MB * 1024 * 1024))
      return setError(`Each image must be smaller than ${MAX_FILE_SIZE_MB} MB.`);

    setUploads((prev) => [
      ...prev,
      ...picked.map((file) => ({
        id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        file,
        preview: URL.createObjectURL(file),
      })),
    ]);
    setActiveIndex(0);
    setError("");
  };

  const removeImage = (id) => {
    setUploads((prev) => {
      prev.filter((i) => i.id === id).forEach((i) => URL.revokeObjectURL(i.preview));
      return prev.filter((i) => i.id !== id);
    });
    setActiveIndex(0);
  };

  const clearUploads = () => {
    uploads.forEach((i) => URL.revokeObjectURL(i.preview));
    setUploads([]);
    setActiveIndex(0);
    setError("");
  };

  /* ----- API ----- */

  const startAnalysis = async () => {
    setStage("scanning");
    setError("");
    setOptimizedImage(null);
    setActiveIndex(0);

    try {
      const payload = uploads.length
        ? await Promise.all(uploads.map((i) => blobToPayload(i.file, i.file.name)))
        : [await demoPayload()];

      const data = await postJson("/api/analyze", { images: payload }, "AI analysis failed.");
      setAnalysis(data);
      setProgress(100);
      window.setTimeout(() => setStage("results"), 350);
    } catch (err) {
      console.error(err);
      setError(err.message || "Something went wrong while analyzing the space.");
      setStage("home");
    }
  };

  const optimizeSpace = async () => {
    if (!analysis) return setError("No analysis is available to optimize.");

    setError("");
    setOptimizing(true);
    setOptimizedImage(null);

    try {
      // Use the photo currently on screen so the "after" matches what the person is looking at
      const source = activeImage.file
        ? await blobToPayload(activeImage.file, activeImage.file.name)
        : await demoPayload();

      const data = await postJson("/api/optimize", { image: source, analysis }, "AI optimization failed.");
      if (!data.image?.data) throw new Error("No optimized image was returned.");

      setOptimizedImage({
        url: `data:${data.image.mimeType || "image/png"};base64,${data.image.data}`,
        model: data.model,
        description: data.description,
      });
    } catch (err) {
      console.error(err);
      setError(err.message || "Something went wrong while generating the optimized space.");
    } finally {
      setOptimizing(false);
    }
  };

  const reset = () => {
    setStage("home");
    setAnalysis(null);
    setOptimizedImage(null);
    setOptimizing(false);
    setError("");
    setActiveIndex(0);
  };

  const stepImage = useCallback(
    (dir) => setActiveIndex((i) => (i + dir + images.length) % images.length),
    [images.length]
  );

  const baseScore = analysis?.overallScore || 0;
  const score = optimized ? Math.min(100, baseScore + OPTIMIZED_SCORE_BOOST) : baseScore;

  // Only issues the model located on the current photo get a marker
  const markers = (analysis?.issues || [])
    .map((issue, index) => ({ issue, index }))
    .filter(({ issue }) => Number.isFinite(issue.x) && Number.isFinite(issue.y) && (issue.imageIndex ?? 0) === safeIndex);

  /* ---------- render ---------- */

  return (
    <div className="app">
      <header className="navbar">
        <div className="brand">
          <div className="brand-icon"><Sparkles size={18} /></div>
          LifeLens <small>AI</small>
        </div>
        <div className="nav-status"><span className="status-dot" />Space analysis ready</div>
      </header>

      <main>
        {stage === "home" && (
          <section className="hero">
            <div className="hero-copy">
              <div className="eyebrow"><Sparkles size={15} />See your space differently</div>
              <h1>Make every space work better for the people in it.</h1>
              <p>
                Upload photos of a room. LifeLens finds safety, accessibility, and movement
                problems, then shows you the changes that matter most.
              </p>

              <div className="hero-actions">
                <div className="card upload-card">
                  <div className="upload-head">
                    <ImageIcon size={18} />
                    <h3>Analyze your own space</h3>
                  </div>
                  <p>Add up to {MAX_IMAGES} photos of the same room for a more complete analysis.</p>

                  <div className="upload-actions">
                    <label htmlFor="room-upload" className="btn btn-secondary">
                      <Upload size={16} />Choose images
                    </label>
                    <input id="room-upload" type="file" accept="image/*" multiple hidden onChange={handleUpload} />
                    {uploads.length > 0 && (
                      <button type="button" className="btn btn-ghost" onClick={clearUploads}>
                        <X size={16} />Clear all
                      </button>
                    )}
                  </div>

                  {uploads.length > 0 && (
                    <>
                      <div className="upload-meta">
                        <span>{plural(uploads.length, "image")} selected</span>
                        <strong>Ready</strong>
                      </div>
                      <div className="thumbs">
                        {uploads.map((image, i) => (
                          <div className="thumb" key={image.id}>
                            <img src={image.preview} alt={`Uploaded view ${i + 1}`} />
                            <span className="thumb-index">{i + 1}</span>
                            <button
                              type="button"
                              className="thumb-remove"
                              aria-label={`Remove image ${i + 1}`}
                              onClick={() => removeImage(image.id)}
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <button className="btn btn-primary btn-block" onClick={startAnalysis}>
                  <ScanSearch size={19} />
                  {uploads.length ? "Analyze uploaded space" : "Analyze demo room"}
                  <ArrowRight size={17} />
                </button>

                <div className="hero-note">
                  <CheckCircle2 size={15} />
                  {uploads.length
                    ? "All selected photos are analyzed together."
                    : "No photos handy? Try the demo room."}
                </div>

                <ErrorAlert message={error} />
              </div>
            </div>

            <div className="preview">
              <img src={uploads[0]?.preview || DEMO_IMAGE} alt="Space preview" />
              <div className="preview-label">
                <ScanSearch size={15} />
                {uploads.length ? plural(uploads.length, "photo") + " ready" : "Demo room"}
              </div>
            </div>
          </section>
        )}

        {stage === "scanning" && (
          <section className="scan-screen">
            <div className="card scan-card">
              <div className="scan-visual">
                <img src={activeImage.preview} alt="Space being analyzed" />
                <div className="scan-line" />
              </div>
              <div className="scan-body">
                <div className="btn-icon"><Sparkles size={22} /></div>
                <h2>Analyzing your space</h2>
                <p>
                  Checking layout, walkways, accessibility, organization, and visible hazards
                  across {uploads.length ? plural(uploads.length, "photo") : "the demo room"}.
                </p>
                <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                  <div style={{ width: `${progress}%` }} />
                </div>
                <span className="scan-caption">{progress}% complete</span>
              </div>
            </div>
          </section>
        )}

        {stage === "results" && analysis && (
          <section className="results">
            <div className="results-head">
              <div>
                <div className="eyebrow" style={{ marginBottom: 0 }}><Sparkles size={15} />Space analysis</div>
                <h2>{optimized ? "Your optimization plan" : "Here's what LifeLens found"}</h2>
                <p>
                  {optimized
                    ? "These are the highest-impact changes for improving this space."
                    : analysis.summary}
                </p>
                {analysis.spaceType && (
                  <span className="chip"><Boxes size={14} />{analysis.spaceType}</span>
                )}
              </div>
              <button className="btn btn-ghost" onClick={reset}>
                <RotateCcw size={16} />New analysis
              </button>
            </div>

            {!optimized && (
              <div className="metrics">
                <Metric icon={<ShieldCheck size={15} />} label="Safety" value={analysis.scores?.safety || 0} />
                <Metric icon={<Accessibility size={15} />} label="Accessibility" value={analysis.scores?.accessibility || 0} />
                <Metric icon={<Move size={15} />} label="Movement" value={analysis.scores?.movement || 0} />
                <Metric icon={<Boxes size={15} />} label="Organization" value={analysis.scores?.organization || 0} />
              </div>
            )}

            {optimized && (
              <div className="card optimized-card">
                <div className="optimized-head">
                  <div>
                    <strong><Sparkles size={15} />AI-generated optimization</strong>
                    <span>A visualization based on your space analysis.</span>
                  </div>
                  <CheckCircle2 size={22} color="var(--good)" />
                </div>
                <img src={optimizedImage.url} alt="AI-optimized version of the analyzed space" />
                {optimizedImage.description && <p>{optimizedImage.description}</p>}
              </div>
            )}

            <div className="results-grid">
              <div className="viewer-col">
                <div className="viewer">
                  <img src={activeImage.preview} alt={`Analyzed space, view ${safeIndex + 1}`} />

                  {!optimized &&
                    markers.map(({ issue, index }) => (
                      <div
                        key={`${issue.title}-${index}`}
                        className={`marker ${issue.severity || "medium"}`}
                        style={{ left: `${issue.x}%`, top: `${issue.y}%` }}
                        title={`${index + 1}. ${issue.title}`}
                      >
                        {index + 1}
                      </div>
                    ))}

                  {optimized && (
                    <div className="viewer-badge"><CheckCircle2 size={15} />Optimization plan</div>
                  )}

                  {images.length > 1 && (
                    <>
                      <button type="button" className="viewer-nav prev" aria-label="Previous image" onClick={() => stepImage(-1)}>
                        <ChevronLeft size={20} />
                      </button>
                      <button type="button" className="viewer-nav next" aria-label="Next image" onClick={() => stepImage(1)}>
                        <ChevronRight size={20} />
                      </button>
                      <div className="viewer-count">{safeIndex + 1} / {images.length}</div>
                    </>
                  )}
                </div>

                {images.length > 1 && (
                  <div className="strip">
                    {images.map((image, i) => (
                      <button
                        type="button"
                        key={image.id}
                        className={i === safeIndex ? "active" : ""}
                        onClick={() => setActiveIndex(i)}
                        aria-label={`Show view ${i + 1}`}
                      >
                        <img src={image.preview} alt="" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="side-col">
                <div className="card score-card">
                  <div className="score-label">{optimized ? "Projected space score" : "Space score"}</div>
                  <div className="score" style={{ color: scoreColor(score) }}>
                    {score}<span>/100</span>
                  </div>
                  <div className="score-bar"><div style={{ width: `${score}%` }} /></div>
                  <p>
                    {optimized
                      ? "Projected after applying the highest-impact recommendations."
                      : "Estimated from what is visible in your photos."}
                  </p>
                </div>

                {!optimized && (
                  <>
                    <div className="section">
                      <SectionHead title="Detected issues" count={analysis.issues?.length || 0} />
                      <div className="item-list">
                        {analysis.issues?.map((issue, index) => (
                          <div className="card item" key={`${issue.title}-${index}`}>
                            <div className={`item-icon ${issue.severity || "medium"}`}><AlertTriangle size={17} /></div>
                            <div className="item-body">
                              <div className="item-title">
                                <h4>{index + 1}. {issue.title}</h4>
                                <span className={`severity ${issue.severity || "medium"}`}>{issue.severity}</span>
                              </div>
                              <p>{issue.description}</p>
                              {issue.reason && (
                                <div className="item-note"><Sparkles size={13} />{issue.reason}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      {analysis.issues?.length === 0 && (
                        <div className="card success-card">
                          <CheckCircle2 size={22} />
                          <div>
                            <strong>No major issues detected</strong>
                            <p>LifeLens did not find significant problems in the supplied photos.</p>
                          </div>
                        </div>
                      )}
                    </div>

                    <button className="btn btn-primary btn-block" onClick={optimizeSpace} disabled={optimizing}>
                      {optimizing ? (
                        <><Loader2 size={18} className="spin" />Generating optimization…</>
                      ) : (
                        <><Sparkles size={18} />Create optimization plan<ArrowRight size={17} /></>
                      )}
                    </button>
                    <ErrorAlert message={error} />
                  </>
                )}

                {optimized && (
                  <div className="card success-card">
                    <CheckCircle2 size={22} />
                    <div>
                      <strong>Optimization plan created</strong>
                      <p>
                        The findings are now a practical improvement plan, with an AI
                        visualization of the improved space.
                      </p>
                      {optimizedImage.model && <p>Generated with {optimizedImage.model}</p>}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {analysis.recommendations?.length > 0 && (
              <div className="section">
                <SectionHead
                  title={optimized ? "Changes LifeLens recommends" : "Recommendations"}
                  count={analysis.recommendations.length}
                />
                <div className="item-list">
                  {analysis.recommendations.map((rec, index) => (
                    <div className="card item" key={`${rec.title}-${index}`}>
                      <div className="item-icon">
                        {optimized ? <CheckCircle2 size={17} /> : <Lightbulb size={17} />}
                      </div>
                      <div className="item-body">
                        <div className="item-title">
                          <h4>{rec.title}</h4>
                          {!optimized && <span className={`severity ${rec.priority || "medium"}`}>{rec.priority}</span>}
                        </div>
                        <p>{rec.action}</p>
                        {rec.reason && !optimized && <div className="item-note"><Sparkles size={13} />{rec.reason}</div>}
                        {rec.expectedImpact && (
                          <div className="item-note"><ArrowRight size={13} />Expected impact: {rec.expectedImpact}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {analysis.objects?.length > 0 && (
              <div className="section">
                <SectionHead title="Objects detected" count={analysis.objects.length} />
                <div className="item-list">
                  {analysis.objects.map((obj, index) => (
                    <div className="card item" key={`${obj.name}-${index}`}>
                      <div className="item-icon"><Boxes size={17} /></div>
                      <div className="item-body">
                        <h4>{obj.name}</h4>
                        <p>{obj.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {analysis.uncertainties?.length > 0 && (
              <div className="card notes">
                <strong>What the AI couldn't determine</strong>
                <ul>{analysis.uncertainties.map((u, i) => <li key={i}>{u}</li>)}</ul>
              </div>
            )}

            <div className="footnote">
              <RefreshCw size={12} />
              Results are based only on what is visible in the supplied photos.
            </div>
          </section>
        )}
      </main>
    </div>
  );
}