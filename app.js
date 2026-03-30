// ========== CONFIGURATION ==========
const CLOUDFLARE_CONFIG = {
    workerUrl: "https://ai-detective.dragonetechnology.workers.dev",
    enabled: true,
    model: "llava"
};

// ========== DOM ELEMENTS ==========
const uploadBtn           = document.getElementById('uploadBtn');
const imageInput          = document.getElementById('imageInput');
const uploadArea          = document.getElementById('uploadArea');
const previewContainer    = document.getElementById('previewContainer');
const imagePreview        = document.getElementById('imagePreview');
const removeBtn           = document.getElementById('removeImage');
const analyzeBtn          = document.getElementById('analyzeBtn');
const resultContainer     = document.getElementById('resultContainer');
const scoreValue          = document.getElementById('scoreValue');
const verdict             = document.getElementById('verdict');
const verdictIcon         = document.getElementById('verdictIcon');
const verdictCard         = document.getElementById('verdictCard');
const detailsList         = document.getElementById('detailsList');
const errorMessage        = document.getElementById('errorMessage');
const errorText           = document.getElementById('errorText');
const ringFill            = document.querySelector('.ring-fill');
const modelStatus         = document.getElementById('modelStatus');
const tfScoreSpan         = document.getElementById('tfScore');
const cloudflareScoreSpan = document.getElementById('cloudflareScore');
const pixelScoreSpan      = document.getElementById('pixelScore');

let currentImageFile = null;
let mobilenetModel   = null;
let analysisResults  = { tensorflow: null, cloudflare: null, pixel: null };

// ========== DESIGN TOKENS (matches forensic CSS) ==========
const COLORS = {
    neon:  '#00F5A0',
    amber: '#FFB547',
    red:   '#FF4D6D',
    green: '#39D98A',
    ink:   '#080C10',
    txt3:  '#4D5E72',
};

// ========== INJECT DYNAMIC STYLES ==========
const style = document.createElement('style');
style.textContent = `
    .drag-over {
        border-color: ${COLORS.neon} !important;
        background: rgba(0,245,160,0.06) !important;
        transform: scale(1.01);
    }

    .toast-msg {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(0);
        background: ${COLORS.neon};
        color: ${COLORS.ink};
        padding: 10px 22px;
        border-radius: 4px;
        font-family: 'Space Mono', monospace;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        z-index: 10000;
        box-shadow: 0 0 20px rgba(0,245,160,0.4);
        white-space: nowrap;
        pointer-events: none;
        animation: toastIn 0.3s ease forwards;
    }

    .toast-msg.error {
        background: ${COLORS.red};
        box-shadow: 0 0 20px rgba(255,77,109,0.4);
        color: #fff;
    }

    .toast-msg.out { animation: toastOut 0.3s ease forwards; }

    @keyframes toastIn  {
        from { opacity:0; transform:translateX(-50%) translateY(12px); }
        to   { opacity:1; transform:translateX(-50%) translateY(0); }
    }
    @keyframes toastOut {
        from { opacity:1; transform:translateX(-50%) translateY(0); }
        to   { opacity:0; transform:translateX(-50%) translateY(12px); }
    }
    @keyframes dotPulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

    .detail-item { transition: border-color 0.2s, opacity 0.3s, transform 0.3s; }
`;
document.head.appendChild(style);

// ========== UTILITIES ==========

function updateModelStatus(elementId, status) {
    const el  = document.getElementById(elementId);
    if (!el) return;
    const dot = el.querySelector('.status-dot');
    if (!dot) return;

    dot.className    = 'status-dot';
    dot.style.animation = 'none';
    dot.style.boxShadow = 'none';

    const cfg = {
        loading:  { cls: 'loading', color: COLORS.amber, anim: 'dotPulse 0.8s ease-in-out infinite' },
        ready:    { cls: 'ready',   color: COLORS.neon,  shadow: `0 0 6px ${COLORS.neon}` },
        error:    { cls: 'error',   color: COLORS.red  },
        disabled: { cls: 'disabled',color: COLORS.txt3 },
    }[status] || { cls: 'disabled', color: COLORS.txt3 };

    dot.classList.add(cfg.cls);
    dot.style.background = cfg.color;
    if (cfg.anim)   dot.style.animation  = cfg.anim;
    if (cfg.shadow) dot.style.boxShadow  = cfg.shadow;
}

