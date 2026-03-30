/* ============================================================
   VIDEO DETECTOR V1.0 — AI Probability Analyzer
   
   Philosophy: never claim "it's AI" or "it's real".
   Always return a probability (0-100) + confidence level
   (low / medium / high) + nuanced verdict.
   
   4-layer pipeline:
     1. Pixel inter-frame noise coherence     (weight 0.25)
     2. Local temporal consistency (2-3s)     (weight 0.20)
     3. Audio forensics (voice only)          (weight 0.20)
     4. LLaVA + LLaMA vision pipeline         (weight 0.35)
   
   Probabilistic output:
   {
     ai_probability : 0-100,
     confidence     : "low" | "medium" | "high",
     verdict        : "uncertain" | "likely authentic" | "likely AI-generated",
     scores         : { pixel, temporal, audio, llava },
     evidence       : ["frame 1: ...", "audio: ...", ...]
   }
   ============================================================ */

'use strict';

function waitAndInit() {
    if (window.__videoDetectorInit) { console.warn('[VideoDetector] already initialised'); return; }
    window.__videoDetectorInit = true;
    initVideoDetector();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitAndInit);
} else { waitAndInit(); }

function initVideoDetector() {

// ─── Config ───────────────────────────────────────────────────
const VD_CONFIG = {
    maxDurationSeconds : 120,
    maxFileSizeMB      : 200,
    frameCount         : 8,
    temporalFrameCount : 8,
    temporalWindowSec  : 3.0,
    llavaFrameCount    : 3,
    frameJpegQuality   : 0.82,
    llavaJpegQuality   : 0.80,
    llavaMaxSizeKB     : 700,
    workerModel        : 'llava+llama',
    cloudflareWorkerUrl: typeof CLOUDFLARE_CONFIG !== 'undefined' ? CLOUDFLARE_CONFIG.workerUrl : null,
    weights : { pixel: 0.25, temporal: 0.20, audio: 0.20, llava: 0.35 },
    confidence : { lowMax: 54, mediumMax: 75 },
    verdict    : { authenticMax: 40, uncertainMax: 62 },
};

const VDC = {
    neon:'#00F5A0', amber:'#FFB547', red:'#FF4D6D', green:'#39D98A',
    blue:'#00C9FF', purple:'#B44FE8', ink:'#080C10', panel:'#111720',
    panel2:'#18202C', ink3:'#141B24', line:'rgba(255,255,255,0.06)',
    line2:'rgba(255,255,255,0.10)', txt1:'#F0F4F8', txt2:'#8896A8', txt3:'#4D5E72',
};

let vdCurrentFile = null, vdIsAnalysing = false, vdBrain = null;

// ─── Styles ───────────────────────────────────────────────────
(function injectStyles() {
    if (document.getElementById('vd-styles')) return;
    const s = document.createElement('style');
    s.id = 'vd-styles';
    s.textContent = `
    #video-detector-section { padding:6rem 0; background:${VDC.ink}; position:relative; }
    #video-detector-section::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg,transparent,${VDC.neon},transparent); opacity:0.25; }
    .vd-container { max-width:960px; margin:0 auto; padding:0 2rem; }
    .vd-header { text-align:center; margin-bottom:3rem; }
    .vd-badge { display:inline-block; font-family:'Space Mono',monospace; font-size:0.66rem; letter-spacing:0.14em; text-transform:uppercase; color:${VDC.neon}; border:1px solid rgba(0,245,160,0.25); background:rgba(0,245,160,0.08); padding:0.35rem 0.85rem; border-radius:4px; margin-bottom:1rem; }
    .vd-title { font-family:'Outfit',sans-serif; font-size:clamp(1.9rem,3.5vw,2.75rem); font-weight:800; color:${VDC.txt1}; letter-spacing:-0.03em; margin-bottom:0.75rem; line-height:1.1; }
    .vd-subtitle { font-family:'DM Sans',sans-serif; font-size:1rem; color:${VDC.txt2}; }
    .vd-card { background:${VDC.panel}; border:1px solid ${VDC.line}; border-radius:20px; padding:2.5rem; box-shadow:0 4px 32px rgba(0,0,0,0.5),0 1px 0 rgba(255,255,255,0.04) inset; }
    .vd-upload-area { border:1.5px dashed ${VDC.line2}; border-radius:14px; background:${VDC.ink3}; cursor:pointer; transition:all 0.25s; margin-bottom:1.5rem; overflow:hidden; }
    .vd-upload-area:hover,.vd-upload-area.drag-over { border-color:rgba(0,245,160,0.5); background:rgba(0,245,160,0.04); }
    .vd-upload-area.drag-over { transform:scale(1.01); }
    .vd-upload-content { padding:3rem 2rem; text-align:center; }
    .vd-upload-icon { width:72px; height:72px; margin:0 auto 1.25rem; background:rgba(0,245,160,0.1); border:1px solid rgba(0,245,160,0.2); border-radius:50%; display:flex; align-items:center; justify-content:center; }
    .vd-upload-icon i { font-size:2rem; color:${VDC.neon}; }
    .vd-upload-title { font-family:'Outfit',sans-serif; font-size:1.1rem; font-weight:600; color:${VDC.txt1}; margin-bottom:0.4rem; }
    .vd-upload-text { font-family:'DM Sans',sans-serif; font-size:0.875rem; color:${VDC.txt2}; margin-bottom:0.25rem; }
    .vd-upload-format { font-family:'Space Mono',monospace; font-size:0.66rem; color:${VDC.txt3}; letter-spacing:0.06em; margin-bottom:1.5rem; }
    .vd-upload-btn { font-family:'Space Mono',monospace; font-size:0.7rem; letter-spacing:0.06em; background:transparent; color:${VDC.neon}; border:1px solid rgba(0,245,160,0.4); padding:0.6rem 1.25rem; border-radius:4px; cursor:pointer; transition:all 0.2s; }
    .vd-upload-btn:hover { background:${VDC.neon}; color:${VDC.ink}; box-shadow:0 0 20px rgba(0,245,160,0.4); }
    .vd-preview { background:${VDC.ink3}; border:1px solid ${VDC.line}; border-radius:14px; padding:1.25rem; margin-bottom:1.5rem; display:none; animation:vdFadeIn 0.3s ease; }
    .vd-preview-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; }
    .vd-preview-label { font-family:'Space Mono',monospace; font-size:0.7rem; letter-spacing:0.06em; text-transform:uppercase; color:${VDC.txt2}; display:flex; align-items:center; gap:0.5rem; }
    .vd-preview-label i { color:${VDC.neon}; }
    .vd-remove-btn { background:none; border:1px solid ${VDC.line}; color:${VDC.txt3}; cursor:pointer; width:28px; height:28px; border-radius:4px; display:flex; align-items:center; justify-content:center; transition:all 0.2s; font-size:0.8rem; }
    .vd-remove-btn:hover { border-color:${VDC.red}; color:${VDC.red}; background:rgba(255,77,109,0.1); }
    .vd-video-wrapper { text-align:center; }
    .vd-video-wrapper video { max-width:100%; max-height:360px; border-radius:8px; border:1px solid ${VDC.line}; background:#000; }
    .vd-meta { display:flex; gap:0.75rem; flex-wrap:wrap; margin-top:0.75rem; justify-content:center; }
    .vd-meta-pill { font-family:'Space Mono',monospace; font-size:0.65rem; letter-spacing:0.06em; background:${VDC.panel2}; border:1px solid ${VDC.line2}; color:${VDC.txt2}; padding:0.3rem 0.7rem; border-radius:4px; display:flex; align-items:center; gap:0.4rem; }
    .vd-meta-pill i { color:${VDC.neon}; font-size:0.6rem; }
    .vd-analyze-btn { width:100%; background:${VDC.neon}; color:${VDC.ink}; border:none; padding:1rem; border-radius:8px; font-family:'Space Mono',monospace; font-size:0.8rem; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; cursor:pointer; transition:all 0.25s; display:flex; align-items:center; justify-content:center; gap:0.75rem; margin-bottom:1.5rem; position:relative; overflow:hidden; }
    .vd-analyze-btn:hover:not(:disabled) { transform:translateY(-2px); box-shadow:0 0 20px rgba(0,245,160,0.4),0 0 60px rgba(0,245,160,0.15); }
    .vd-analyze-btn:disabled { opacity:0.35; cursor:not-allowed; }
    .vd-analyze-btn.loading { color:transparent; pointer-events:none; }
    .vd-analyze-btn.loading::after { content:''; position:absolute; width:20px; height:20px; top:50%; left:50%; margin:-10px 0 0 -10px; border:2px solid ${VDC.ink}; border-top-color:transparent; border-radius:50%; animation:vdSpin 0.7s linear infinite; }
    .vd-progress { background:${VDC.ink3}; border:1px solid ${VDC.line}; border-radius:14px; padding:1.5rem; margin-bottom:1.5rem; display:none; }
    .vd-progress-header { font-family:'Space Mono',monospace; font-size:0.68rem; letter-spacing:0.1em; text-transform:uppercase; color:${VDC.txt2}; margin-bottom:1rem; display:flex; align-items:center; gap:0.5rem; }
    .vd-progress-header i { color:${VDC.neon}; }
    .vd-progress-steps { display:flex; flex-direction:column; gap:0.6rem; }
    .vd-step { display:flex; align-items:center; gap:0.75rem; font-family:'Space Mono',monospace; font-size:0.68rem; color:${VDC.txt3}; padding:0.6rem 0.875rem; background:${VDC.panel2}; border-radius:4px; border:1px solid transparent; transition:all 0.3s; }
    .vd-step.active { color:${VDC.txt1}; border-color:rgba(0,245,160,0.2); }
    .vd-step.done   { color:${VDC.neon}; border-color:rgba(0,245,160,0.15); }
    .vd-step.error-s{ color:${VDC.red};  border-color:rgba(255,77,109,0.2); }
    .vd-step-icon { width:20px; height:20px; flex-shrink:0; display:flex; align-items:center; justify-content:center; }
    .vd-step-spinner { width:12px; height:12px; border:1.5px solid currentColor; border-top-color:transparent; border-radius:50%; animation:vdSpin 0.7s linear infinite; }
    .vd-frames { display:flex; gap:6px; overflow-x:auto; padding-bottom:4px; margin-bottom:1rem; scrollbar-width:thin; scrollbar-color:rgba(0,245,160,0.3) transparent; }
    .vd-frame-thumb { flex-shrink:0; width:80px; height:48px; border-radius:4px; object-fit:cover; border:1px solid ${VDC.line}; opacity:0.6; transition:all 0.25s; }
    .vd-frame-thumb.flagged { border-color:rgba(255,77,109,0.6); opacity:1; box-shadow:0 0 8px rgba(255,77,109,0.3); }
    .vd-frame-thumb.clean   { border-color:rgba(0,245,160,0.4); opacity:1; }
    .vd-result { display:none; animation:vdFadeIn 0.4s ease; }
    .vd-result-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; padding-bottom:1rem; border-bottom:1px solid ${VDC.line}; }
    .vd-result-label { font-family:'Space Mono',monospace; font-size:0.7rem; letter-spacing:0.08em; text-transform:uppercase; color:${VDC.txt2}; display:flex; align-items:center; gap:0.5rem; }
    .vd-result-label i { color:${VDC.neon}; }
    /* Probability card */
    .vd-prob-card { background:${VDC.ink3}; border:1px solid ${VDC.line}; border-radius:16px; padding:2rem; margin-bottom:1.5rem; }
    .vd-prob-top { display:flex; align-items:center; gap:2.5rem; flex-wrap:wrap; margin-bottom:1.5rem; }
    .vd-ring-wrap { position:relative; width:150px; height:150px; flex-shrink:0; }
    .vd-ring-wrap svg { width:150px; height:150px; transform:rotate(-90deg); }
    .vd-ring-bg   { stroke:rgba(255,255,255,0.08); }
    .vd-ring-fill { stroke:${VDC.neon}; stroke-dasharray:395; stroke-dashoffset:395; transition:stroke-dashoffset 1.4s cubic-bezier(0.4,0,0.2,1); filter:drop-shadow(0 0 6px ${VDC.neon}); }
    .vd-ring-fill.danger  { stroke:${VDC.red};   filter:drop-shadow(0 0 6px ${VDC.red});   }
    .vd-ring-fill.warning { stroke:${VDC.amber}; filter:drop-shadow(0 0 6px ${VDC.amber}); }
    .vd-ring-fill.safe    { stroke:${VDC.green}; filter:drop-shadow(0 0 6px ${VDC.green}); }
    .vd-ring-text { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); text-align:center; line-height:1; }
    .vd-score-num { font-family:'Space Mono',monospace; font-size:2.2rem; font-weight:700; color:${VDC.txt1}; display:block; }
    .vd-score-pct { font-family:'Space Mono',monospace; font-size:0.9rem; color:${VDC.txt3}; }
    /* Verdict */
    .vd-verdict-box { flex:1; min-width:200px; padding:1.4rem 1.6rem; border-radius:12px; border-left:3px solid ${VDC.neon}; background:${VDC.panel2}; transition:all 0.5s; }
    .vd-verdict-box.safe    { border-left-color:${VDC.green}; background:rgba(57,217,138,0.05); }
    .vd-verdict-box.warning { border-left-color:${VDC.amber}; background:rgba(255,181,71,0.05); }
    .vd-verdict-box.danger  { border-left-color:${VDC.red};   background:rgba(255,77,109,0.05); }
    .vd-verdict-icon  { margin-bottom:0.6rem; font-size:1.4rem; }
    .vd-verdict-title { font-family:'Outfit',sans-serif; font-size:1rem; font-weight:700; color:${VDC.txt1}; margin-bottom:0.4rem; }
    .vd-verdict-sub   { font-family:'DM Sans',sans-serif; font-size:0.8rem; color:${VDC.txt3}; line-height:1.6; }
    /* Confidence */
    .vd-confidence-row { display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap; margin-bottom:0.75rem; }
    .vd-conf-label { font-family:'Space Mono',monospace; font-size:0.65rem; letter-spacing:0.08em; text-transform:uppercase; color:${VDC.txt3}; }
    .vd-conf-badge { font-family:'Space Mono',monospace; font-size:0.68rem; letter-spacing:0.06em; text-transform:uppercase; padding:0.3rem 0.75rem; border-radius:4px; border:1px solid; }
    .vd-conf-badge.low    { color:${VDC.amber}; border-color:rgba(255,181,71,0.35);  background:rgba(255,181,71,0.08);  }
    .vd-conf-badge.medium { color:${VDC.blue};  border-color:rgba(0,201,255,0.35);   background:rgba(0,201,255,0.08);   }
    .vd-conf-badge.high   { color:${VDC.red};   border-color:rgba(255,77,109,0.35);  background:rgba(255,77,109,0.08);  }
    .vd-conf-note { font-family:'DM Sans',sans-serif; font-size:0.75rem; color:${VDC.txt3}; font-style:italic; }
    /* Combos */
    .vd-combo-row { display:flex; flex-wrap:wrap; gap:0.5rem; margin-top:0.5rem; }
    .vd-combo-pill { font-family:'Space Mono',monospace; font-size:0.62rem; letter-spacing:0.04em; padding:0.25rem 0.65rem; border-radius:4px; border:1px solid rgba(255,181,71,0.3); background:rgba(255,181,71,0.07); color:${VDC.amber}; display:flex; align-items:center; gap:0.35rem; }
    .vd-combo-pill i { font-size:0.55rem; }
    /* Layer scores */
    .vd-layers { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:0.75rem; margin-bottom:1.5rem; }
    .vd-layer-item { background:${VDC.ink3}; border:1px solid ${VDC.line}; border-radius:10px; padding:1rem; }
    .vd-layer-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:0.6rem; }
    .vd-layer-name { font-family:'Space Mono',monospace; font-size:0.62rem; letter-spacing:0.07em; text-transform:uppercase; color:${VDC.txt3}; }
    .vd-layer-val  { font-family:'Space Mono',monospace; font-size:0.72rem; font-weight:700; color:${VDC.txt1}; }
    .vd-layer-track { height:4px; background:rgba(255,255,255,0.08); border-radius:2px; overflow:hidden; margin-bottom:0.5rem; }
    .vd-layer-fill  { height:100%; border-radius:2px; transition:width 1.1s ease; width:0; }
    .vd-layer-note  { font-family:'DM Sans',sans-serif; font-size:0.7rem; color:${VDC.txt3}; line-height:1.4; }
    /* Evidence */
    .vd-evidence { background:${VDC.ink3}; border:1px solid ${VDC.line}; border-radius:14px; padding:1.5rem; margin-bottom:1.5rem; }
    .vd-evidence-header { font-family:'Space Mono',monospace; font-size:0.68rem; letter-spacing:0.08em; text-transform:uppercase; color:${VDC.txt2}; margin-bottom:1rem; padding-bottom:0.75rem; border-bottom:1px solid ${VDC.line}; display:flex; align-items:center; gap:0.5rem; }
    .vd-evidence-header i { color:${VDC.amber}; }
    .vd-evidence-empty { font-family:'DM Sans',sans-serif; font-size:0.82rem; color:${VDC.txt3}; font-style:italic; }
    .vd-evidence-item { display:flex; align-items:flex-start; gap:0.75rem; padding:0.6rem 0.875rem; background:${VDC.panel2}; border-radius:6px; border:1px solid transparent; margin-bottom:0.4rem; opacity:0; transform:translateX(-8px); transition:opacity 0.3s ease, transform 0.3s ease; }
    .vd-evidence-item.visible { opacity:1; transform:translateX(0); }
    .vd-evidence-dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; margin-top:5px; }
    .vd-evidence-dot.ai      { background:${VDC.red};   box-shadow:0 0 6px rgba(255,77,109,0.5); }
    .vd-evidence-dot.real    { background:${VDC.green}; }
    .vd-evidence-dot.neutral { background:${VDC.txt3};  }
    .vd-evidence-text { font-family:'Space Mono',monospace; font-size:0.67rem; color:${VDC.txt2}; line-height:1.5; }
    /* Details */
    .vd-details { background:${VDC.ink3}; border:1px solid ${VDC.line}; border-radius:14px; padding:1.5rem; }
    .vd-details-header { font-family:'Space Mono',monospace; font-size:0.68rem; letter-spacing:0.08em; text-transform:uppercase; color:${VDC.txt2}; margin-bottom:1rem; padding-bottom:0.75rem; border-bottom:1px solid ${VDC.line}; display:flex; align-items:center; gap:0.5rem; }
    .vd-details-header i { color:${VDC.neon}; }
    .vd-detail-row { display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; padding:0.7rem 0.875rem; background:${VDC.panel2}; border-radius:4px; border:1px solid transparent; margin-bottom:0.4rem; transition:border-color 0.2s; }
    .vd-detail-row:hover { border-color:rgba(255,255,255,0.1); }
    .vd-detail-label { font-family:'Space Mono',monospace; font-size:0.67rem; color:${VDC.txt3}; white-space:nowrap; flex-shrink:0; }
    .vd-detail-value { color:${VDC.txt1}; font-size:0.79rem; text-align:right; word-break:break-word; }
    .vd-disclaimer { background:rgba(0,245,160,0.04); border:1px solid rgba(0,245,160,0.12); border-radius:4px; padding:0.75rem 1rem; margin-top:1rem; display:flex; align-items:flex-start; gap:0.5rem; font-family:'DM Sans',sans-serif; font-size:0.75rem; color:${VDC.txt3}; line-height:1.5; }
    .vd-disclaimer i { color:${VDC.neon}; margin-top:0.1rem; flex-shrink:0; }
    .vd-error { background:rgba(255,77,109,0.1); border:1px solid rgba(255,77,109,0.3); color:${VDC.red}; padding:0.875rem 1rem; border-radius:8px; margin-top:1rem; display:none; align-items:center; gap:0.5rem; font-size:0.8rem; font-family:'Space Mono',monospace; }
    @keyframes vdFadeIn { from{opacity:0} to{opacity:1} }
    @keyframes vdSpin   { to{transform:rotate(360deg)} }
    @media (max-width:768px) { .vd-card{padding:1.5rem;} .vd-prob-top{flex-direction:column;align-items:flex-start;gap:1.5rem;} .vd-layers{grid-template-columns:1fr 1fr;} }
    `;
    document.head.appendChild(s);
})();

// ─── DOM ──────────────────────────────────────────────────────
(function buildDOM() {
    const target = document.getElementById('about') || document.querySelector('footer');
    if (!target) { console.warn('[VideoDetector] no injection target'); return; }
    const section = document.createElement('section');
    section.id = 'video-detector-section';
    section.innerHTML = `
    <div class="vd-container">
      <div class="vd-header">
        <span class="vd-badge">// AI Probability Analyzer V1</span>
        <h2 class="vd-title">Evaluate the probability of an <span style="background:linear-gradient(135deg,#00F5A0,#00C9FF);-webkit-background-clip:text;background-clip:text;color:transparent">AI-generated video</span></h2>
        <p class="vd-subtitle">4-layer probabilistic analysis — never absolute verdict, always probability + confidence level</p>
      </div>
      <div class="vd-card">
        <div class="vd-upload-area" id="vdUploadArea">
          <div class="vd-upload-content">
            <div class="vd-upload-icon"><i class="fas fa-film"></i></div>
            <h3 class="vd-upload-title">Drop your video here</h3>
            <p class="vd-upload-text">Drag & drop or click to browse</p>
            <p class="vd-upload-format">MP4 · MOV · WEBM · AVI · max 200 MB · max 2 min</p>
            <input type="file" id="vdInput" accept="video/mp4,video/quicktime,video/webm,video/avi,video/*" style="display:none">
            <button type="button" class="vd-upload-btn" id="vdUploadBtn">Choose a video</button>
          </div>
        </div>
        <div class="vd-preview" id="vdPreview">
          <div class="vd-preview-header">
            <div class="vd-preview-label"><i class="fas fa-film"></i><span>Preview</span></div>
            <button class="vd-remove-btn" id="vdRemoveBtn"><i class="fas fa-times"></i></button>
          </div>
          <div class="vd-video-wrapper"><video id="vdVideoEl" controls preload="metadata" playsinline muted></video></div>
          <div class="vd-meta" id="vdMeta"></div>
        </div>
        <button class="vd-analyze-btn" id="vdAnalyzeBtn" disabled>
          <i class="fas fa-microscope"></i><span>Start probabilistic analysis</span>
        </button>
        <div class="vd-progress" id="vdProgress">
          <div class="vd-progress-header"><i class="fas fa-terminal"></i><span>Analysis pipeline</span></div>
          <div class="vd-progress-steps" id="vdSteps"></div>
          <div class="vd-frames" id="vdFrameStrip"></div>
        </div>
        <div class="vd-result" id="vdResult">
          <div class="vd-result-header">
            <div class="vd-result-label"><i class="fas fa-chart-bar"></i><span>Probabilistic report</span></div>
          </div>
          <div class="vd-prob-card">
            <div class="vd-prob-top">
              <div class="vd-ring-wrap">
                <svg viewBox="0 0 150 150">
                  <circle class="vd-ring-bg"   cx="75" cy="75" r="63" fill="none" stroke-width="9"/>
                  <circle class="vd-ring-fill" id="vdRingFill" cx="75" cy="75" r="63" fill="none" stroke-width="9" stroke-linecap="round"/>
                </svg>
                <div class="vd-ring-text">
                  <span class="vd-score-num" id="vdScoreNum">0</span>
                  <span class="vd-score-pct">%</span>
                </div>
              </div>
              <div class="vd-verdict-box" id="vdVerdictBox">
                <div class="vd-verdict-icon"  id="vdVerdictIcon"></div>
                <div class="vd-verdict-title" id="vdVerdictTitle">Waiting...</div>
                <div class="vd-verdict-sub"   id="vdVerdictSub"></div>
              </div>
            </div>
            <div class="vd-confidence-row">
              <span class="vd-conf-label">Confidence:</span>
              <span class="vd-conf-badge" id="vdConfBadge">—</span>
              <span class="vd-conf-note"  id="vdConfNote"></span>
            </div>
            <div class="vd-combo-row" id="vdComboRow"></div>
          </div>
          <div class="vd-layers" id="vdLayers"></div>
          <div class="vd-evidence">
            <div class="vd-evidence-header"><i class="fas fa-search"></i><span>Detected anomalies</span></div>
            <div id="vdEvidenceList"></div>
          </div>
          <div class="vd-details">
            <div class="vd-details-header"><i class="fas fa-terminal"></i><span>Technical breakdown</span></div>
            <div id="vdDetailRows"></div>
            <div class="vd-disclaimer">
              <i class="fas fa-info-circle"></i>
              <p>Probabilistic analysis V1.0 — 4 layers: inter-frame pixel coherence (25%), local temporal consistency (20%), audio forensics voice (20%), LLaVA+LLaMA vision pipeline (35%). This system evaluates a <strong>probability</strong>, never absolute certainty. Natural compression artifacts may generate false positives. Always cross-reference with other sources for a definitive verdict.</p>
            </div>
          </div>
        </div>
        <div class="vd-error" id="vdError">
          <i class="fas fa-exclamation-triangle"></i><span id="vdErrorText"></span>
        </div>
      </div>
    </div>`;
    target.parentNode.insertBefore(section, target);
    addNavLink(); bindEvents();
})();

function addNavLink() {
    const navLinks = document.querySelector('.nav-links');
    if (navLinks && !document.querySelector('.nav-link[href="#video-detector-section"]')) {
        const a = Object.assign(document.createElement('a'), { href:'#video-detector-section', className:'nav-link', textContent:'Video' });
        const ref = [...navLinks.querySelectorAll('.nav-link')].find(l => l.href.includes('about'));
        if (ref) navLinks.insertBefore(a, ref); else navLinks.appendChild(a);
    }
    const drawer = document.getElementById('mobileDrawer');
    if (drawer && !drawer.querySelector('[href="#video-detector-section"]')) {
        const a = Object.assign(document.createElement('a'), { href:'#video-detector-section', className:'mobile-nav-link', innerHTML:'Video Detector<span class="arrow">→</span>' });
        a.setAttribute('data-drawer-link','');
        const cta = drawer.querySelector('.mobile-cta');
        if (cta) drawer.insertBefore(a,cta); else drawer.appendChild(a);
    }
}

function bindEvents() {
    const area       = document.getElementById('vdUploadArea');
    const input      = document.getElementById('vdInput');
    const uploadBtn  = document.getElementById('vdUploadBtn');
    const removeBtn  = document.getElementById('vdRemoveBtn');
    const analyzeBtn = document.getElementById('vdAnalyzeBtn');
    uploadBtn.addEventListener('click', () => input.click());
    area.addEventListener('click', e => { if (e.target !== uploadBtn && !uploadBtn.contains(e.target)) input.click(); });
    area.addEventListener('dragover',  e => { e.preventDefault(); area.classList.add('drag-over'); });
    area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
    area.addEventListener('drop', e => { e.preventDefault(); area.classList.remove('drag-over'); const f=e.dataTransfer.files[0]; if(f) handleVideoFile(f); });
    input.addEventListener('change', e => { if(e.target.files[0]) handleVideoFile(e.target.files[0]); });
    removeBtn.addEventListener('click', resetVideoDetector);
    analyzeBtn.addEventListener('click', () => { if(!vdIsAnalysing) startVideoAnalysis(); });
}

function handleVideoFile(file) {
    if (!file.type.startsWith('video/')) { showVdError('Invalid format (MP4, MOV, WEBM, AVI)'); return; }
    const sizeMB = file.size/(1024*1024);
    if (sizeMB > VD_CONFIG.maxFileSizeMB) { showVdError(`File too large (${sizeMB.toFixed(0)} MB). Max ${VD_CONFIG.maxFileSizeMB} MB.`); return; }
    vdCurrentFile = file;
    const url = URL.createObjectURL(file);
    const vid = document.getElementById('vdVideoEl');
    vid.onloadedmetadata = () => {
        if (vid.duration > VD_CONFIG.maxDurationSeconds) {
            showVdError(`Video too long (${Math.floor(vid.duration)}s). Max 2 min.`);
            URL.revokeObjectURL(url); vdCurrentFile=null; return;
        }
        document.getElementById('vdUploadArea').style.display = 'none';
        document.getElementById('vdPreview').style.display = 'block';
        document.getElementById('vdMeta').innerHTML = `
            <span class="vd-meta-pill"><i class="fas fa-clock"></i>${formatDuration(vid.duration)}</span>
            <span class="vd-meta-pill"><i class="fas fa-weight-hanging"></i>${sizeMB.toFixed(1)} MB</span>
            <span class="vd-meta-pill"><i class="fas fa-file-video"></i>${file.type.split('/')[1].toUpperCase()}</span>
            <span class="vd-meta-pill"><i class="fas fa-layer-group"></i>4 layers</span>`;
        document.getElementById('vdAnalyzeBtn').disabled = false;
        hideVdError(); vdToast('// Video loaded');
    };
    vid.src = url;
}

function resetVideoDetector() {
    vdCurrentFile=null; vdIsAnalysing=false;
    const vid = document.getElementById('vdVideoEl');
    if (vid.src) { URL.revokeObjectURL(vid.src); vid.src=''; }
    document.getElementById('vdInput').value='';
    ['vdUploadArea','vdPreview','vdProgress','vdResult'].forEach((id,i) => {
        document.getElementById(id).style.display = i===0 ? '' : 'none';
    });
    document.getElementById('vdFrameStrip').innerHTML='';
    document.getElementById('vdSteps').innerHTML='';
    document.getElementById('vdAnalyzeBtn').disabled=true;
    document.getElementById('vdAnalyzeBtn').classList.remove('loading');
    hideVdError();
}

// ─────────────────────────────────────────────────────────────
//  MAIN PIPELINE
// ─────────────────────────────────────────────────────────────
async function startVideoAnalysis() {
    if (!vdCurrentFile || vdIsAnalysing) return;
    vdIsAnalysing = true;
    const btn = document.getElementById('vdAnalyzeBtn');
    btn.disabled=true; btn.classList.add('loading');
    document.getElementById('vdProgress').style.display='block';
    document.getElementById('vdResult').style.display='none';
    document.getElementById('vdFrameStrip').innerHTML='';
    document.getElementById('vdSteps').innerHTML='';
    hideVdError();

    const allEvidence = [];   // accumulates { type, text } objects

    try {
        if (!vdBrain) {
            try { vdBrain = await (await fetch('./video-brain.json')).json(); }
            catch { vdBrain={}; }
        }

        // Step 1 – Sparse frames
        const sEx = addStep(`Extracting ${VD_CONFIG.frameCount} frames (pixel analysis + LLaVA)...`);
        let sparseFrames;
        try {
            sparseFrames = await extractFrames(vdCurrentFile, VD_CONFIG.frameCount, 'sparse');
            markStep(sEx,'done',`${sparseFrames.length} frames extracted`);
        } catch(e) { markStep(sEx,'error','Extraction failed'); throw e; }
        renderFrameStrip(sparseFrames);

        // Step 2 – Local frames
        const sLoc = addStep(`Extracting ${VD_CONFIG.temporalFrameCount} consecutive frames (${VD_CONFIG.temporalWindowSec}s window)...`);
        let localFrames;
        try {
            localFrames = await extractFrames(vdCurrentFile, VD_CONFIG.temporalFrameCount, 'local');
            markStep(sLoc,'done',`Window ${localFrames[0]?.timestamp.toFixed(1)}s–${localFrames[localFrames.length-1]?.timestamp.toFixed(1)}s`);
        } catch(e) { markStep(sLoc,'error','Fallback to sparse frames'); localFrames=sparseFrames; }

        // Step 3 – Pixel
        const sPx = addStep('Inter-frame pixel coherence (sensor noise, chroma, DCT blocks)...');
        let pixelR = { score:50, details:'N/A', evidence:[] };
        try {
            pixelR = await analyzePixelCoherence(sparseFrames);
            allEvidence.push(...pixelR.evidence);
            markStep(sPx,'done',`Pixel: ${pixelR.score}%`);
        } catch(e) { markStep(sPx,'error','Pixel — fallback 50%'); }

        // Step 4 – Temporal
        const sTm = addStep('Local temporal consistency (dense 2-3s window)...');
        let temporalR = { score:50, details:'N/A', evidence:[] };
        try {
            temporalR = await analyzeLocalTemporal(localFrames);
            allEvidence.push(...temporalR.evidence);
            markStep(sTm,'done',`Temporal: ${temporalR.score}%`);
        } catch(e) { markStep(sTm,'error','Temporal — fallback 50%'); }

        // Step 5 – Audio
        const sAu = addStep('Audio forensics (voice, background noise, TTS, cuts)...');
        let audioR = { score:null, details:'N/A', skipped:false, reason:'', evidence:[] };
        try {
            if (window.VideoAudioAnalyzer) {
                const raw = await window.VideoAudioAnalyzer.analyze(vdCurrentFile, vdBrain);
                if (!raw.hasAudio)          { audioR.skipped=true; audioR.reason='No audio track'; markStep(sAu,'done','No audio track'); }
                else if (raw.isMusicDominated) { audioR.skipped=true; audioR.reason='Music detected — not analyzed'; markStep(sAu,'done','Music → audio layer skipped'); }
                else {
                    audioR.score=raw.score; audioR.details=raw.details;
                    audioR.evidence = raw.evidence || [];
                    allEvidence.push(...audioR.evidence);
                    markStep(sAu,'done',`Audio: ${raw.score}%`);
                }
            } else { audioR.skipped=true; audioR.reason='VideoAudioAnalyzer missing'; markStep(sAu,'error','video-audio-analyzer.js missing'); }
        } catch(e) { audioR.skipped=true; audioR.reason='Error'; markStep(sAu,'error','Audio — skipped'); }

        // Step 6 – LLaVA
        const sLv = addStep('LLaVA vision → structured LLaMA verdict...');
        let llavaR = { score:null, details:'N/A', evidence:[] };
        if (VD_CONFIG.cloudflareWorkerUrl) {
            try {
                llavaR = await runLLaVA(sparseFrames);
                allEvidence.push(...llavaR.evidence);
                markStep(sLv,'done',`LLaVA+LLaMA: ${llavaR.score}%`);
            } catch(e) { markStep(sLv,'error','LLaVA unavailable'); }
        } else { markStep(sLv,'error','Cloudflare Worker not configured'); }

        // Step 7 – Aggregate
        const sFin = addStep('Calculate final probability + confidence + evidence...');
        const result = aggregateProbabilistic({
            pixel:   pixelR.score,    pixelDetails:   pixelR.details,
            temporal:temporalR.score, temporalDetails:temporalR.details,
            audio:   audioR.score,    audioDetails:   audioR.details,
            audioSkipped: audioR.skipped, audioReason: audioR.reason,
            llava:   llavaR.score,    llavaDetails:   llavaR.details,
            evidence: allEvidence,
        });
        markStep(sFin,'done',`AI probability: ${result.ai_probability}% — confidence: ${result.confidence}`);

        // Structured console output
        console.group('[VideoDetector] 📊 AI Probability Report V1.0');
        console.log(JSON.stringify({ ai_probability:result.ai_probability, confidence:result.confidence, verdict:result.verdict, scores:result.scores, evidence:result.evidence }, null, 2));
        console.groupEnd();

        displayResults(result);

    } catch(err) {
        console.error('[VideoDetector] Pipeline error:', err);
        showVdError(`Analysis failed: ${err.message}`);
    } finally {
        vdIsAnalysing=false; btn.classList.remove('loading'); btn.disabled=false;
    }
}

// ─────────────────────────────────────────────────────────────
//  PROBABILISTIC AGGREGATOR
// ─────────────────────────────────────────────────────────────
function aggregateProbabilistic(d) {
    const W = VD_CONFIG.weights;
    const layers = [];
    if (d.pixel    != null) layers.push({ id:'pixel',    score:d.pixel,    w:W.pixel    });
    if (d.temporal != null) layers.push({ id:'temporal', score:d.temporal, w:W.temporal });
    if (d.audio    != null) layers.push({ id:'audio',    score:d.audio,    w:W.audio    });
    if (d.llava    != null) layers.push({ id:'llava',    score:d.llava,    w:W.llava    });

    // Normalise weights
    const totalW = layers.reduce((s,l)=>s+l.w, 0) || 1;
    const normed = layers.map(l => ({ ...l, wn: l.w/totalW }));

    // Base weighted average
    let raw = normed.reduce((s,l) => s + l.score*l.wn, 0);

    // Combo boosts — apply only when 2+ layers agree strongly
    const combos = [];
    const aiStr  = normed.filter(l=>l.score>65);
    const realStr= normed.filter(l=>l.score<35);
    const evStr  = (d.evidence||[]).join(' ').toLowerCase();

    if (aiStr.length >= 3)  { raw=Math.min(97,raw+5);  combos.push({ label:`${aiStr.length} layers → AI`,   boost:'+5' }); }
    else if (aiStr.length>=2){ raw=Math.min(97,raw+2);  combos.push({ label:'2 layers → AI',                boost:'+2' }); }
    if (realStr.length>=3)  { raw=Math.max(3, raw-5);   combos.push({ label:`${realStr.length} layers → Real`, boost:'-5' }); }
    else if (realStr.length>=2){ raw=Math.max(3,raw-2); combos.push({ label:'2 layers → Real',              boost:'-2' }); }

    if (evStr.includes('anatomie')||evStr.includes('anatomy'))  { raw=Math.min(97,raw+4); combos.push({ label:'Anatomical errors',   boost:'+4' }); }
    if (evStr.includes('morphing'))                              { raw=Math.min(97,raw+3); combos.push({ label:'Inter-frame morphing', boost:'+3' }); }
    if (evStr.includes('tts')||evStr.includes('pauses régulières')){ raw=Math.min(97,raw+2); combos.push({ label:'TTS audio pattern',   boost:'+2' }); }
    if (evStr.includes('organique')||evStr.includes('organic'))  { raw=Math.max(3, raw-2); combos.push({ label:'Organic variation',   boost:'-2' }); }

    const ai_probability = Math.round(Math.min(97, Math.max(3, raw)));

    // Confidence — based on spread between layers (disagreement = lower confidence)
    const layerScores = normed.map(l=>l.score);
    const spread = layerScores.length>1 ? Math.max(...layerScores)-Math.min(...layerScores) : 50;

    let confidence;
    if (spread > 35 || normed.length < 2) confidence = 'low';
    else if (ai_probability < VD_CONFIG.confidence.lowMax) confidence = 'low';
    else if (ai_probability <= VD_CONFIG.confidence.mediumMax) confidence = 'medium';
    else confidence = 'high';

    // Verdict — low confidence always → uncertain
    let verdict;
    if (confidence==='low')                                    verdict = 'uncertain';
    else if (ai_probability <= VD_CONFIG.verdict.authenticMax) verdict = 'likely authentic';
    else if (ai_probability <= VD_CONFIG.verdict.uncertainMax) verdict = 'uncertain';
    else                                                       verdict = 'likely AI-generated';

    const scores = {};
    normed.forEach(l => { scores[l.id]=l.score; });

    return {
        ai_probability, confidence, verdict, scores, combos, spread,
        activeLayerCount: normed.length,
        evidence: (d.evidence||[]).filter(Boolean),
        pixelDetails:d.pixelDetails, temporalDetails:d.temporalDetails,
        audioDetails:d.audioDetails, audioSkipped:d.audioSkipped, audioReason:d.audioReason,
        llavaDetails:d.llavaDetails,
    };
}

// ─────────────────────────────────────────────────────────────
//  PIXEL COHERENCE
// ─────────────────────────────────────────────────────────────
async function analyzePixelCoherence(frames) {
    if (frames.length<2) return { score:50, details:'Not enough frames', evidence:[] };
    const evidence=[];
    const profiles = frames.map(f=>noiseProfile(f.imageData));
    const means    = profiles.map(p=>p.mean);
    const gm       = means.reduce((a,b)=>a+b,0)/means.length;
    const cv       = gm>0 ? Math.sqrt(means.reduce((s,m)=>s+Math.pow(m-gm,2),0)/means.length)/gm : 0;

    let ns;
    if      (cv<0.05){ ns=75; evidence.push({ type:'ai',   text:`pixel — inter-frame noise nearly identical (cv=${cv.toFixed(3)}) — no sensor variation` }); }
    else if (cv<0.10){ ns=60; evidence.push({ type:'ai',   text:`pixel — low inter-frame noise variation (cv=${cv.toFixed(3)})` }); }
    else if (cv<0.20){ ns=45; }
    else if (cv<0.40){ ns=30; evidence.push({ type:'real', text:`pixel — organic sensor noise variation (cv=${cv.toFixed(3)})` }); }
    else             { ns=38; }

    const chromaVals = frames.map(f=>chromaUniformity(f.imageData));
    const avgC = chromaVals.reduce((a,b)=>a+b,0)/chromaVals.length;
    let cs;
    if      (avgC>85){ cs=72; evidence.push({ type:'ai',   text:`pixel — abnormally uniform chroma (${avgC.toFixed(0)}/100) — overly smooth colors` }); }
    else if (avgC>70){ cs=58; }
    else if (avgC>50){ cs=42; }
    else             { cs=28; evidence.push({ type:'real', text:`pixel — natural chroma variation (${avgC.toFixed(0)}/100)` }); }

    const bf = blockArtifact(frames[Math.floor(frames.length/2)].imageData);
    let bs;
    if      (bf>75){ bs=68; evidence.push({ type:'ai', text:`pixel — regular 8×8 block artifacts (${bf.toFixed(0)}/100) — typical AI double compression` }); }
    else if (bf>55){ bs=52; }
    else if (bf>35){ bs=40; }
    else           { bs=28; }

    const score = Math.min(85, Math.max(15, Math.round(ns*0.50 + cs*0.30 + bs*0.20)));
    return { score, details:`noise_cv=${cv.toFixed(3)} chroma=${avgC.toFixed(0)} blocks=${bf.toFixed(0)}`, evidence:evidence.map(e=>e.text) };
}

function noiseProfile(imageData) {
    const {data,width,height}=imageData; const R=[]; const S=4;
    for(let y=1;y<height-1;y+=S) for(let x=1;x<width-1;x+=S) {
        const i=(y*width+x)*4,iU=((y-1)*width+x)*4,iD=((y+1)*width+x)*4,iL=(y*width+(x-1))*4,iR2=(y*width+(x+1))*4;
        const L=a=>0.299*data[a]+0.587*data[a+1]+0.114*data[a+2];
        R.push(Math.abs(4*L(i)-L(iU)-L(iD)-L(iL)-L(iR2)));
    }
    const m=R.reduce((a,b)=>a+b,0)/R.length;
    return { mean:m, std:Math.sqrt(R.reduce((s,v)=>s+Math.pow(v-m,2),0)/R.length) };
}

function chromaUniformity(imageData) {
    const {data}=imageData; let crs=0,crs2=0,cbs=0,cbs2=0,n=0;
    for(let i=0;i<data.length;i+=32){ const r=data[i],g=data[i+1],b=data[i+2]; const cr=128+0.5*r-0.418688*g-0.081312*b,cb=128-0.168736*r-0.331264*g+0.5*b; crs+=cr;crs2+=cr*cr;cbs+=cb;cbs2+=cb*cb;n++; }
    if(!n) return 50;
    const crstd=Math.sqrt(Math.max(0,crs2/n-Math.pow(crs/n,2))),cbstd=Math.sqrt(Math.max(0,cbs2/n-Math.pow(cbs/n,2)));
    return Math.max(0,Math.min(100,100-(crstd+cbstd)/2*3));
}

function blockArtifact(imageData) {
    const {data,width,height}=imageData; let b=0,int2=0;
    for(let y=8;y<height-8;y++){ const bd=(y%8===0); for(let x=8;x<width-8;x+=8){ const i=(y*width+x)*4,iP=((y-1)*width+x)*4; const d=Math.abs((0.299*data[i]+0.587*data[i+1]+0.114*data[i+2])-(0.299*data[iP]+0.587*data[iP+1]+0.114*data[iP+2])); if(bd)b+=d;else int2+=d; } }
    if(!int2) return 0;
    return Math.min(100,Math.max(0,(b/Math.max(int2,1)-1)*40));
}

// ─────────────────────────────────────────────────────────────
//  LOCAL TEMPORAL
// ─────────────────────────────────────────────────────────────
async function analyzeLocalTemporal(frames) {
    if (frames.length<3) return { score:50, details:'N/A', evidence:[] };
    const evidence=[];
    const diffs=[];
    for(let f=1;f<frames.length;f++){
        const a=frames[f-1].imageData.data,b=frames[f].imageData.data,len=Math.min(a.length,b.length);
        let diff=0,count=0;
        for(let i=0;i<len;i+=64){ diff+=Math.abs((0.299*a[i]+0.587*a[i+1]+0.114*a[i+2])-(0.299*b[i]+0.587*b[i+1]+0.114*b[i+2])); count++; }
        diffs.push(count>0?diff/count:0);
    }
    const mean=diffs.reduce((a,b)=>a+b,0)/diffs.length;
    const std=Math.sqrt(diffs.reduce((s,d)=>s+Math.pow(d-mean,2),0)/diffs.length);
    const cv=mean>0?std/mean:0;
    let score,details;
    if(mean<0.5)                { score=48; details=`static scene (mean=${mean.toFixed(2)}) — inconclusive`; }
    else if(mean<1.5&&cv<0.08)  { score=80; details=`AI over-interpolation (mean=${mean.toFixed(2)},cv=${cv.toFixed(3)})`; evidence.push(`temporal — near-zero local transitions over ${frames.length} consecutive frames (Sora/Runway signature)`); }
    else if(mean<2.5&&cv<0.12)  { score=65; details=`suspicious smoothness (mean=${mean.toFixed(2)},cv=${cv.toFixed(3)})`; evidence.push(`temporal — abnormal smoothness for active scene`); }
    else if(cv>1.2)             { score=72; details=`extreme inconsistency (cv=${cv.toFixed(3)})`; evidence.push(`temporal — extreme inter-frame variation (cv=${cv.toFixed(3)}) — frame-by-frame generation`); }
    else if(mean>=2&&cv>=0.15&&cv<=0.80) { score=28; details=`natural motion (mean=${mean.toFixed(2)},cv=${cv.toFixed(3)})`; evidence.push(`temporal — natural motion with organic micro-variation`); }
    else                        { score=45; details=`ambiguous (mean=${mean.toFixed(2)},cv=${cv.toFixed(3)})`; }
    return { score:Math.round(score), details, evidence, mean, cv };
}

// ─────────────────────────────────────────────────────────────
//  LLaVA + LLaMA
// ─────────────────────────────────────────────────────────────
async function runLLaVA(frames) {
    if (!VD_CONFIG.cloudflareWorkerUrl) throw new Error('No Worker URL');
    const evidence=[];
    const indices=[Math.round(frames.length*0.15),Math.round(frames.length*0.50),Math.round(frames.length*0.85)].map(i=>Math.min(i,frames.length-1));
    const results=[];
    for(let idx=0;idx<indices.length;idx++){
        const frame=frames[indices[idx]], fl=`frame ${idx+1} (t=${frame.timestamp.toFixed(1)}s)`;
        try {
            const b64=await resizeLLaVA(frame.dataUrl);
            const res=await fetch(VD_CONFIG.cloudflareWorkerUrl,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({image:b64,model:VD_CONFIG.workerModel,context:'short video frame'}) });
            if(!res.ok) throw new Error(`HTTP ${res.status}`);
            const data=await res.json();
            const desc=data.result?.description||data.result?.response||(typeof data.result==='string'?data.result:'');
            const lv=data.result?.verdict||null;
            let fs,fsig=[];
            if(lv?.ai_probability!==undefined){
                fs=lv.ai_probability;
                if(lv.anatomy_issues)  { fsig.push('anatomy');  evidence.push(`${fl}: anatomical errors (fingers/face/hands)`); }
                if(lv.text_issues)     { fsig.push('text');     evidence.push(`${fl}: illegible or inconsistent text`); }
                if(lv.texture_issues)  { fsig.push('texture');  evidence.push(`${fl}: synthetic textures (plastic-like)`); }
                if(lv.lighting_issues) { fsig.push('lighting'); evidence.push(`${fl}: physically inconsistent lighting/shadows`); }
                if(lv.motion_artifacts){ fsig.push('motion');   evidence.push(`${fl}: morphing or inter-frame artifacts`); }
            } else {
                const p=parseLLaVA(desc,fl,evidence); fs=p.score; fsig=p.signals;
            }
            results.push(Math.min(100,Math.max(0,Math.round(fs))));
        } catch(err) { console.warn('[VideoDetector] LLaVA fail',fl,err.message); results.push(50); }
    }
    if(!results.length) throw new Error('All LLaVA calls failed');
    const ws=[1.2,1.0,0.8], tw=ws.slice(0,results.length).reduce((a,b)=>a+b,0);
    const avg=Math.round(results.reduce((s,r,i)=>s+r*(ws[i]||1),0)/tw);
    return { score:avg, details:evidence.length>0?`Signals: ${[...new Set(evidence.map(e=>e.split(':')[1]?.trim().split(' ').slice(0,2).join(' ')))].join(', ')}`:`${results.length} frames analyzed`, evidence };
}