function showError(message) {
    if (errorText)    errorText.textContent    = message;
    if (errorMessage) {
        errorMessage.style.display = 'flex';
        setTimeout(() => { errorMessage.style.display = 'none'; }, 5000);
    }
    showToast(`⚠ ${message}`, 'error');
}

function hideError() {
    if (errorMessage) errorMessage.style.display = 'none';
}

function showToast(message, type = 'success') {
    const t = document.createElement('div');
    t.className   = `toast-msg${type === 'error' ? ' error' : ''}`;
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => {
        t.classList.add('out');
        setTimeout(() => t.remove(), 300);
    }, 2800);
}

function animateValue(element, start, end, duration) {
    if (!element) return;
    const startTime = performance.now();
    const tick = (now) => {
        const p    = Math.min((now - startTime) / duration, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        element.textContent = Math.floor(start + (end - start) * ease);
        if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

function calculateSmartFallback(imageFile) {
    const sizeKB   = imageFile.size / 1024;
    const fileName = imageFile.name.toLowerCase();
    let score = 50;
    const aiPatterns = ['ai','generated','dalle','midjourney','stable','diffusion','artificial'];
    if (aiPatterns.some(p => fileName.includes(p))) score += 25;
    if (sizeKB < 50)                                score += 20;
    else if (sizeKB > 100 && sizeKB < 5000)        score -= 10;
    else if (sizeKB > 10000)                        score += 15;
    return Math.min(100, Math.max(0, score));
}

// ========== IMAGE RESIZE ==========
// Uses toDataURL() to avoid Android auto-download bug (download.bin)
function resizeImageForAI(file) {
    return new Promise((resolve) => {
        const img       = new Image();
        const canvas    = document.createElement('canvas');
        const ctx       = canvas.getContext('2d');
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            let { width, height } = img;
            const maxSize = 800;
            if (width  > maxSize) { height = (height * maxSize) / width;  width  = maxSize; }
            if (height > maxSize) { width  = (width  * maxSize) / height; height = maxSize; }

            canvas.width  = Math.round(width);
            canvas.height = Math.round(height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const dataUrl    = canvas.toDataURL('image/jpeg', 0.85);
            const base64Data = dataUrl.split(',')[1];
            const byteStr    = atob(base64Data);
            const ab         = new ArrayBuffer(byteStr.length);
            const ia         = new Uint8Array(ab);
            for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
            const blob = new Blob([ab], { type: 'image/jpeg' });

            URL.revokeObjectURL(objectUrl);
            console.log(`🖼 Resized: ${canvas.width}x${canvas.height} — ${(blob.size/1024).toFixed(1)}KB`);
            resolve(blob);
        };

        img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
        img.src = objectUrl;
    });
}

// ========== TENSORFLOW LOAD ==========
async function loadTensorFlowModel() {
    try {
        updateModelStatus('tensorflowStatus', 'loading');
        mobilenetModel = await mobilenet.load();
        updateModelStatus('tensorflowStatus', 'ready');
        console.log('✅ TensorFlow.js loaded');
        return true;
    } catch (err) {
        console.error('❌ TensorFlow error:', err);
        updateModelStatus('tensorflowStatus', 'error');
        return false;
    }
}

// ========== TENSORFLOW ANALYSIS ==========
async function analyzeWithTensorFlow(imageFile) {
    if (!mobilenetModel) return { score: 50, confidence: 0, details: 'Model unavailable' };

    return new Promise((resolve) => {
        const img       = new Image();
        const objectUrl = URL.createObjectURL(imageFile);

        img.onload = async () => {
            try {
                const predictions  = await mobilenetModel.classify(img);
                const aiKeywords   = ['drawing','art','cartoon','illustration','painting','digital art','render','3d','animation','sketch'];
                const realKeywords = ['photo','photograph','portrait','landscape','nature','person','animal'];

                let aiScore = 50;
                const top   = predictions[0];

                predictions.forEach(pred => {
                    const cls = pred.className.toLowerCase();
                    if (aiKeywords.some(k   => cls.includes(k))) aiScore += 25;
                    if (realKeywords.some(k => cls.includes(k))) aiScore -= 20;
                });

                if (top.probability > 0.8) aiScore = Math.min(100, Math.max(0, aiScore));

                URL.revokeObjectURL(objectUrl);
                resolve({ score: aiScore, confidence: top.probability * 100, details: `Classified as: ${top.className}` });
            } catch {
                URL.revokeObjectURL(objectUrl);
                resolve({ score: 50, confidence: 0, details: 'Analysis error' });
            }
        };

        img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve({ score: 50, confidence: 0, details: 'Load error' }); };
        img.src = objectUrl;
    });
}

// ========== CLOUDFLARE AI (LLaVA) ==========
async function analyzeWithCloudflareAI(imageFile) {
    if (!CLOUDFLARE_CONFIG.enabled || !CLOUDFLARE_CONFIG.workerUrl) {
        updateModelStatus('cloudflareStatus', 'disabled');
        return { score: 50, confidence: 0, details: 'API not configured', fallback: true };
    }

    updateModelStatus('cloudflareStatus', 'loading');

    try {
        let processedFile = imageFile;
        if (imageFile.size > 800 * 1024) {
            console.log('🖼 Resizing for LLaVA…');
            processedFile = await resizeImageForAI(imageFile);
        }

        const base64Image = await new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload  = (e) => { const r = e.target.result; res(r.includes(',') ? r.split(',')[1] : r); };
            reader.onerror = () => rej(new Error('File read failed'));
            reader.readAsDataURL(processedFile);
        });

        console.log(`📡 Sending to Worker (${base64Image.length} chars)…`);

        const response = await fetch(CLOUDFLARE_CONFIG.workerUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ image: base64Image, model: CLOUDFLARE_CONFIG.model }),
        });

        if (!response.ok) {
            const errBody = await response.text();
            console.error('❌ Worker error:', errBody);
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('✅ Cloudflare AI response:', data);

        let description = '';
        if (data.result) {
            if (data.result.description)              description = data.result.description;
            else if (data.result.response)            description = data.result.response;
            else if (typeof data.result === 'string') description = data.result;
        }
        if (!description && data.error) throw new Error(data.error);

        console.log('📝 LLaVA:', description);

        const lower = description.toLowerCase();
        const aiKeywords   = ['ai-generated','generated by ai','ai generated','artificial intelligence','digital art','computer generated','synthetic','not real','ai image','synthetic image','fake image','generated image'];
        const realKeywords = ['real photograph','authentic','realistic','natural','real photo','taken with a camera','genuine','real image','photograph','realistic photograph','actual photo'];

        let explicitVerdict = null;
        if (lower.startsWith('real') || (lower.includes('real') && !lower.includes('not real'))) explicitVerdict = 'real';
        if (lower.startsWith('ai')   || lower.includes('ai-generated') || lower.includes('generated')) explicitVerdict = 'ai';

        let aiMatchCount = 0, realMatchCount = 0;
        aiKeywords.forEach(k   => { if (lower.includes(k)) { aiMatchCount++;   console.log(`🔍 AI keyword: "${k}"`); } });
        realKeywords.forEach(k => { if (lower.includes(k)) { realMatchCount++; console.log(`📸 Real keyword: "${k}"`); } });

        let aiScore = 50, confidence = 50;
        if      (explicitVerdict === 'ai')       { aiScore = 85; confidence = 80; }
        else if (explicitVerdict === 'real')      { aiScore = 20; confidence = 80; }
        else if (aiMatchCount > realMatchCount)   { aiScore = 70 + Math.min(30, aiMatchCount * 5); confidence = 70; }
        else if (realMatchCount > aiMatchCount)   { aiScore = Math.max(15, 50 - (realMatchCount - aiMatchCount) * 10); confidence = 70; }

        aiScore = Math.min(100, Math.max(0, Math.round(aiScore)));

        const shortDetails = description.length > 150 ? description.substring(0, 147) + '…' : description;

        updateModelStatus('cloudflareStatus', 'ready');
        return { score: aiScore, confidence, details: shortDetails, fullDescription: description };

    } catch (err) {
        console.error('❌ Cloudflare AI error:', err);
        updateModelStatus('cloudflareStatus', 'error');
        return { score: calculateSmartFallback(imageFile), confidence: 30, details: 'Degraded mode (Cloudflare unavailable)', fallback: true };
    }
}

// ========== PIXEL ANALYSIS ==========
async function analyzePixels(imageFile) {
    updateModelStatus('localStatus', 'loading');

    return new Promise((resolve) => {
        const img       = new Image();
        const canvas    = document.createElement('canvas');
        const ctx       = canvas.getContext('2d');
        const objectUrl = URL.createObjectURL(imageFile);

        img.onload = () => {
            canvas.width  = Math.min(img.width,  800);
            canvas.height = Math.min(img.height, 800);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

            // Compression uniformity
            let compressionScore = 0;
            for (let i = 0; i < data.length; i += 64) {
                const unique = new Set();
                for (let j = 0; j < 16 && i + j * 4 < data.length; j++)
                    unique.add(`${data[i+j*4]},${data[i+j*4+1]},${data[i+j*4+2]}`);
                if (unique.size < 3) compressionScore++;
            }
            const compression = Math.min(100, (compressionScore / 100) * 100);

            // Noise level
            let totalVar = 0;
            for (let i = 0; i < data.length - 4; i += 4)
                totalVar += Math.abs(data[i]-data[i+4]) + Math.abs(data[i+1]-data[i+5]) + Math.abs(data[i+2]-data[i+6]);
            const noiseLevel = totalVar / (data.length / 4);
            const noise = noiseLevel < 30 ? 70 : noiseLevel > 150 ? 65 : 30;

            // Block artifacts
            let artifactScore = 0;
            for (let y = 0; y < canvas.height - 8; y += 8) {
                for (let x = 0; x < canvas.width - 8; x += 8) {
                    const pattern = [];
                    for (let dy = 0; dy < 8; dy++)
                        for (let dx = 0; dx < 8; dx++) {
                            const idx = ((y+dy)*canvas.width+(x+dx))*4;
                            if (idx < data.length) pattern.push(data[idx]);
                        }
                    if (pattern.every(v => v === pattern[0])) artifactScore++;
                }
            }
            const artifacts = Math.min(100, (artifactScore / 50) * 100);

            const pixelScore = Math.min(100, Math.max(0, compression*0.35 + noise*0.35 + artifacts*0.30));

            const details = [];
            if (compression > 60) details.push('Excessive compression');
            if (noise       > 50) details.push('Abnormal noise');
            if (artifacts   > 40) details.push('Artifacts detected');

            URL.revokeObjectURL(objectUrl);
            updateModelStatus('localStatus', 'ready');
            resolve({ score: Math.round(pixelScore), details: details.length ? details.join(', ') : 'Normal analysis' });
        };

        img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve({ score: 50, details: 'Pixel analysis error' }); };
        img.src = objectUrl;
    });
}