function parseLLaVA(description, fl, evArr) {
    const l=description.toLowerCase(), sigs=[];
    if(l.includes('six finger')||l.includes('extra finger')||l.includes('deformed hand')||l.includes('distorted face')||l.includes('melting')){ sigs.push({name:'anatomy',score:92,w:3}); evArr.push(`${fl}: anatomical errors (fingers/face)`); }
    if(l.includes('illegible')||l.includes('garbled')||l.includes('nonsense text')){ sigs.push({name:'text',score:88,w:2.5}); evArr.push(`${fl}: illegible or inconsistent text`); }
    if(l.includes('plastic')||l.includes('too smooth')||l.includes('waxy')){ sigs.push({name:'texture',score:78,w:2}); evArr.push(`${fl}: synthetic textures`); }
    if(l.includes('morphing')||l.includes('flickering')||l.includes('ghosting')){ sigs.push({name:'motion',score:85,w:2.5}); evArr.push(`${fl}: motion artifacts (morphing/flickering)`); }
    if(l.includes('ai-generated')||l.includes('artificial')||l.includes('synthetic')){ sigs.push({name:'explicit_ai',score:88,w:3}); }
    if(l.includes('authentic')||l.includes('real footage')||l.includes('natural lighting')){ sigs.push({name:'real',score:12,w:2}); }
    if(!sigs.length){ const ai=['ai','generated','synthetic','fake'].filter(k=>l.includes(k)).length,re=['real','photo','footage','authentic','natural'].filter(k=>l.includes(k)).length; return {score:ai>re?65:re>ai?32:50,signals:[]}; }
    const tw=sigs.reduce((s,g)=>s+g.w,0);
    return {score:Math.round(Math.min(100,Math.max(0,sigs.reduce((s,g)=>s+g.score*g.w,0)/tw))),signals:sigs.map(g=>g.name)};
}

function resizeLLaVA(dataUrl) {
    return new Promise(resolve=>{
        const img=new Image(); img.onload=()=>{
            const c=document.createElement('canvas'),ctx=c.getContext('2d'); let scale=1,result;
            for(let i=0;i<5;i++){ c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);ctx.drawImage(img,0,0,c.width,c.height);result=c.toDataURL('image/jpeg',VD_CONFIG.llavaJpegQuality);if((result.length*0.75)/1024<=VD_CONFIG.llavaMaxSizeKB)break;scale*=0.7; }
            resolve(result.includes(',')?result.split(',')[1]:result);
        }; img.src=dataUrl;
    });
}

// ─────────────────────────────────────────────────────────────
//  DISPLAY
// ─────────────────────────────────────────────────────────────
function displayResults(r) {
    const resultEl = document.getElementById('vdResult');
    resultEl.style.display = 'block';
    const p = r.ai_probability;

    // Ring
    const ring=document.getElementById('vdRingFill'), circ=2*Math.PI*63;
    ring.style.strokeDasharray=circ; ring.style.strokeDashoffset=circ;
    setTimeout(()=>{ ring.style.strokeDashoffset=circ-(p/100)*circ; },60);
    ring.classList.remove('danger','warning','safe');
    if(p>62) ring.classList.add('danger'); else if(p>40) ring.classList.add('warning'); else ring.classList.add('safe');

    // Animated number
    const numEl=document.getElementById('vdScoreNum'); const t0=performance.now();
    const tick=now=>{ const e=1-Math.pow(1-Math.min((now-t0)/1300,1),3); numEl.textContent=Math.floor(e*p); if(e<1)requestAnimationFrame(tick); };
    requestAnimationFrame(tick);

    // Verdict
    const V={
        'likely authentic'    :{css:'safe',   icon:'fa-circle-check',         title:'🟢 Likely authentic',    sub:`AI probability: ${p}%. Analysis layers point toward a real video. This is not a definitive verdict — natural artifacts can exist in any compressed video.`},
        'uncertain'           :{css:'warning',icon:'fa-circle-question',       title:'🟡 Uncertain result',           sub:`AI probability: ${p}%. Signals are mixed or insufficient to determine. The video displays characteristics common to both categories. Human analysis is recommended.`},
        'likely AI-generated' :{css:'danger', icon:'fa-triangle-exclamation',  title:'🟠 Possibly AI-generated', sub:`AI probability: ${p}%. Multiple layers detect anomalies consistent with synthetic generation. This is not absolute certainty — always verify manually before sharing.`},
    };
    const vd=V[r.verdict]||V['uncertain'];
    document.getElementById('vdVerdictBox').className=`vd-verdict-box ${vd.css}`;
    document.getElementById('vdVerdictIcon').innerHTML=`<i class="fas ${vd.icon}" style="color:${vd.css==='safe'?VDC.green:VDC.amber};font-size:1.4rem;"></i>`;
    document.getElementById('vdVerdictTitle').textContent=vd.title;
    document.getElementById('vdVerdictSub').textContent=vd.sub;

    // Confidence
    const notes={ low:`Low confidence — divergent or insufficient signals (spread: ${r.spread.toFixed(0)} pts)`, medium:`Medium confidence — ${r.activeLayerCount} active layers, partially consistent signals`, high:`High confidence — ${r.activeLayerCount} layers strongly agree` };
    const cb=document.getElementById('vdConfBadge');
    cb.className=`vd-conf-badge ${r.confidence}`;
    cb.textContent=r.confidence==='low'?'🔅 LOW':r.confidence==='medium'?'🔶 MEDIUM':'🔴 HIGH';
    document.getElementById('vdConfNote').textContent=notes[r.confidence];

    // Combos
    const cr=document.getElementById('vdComboRow'); cr.innerHTML='';
    if(r.combos.length>0){
        const lbl=Object.assign(document.createElement('span'),{className:'vd-conf-label',textContent:'Combined rules:'});
        cr.appendChild(lbl);
        r.combos.forEach(c=>{ const pill=document.createElement('span'); pill.className='vd-combo-pill'; pill.innerHTML=`<i class="fas fa-link"></i>${c.label} <strong>(${c.boost})</strong>`; cr.appendChild(pill); });
    }

    // Layers
    const layersEl=document.getElementById('vdLayers'); layersEl.innerHTML='';
    const META={ pixel:{name:'Pixel Coherence',color:VDC.neon,note:'Sensor noise · chroma · DCT blocks'}, temporal:{name:'Local Temporal',color:VDC.blue,note:'Dense 2-3s window · natural motion'}, audio:{name:'Audio Forensics',color:VDC.purple,note:'Voice · TTS · cuts · background noise'}, llava:{name:'LLaVA + LLaMA',color:'#FF9F43',note:'Vision AI · anatomy · textures · motion'} };
    ['pixel','temporal','audio','llava'].forEach(id=>{
        const score=r.scores[id], meta=META[id], skip=(score==null||score===undefined);
        const item=document.createElement('div'); item.className='vd-layer-item';
        item.innerHTML=`<div class="vd-layer-header"><span class="vd-layer-name">${meta.name}</span><span class="vd-layer-val">${skip?'N/A':score+'%'}</span></div><div class="vd-layer-track"><div class="vd-layer-fill" style="background:${skip?VDC.txt3:meta.color}" data-w="${skip?5:Math.min(100,score)}"></div></div><div class="vd-layer-note">${meta.note}</div>`;
        layersEl.appendChild(item);
        setTimeout(()=>{ item.querySelector('.vd-layer-fill').style.width=item.querySelector('.vd-layer-fill').dataset.w+'%'; },200);
    });
    if(r.audioSkipped){ const n=document.createElement('div'); n.style.cssText=`grid-column:1/-1;font-family:'Space Mono',monospace;font-size:0.65rem;color:${VDC.txt3};padding:0.4rem 0;`; n.textContent=`⚠ Audio skipped: ${r.audioReason}`; layersEl.appendChild(n); }

    // Evidence
    const evEl=document.getElementById('vdEvidenceList'); evEl.innerHTML='';
    const ev=(r.evidence||[]).filter(Boolean);
    if(!ev.length){
        evEl.innerHTML=`<p class="vd-evidence-empty">No significant anomalies detected in the analyzed segments.</p>`;
    } else {
        ev.forEach((txt,i)=>{
            const isAi=/(abnormal|suspicious|morphing|impossible|tts|over-interpol|near-zero|uniform|anatomy|illegible|synthetic|artifact|regular|double-compress)/i.test(txt);
            const isReal=/(natural|organic)/i.test(txt);
            const dot=isAi?'ai':isReal?'real':'neutral';
            const div=document.createElement('div'); div.className='vd-evidence-item';
            div.innerHTML=`<span class="vd-evidence-dot ${dot}"></span><span class="vd-evidence-text">${txt}</span>`;
            evEl.appendChild(div);
            setTimeout(()=>div.classList.add('visible'), i*60+100);
        });
    }

    // Technical rows
    const rows=[
        { label:'🎯 AI Probability',      value:`${p}%` },
        { label:'🔬 Confidence',           value:`${r.confidence} — layer spread: ${r.spread.toFixed(0)} pts` },
        { label:'⚖️ Verdict',             value:r.verdict },
        { label:'🔍 Pixel coherence',     value:r.scores.pixel!=null    ? `${r.scores.pixel}% — ${r.pixelDetails}`    : 'N/A' },
        { label:'⏱ Local temporal',      value:r.scores.temporal!=null ? `${r.scores.temporal}% — ${r.temporalDetails}` : 'N/A' },
        { label:'🔊 Audio',               value:r.scores.audio!=null    ? `${r.scores.audio}% — ${r.audioDetails}`    : `Skipped (${r.audioReason||'N/A'})` },
        { label:'☁️ LLaVA + LLaMA',      value:r.scores.llava!=null    ? `${r.scores.llava}% — ${r.llavaDetails}`    : 'Not available' },
        { label:'🔗 Combined rules',    value:r.combos.length>0 ? r.combos.map(c=>`${c.label} ${c.boost}`).join(' · ') : 'None' },
        { label:'🎞 Anomalies',           value:`${ev.length} detected` },
    ];
    const rowsEl=document.getElementById('vdDetailRows'); rowsEl.innerHTML='';
    rows.forEach((row,i)=>{ setTimeout(()=>{ const d=document.createElement('div'); d.className='vd-detail-row'; d.innerHTML=`<span class="vd-detail-label">${row.label}</span><span class="vd-detail-value">${row.value}</span>`; rowsEl.appendChild(d); }, i*55); });

    resultEl.scrollIntoView({behavior:'smooth',block:'nearest'});
    vdToast(`// AI probability: ${p}% — ${r.confidence}`);
}