// ========== UPLOAD HANDLERS ==========
if (uploadBtn) uploadBtn.addEventListener('click', () => imageInput.click());

if (uploadArea) {
    uploadArea.addEventListener('click', (e) => {
        if (e.target !== uploadBtn && !uploadBtn.contains(e.target)) imageInput.click();
    });
    uploadArea.addEventListener('dragover',  (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
    uploadArea.addEventListener('dragleave', ()  => uploadArea.classList.remove('drag-over'));
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    });
}

if (imageInput) imageInput.addEventListener('change', (e) => { if (e.target.files.length > 0) handleFile(e.target.files[0]); });

if (removeBtn) {
    removeBtn.addEventListener('click', () => {
        currentImageFile               = null;
        imageInput.value               = '';
        previewContainer.style.display = 'none';
        uploadArea.style.display       = 'block';
        analyzeBtn.disabled            = true;
        resultContainer.style.display  = 'none';
        hideError();
    });
}

function handleFile(file) {
    if (!file.type.startsWith('image/')) { showError('Please select a valid image file'); return; }
    if (file.size > 10 * 1024 * 1024)   { showError('File too large (max 10 MB)');       return; }

    currentImageFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
        imagePreview.src               = e.target.result;
        previewContainer.style.display = 'block';
        uploadArea.style.display       = 'none';
        analyzeBtn.disabled            = false;
        resultContainer.style.display  = 'none';
        hideError();
        showToast('// Image loaded');
    };
    reader.readAsDataURL(file);
}