// ─── Frame extraction ─────────────────────────────────────────
function extractFrames(file, count, mode='sparse') {
    return new Promise((resolve,reject)=>{
        const video=document.createElement('video'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true}),url=URL.createObjectURL(file),frames=[];
        video.preload='auto'; video.muted=true; video.playsInline=true;
        video.onloadedmetadata=()=>{
            const dur=video.duration;
            if(!isFinite(dur)||dur<=0){ URL.revokeObjectURL(url); reject(new Error('Invalid duration')); return; }
            let times;
            if(mode==='sparse'){ const s=Math.min(2,dur*0.05),e=Math.max(s+1,dur-Math.min(2,dur*0.05)); times=Array.from({length:count},(_,i)=>s+i*(e-s)/(count-1)); }
            else { const wd=Math.min(VD_CONFIG.temporalWindowSec,dur*0.25),ws=Math.max(1,dur*0.45-wd/2); times=Array.from({length:count},(_,i)=>ws+i*wd/(count-1)); }
            let idx=0;
            const seek=()=>{ if(idx>=times.length){ URL.revokeObjectURL(url); video.src=''; resolve(frames); return; } video.currentTime=times[idx]; };
            video.onseeked=()=>{
                const sc=Math.min(1,640/video.videoWidth); canvas.width=Math.round(video.videoWidth*sc); canvas.height=Math.round(video.videoHeight*sc);
                ctx.drawImage(video,0,0,canvas.width,canvas.height);
                frames.push({dataUrl:canvas.toDataURL('image/jpeg',VD_CONFIG.frameJpegQuality),timestamp:times[idx],width:canvas.width,height:canvas.height,imageData:ctx.getImageData(0,0,canvas.width,canvas.height)});
                idx++; seek();
            };
            video.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('Decoding error')); };
            seek();
        };
        video.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('Loading error')); };
        video.src=url;
    });
}

function renderFrameStrip(frames) {
    const strip=document.getElementById('vdFrameStrip'); strip.innerHTML='';
    frames.forEach(f=>{ const img=Object.assign(document.createElement('img'),{className:'vd-frame-thumb',src:f.dataUrl,title:`t=${f.timestamp.toFixed(1)}s`}); strip.appendChild(img); });
}

function addStep(text) {
    const steps=document.getElementById('vdSteps'),div=document.createElement('div');
    div.className='vd-step active'; div.innerHTML=`<div class="vd-step-icon"><div class="vd-step-spinner"></div></div><span>${text}</span>`;
    steps.appendChild(div); return div;
}
function markStep(el,status,text) {
    el.className=`vd-step ${status==='error'?'error-s':'done'}`;
    el.innerHTML=`<div class="vd-step-icon"><i class="fas ${status==='done'?'fa-check':'fa-times'}" style="color:${status==='done'?VDC.neon:VDC.red};font-size:0.7rem;"></i></div><span>${text}</span>`;
}
function showVdError(msg) { const el=document.getElementById('vdError'); document.getElementById('vdErrorText').textContent=msg; if(el) el.style.display='flex'; setTimeout(()=>hideVdError(),6000); }
function hideVdError() { const el=document.getElementById('vdError'); if(el) el.style.display='none'; }
function vdToast(msg) {
    const t=document.createElement('div');
    t.style.cssText=`position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:${VDC.neon};color:${VDC.ink};padding:10px 22px;border-radius:4px;font-family:'Space Mono',monospace;font-size:0.72rem;font-weight:700;letter-spacing:0.05em;z-index:10000;box-shadow:0 0 20px rgba(0,245,160,0.4);white-space:nowrap;pointer-events:none;`;
    t.textContent=msg; document.body.appendChild(t);
    setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity 0.3s'; setTimeout(()=>t.remove(),300); },2800);
}
function formatDuration(s){ const m=Math.floor(s/60); return `${m}:${Math.round(s%60).toString().padStart(2,'0')}`; }

console.log('✅ VideoDetector V1.0 ready — AI Probability Analyzer (probabilistic, never binary)');
} // end initVideoDetector