// ========== MAIN ANALYSIS ==========
if (analyzeBtn) {
    analyzeBtn.addEventListener('click', async () => {
        if (!currentImageFile) { showError('Please select an image first'); imageInput.click(); return; }
        await startMultiModelAnalysis();
    });
}

async function startMultiModelAnalysis() {
    console.log('🚀 Starting multi-model analysis');

    analyzeBtn.disabled = true;
    analyzeBtn.classList.add('loading');
    if (modelStatus)     modelStatus.style.display    = 'flex';
    if (resultContainer) resultContainer.style.display = 'none';
    hideError();

    if (tfScoreSpan)          tfScoreSpan.textContent         = '…';
    if (cloudflareScoreSpan)  cloudflareScoreSpan.textContent = '…';
    if (pixelScoreSpan)       pixelScoreSpan.textContent      = '…';

    const [tfResult, cfResult, pxResult] = await Promise.all([
        analyzeWithTensorFlow(currentImageFile),
        analyzeWithCloudflareAI(currentImageFile),
        analyzePixels(currentImageFile),
    ]);

    analysisResults.tensorflow = tfResult;
    analysisResults.cloudflare = cfResult;
    analysisResults.pixel      = pxResult;

    if (tfScoreSpan)          tfScoreSpan.textContent         = `${tfResult.score}%`;
    if (cloudflareScoreSpan)  cloudflareScoreSpan.textContent = `${cfResult.score}%`;
    if (pixelScoreSpan)       pixelScoreSpan.textContent      = `${pxResult.score}%`;

    // Weighted final score — TF 30% · LLaVA 50% · Pixel 20%
    const finalScore = Math.round(
        tfResult.score * 0.30 +
        cfResult.score * 0.50 +
        pxResult.score * 0.20
    );

    displayMultiModelResults(finalScore, analysisResults);

    analyzeBtn.classList.remove('loading');
    analyzeBtn.disabled = false;
}

// ========== RESULT DISPLAY ==========
function displayMultiModelResults(finalScore, results) {

    // Score ring
    if (ringFill) {
        const circ = 2 * Math.PI * 67;   // r=67 → ≈ 421
        ringFill.style.strokeDasharray  = circ;
        ringFill.style.strokeDashoffset = circ;
        setTimeout(() => { ringFill.style.strokeDashoffset = circ - (finalScore / 100) * circ; }, 50);
        ringFill.classList.remove('danger', 'warning', 'safe');
        if      (finalScore > 70) ringFill.classList.add('danger');
        else if (finalScore > 35) ringFill.classList.add('warning');
        else                      ringFill.classList.add('safe');
    }

    // Animated number
    if (scoreValue) animateValue(scoreValue, 0, finalScore, 1200);

    // 5-level verdict
    const levels = [
        { max: 25,  icon: 'fa-circle-check',       title: '✅ Authentic image',      sub: 'All indicators point to a real photograph. No AI generation artifacts detected.',                                                 css: 'verdict-safe',    color: COLORS.green },
        { max: 45,  icon: 'fa-circle-question',    title: '🟢 Likely authentic',     sub: 'Signals are mostly natural, but minor uncertainties remain. Verification recommended for critical use.',                           css: 'verdict-safe',    color: COLORS.green },
        { max: 60,  icon: 'fa-circle-exclamation', title: '🟡 Ambiguous result',     sub: 'Mixed signals — the image could be real or AI-generated. Check individual model scores for more detail.',                          css: 'verdict-warning', color: COLORS.amber },
        { max: 80,  icon: 'fa-triangle-exclamation',title:'🟠 Likely AI-generated',  sub: 'Several indicators typical of synthetic images were detected. Strong suspicion of AI generation.',                                 css: 'verdict-danger',  color: COLORS.red   },
        { max: 100, icon: 'fa-circle-radiation',   title: '🔴 AI image confirmed',   sub: 'All models agree: this image was generated by an AI. Artifacts, textures and structure all confirm the verdict.',                  css: 'verdict-danger',  color: COLORS.red   },
    ];

    const level = levels.find(l => finalScore <= l.max) || levels[levels.length - 1];

    if (verdict)     verdict.textContent   = level.title;
    if (verdictIcon) verdictIcon.innerHTML = `<i class="fas ${level.icon}" style="color:${level.color};font-size:1.5rem;"></i>`;
    if (verdictCard) verdictCard.className = `verdict-premium ${level.css}`;

    const verdictSub = document.getElementById('verdictSub');
    if (verdictSub) verdictSub.textContent = level.sub;

    // Confidence bars
    const setBar = (fillId, valId, score) => {
        const fill = document.getElementById(fillId);
        const val  = document.getElementById(valId);
        if (fill) setTimeout(() => { fill.style.width = score + '%'; }, 200);
        if (val)  val.textContent = score + '%';
    };
    setBar('cbFillTf', 'cbTf', results.tensorflow.score);
    setBar('cbFillCf', 'cbCf', results.cloudflare.score);
    setBar('cbFillPx', 'cbPx', results.pixel.score);

    // Detail rows
    if (detailsList) detailsList.innerHTML = '';

    let llavaDetails = `${results.cloudflare.score}% — `;
    llavaDetails += results.cloudflare.fullDescription
        ? (results.cloudflare.fullDescription.length > 180
            ? results.cloudflare.fullDescription.substring(0, 177) + '…'
            : results.cloudflare.fullDescription)
        : results.cloudflare.details;

    const rows = [
        { label: '🤖 TensorFlow.js',      value: `${results.tensorflow.score}% — ${results.tensorflow.details}` },
        { label: '☁️ LLaVA · Cloudflare', value: llavaDetails },
        { label: '🔍 Pixel Analysis',      value: `${results.pixel.score}% — ${results.pixel.details}` },
        { label: '⚖️ Weighting',           value: 'TF 30% · LLaVA 50% · Pixel 20%' },
        { label: '🎯 Final score',          value: `${finalScore}% AI probability` },
        { label: '🧠 Mode',                value: results.cloudflare.fallback ? 'Degraded (LLaVA unavailable)' : 'Full (3 models active)' },
    ];

    rows.forEach((row, i) => {
        setTimeout(() => {
            const d = document.createElement('div');
            d.className       = 'detail-item';
            d.style.opacity   = '0';
            d.style.transform = 'translateX(-10px)';
            d.innerHTML = `<span class="detail-label">${row.label}</span><span class="detail-value">${row.value}</span>`;
            if (detailsList) detailsList.appendChild(d);
            setTimeout(() => { d.style.opacity = '1'; d.style.transform = 'translateX(0)'; }, 40);
        }, i * 80);
    });

    // Show panel
    if (resultContainer) {
        resultContainer.style.display = 'block';
        setTimeout(() => resultContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    }

    showToast('// Analysis complete');
}

// ========== INIT ==========
loadTensorFlowModel();

document.querySelectorAll('#scrollToDetector, #navCtaBtn').forEach(btn => {
    if (btn) btn.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('detector')?.scrollIntoView({ behavior: 'smooth' });
    });
});

console.log('✅ AI Detective ready');
console.log('☁️ Cloudflare Worker:', CLOUDFLARE_CONFIG.workerUrl);
