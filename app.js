/* ===== Z10R Camera System ===== */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {
    boot: $("boot"), openCamera: $("openCamera"), stage: $("stage"),
    video: $("viewfinder"), frame: $("frame"), ratioMask: $("ratioMask"),
    gridOverlay: $("gridOverlay"), gridBtn: $("gridBtn"),
    aiChip: $("aiChip"), aiChipText: $("aiChipText"), lensTag: $("lensTag"),
    reticle: $("reticle"), countdown: $("countdown"), portraitVeil: $("portraitVeil"),
    shutter: $("shutter"), swapBtn: $("swapBtn"),
    galleryBtn: $("galleryBtn"), gallery: $("gallery"), closeGallery: $("closeGallery"),
    galleryStrip: $("galleryStrip"), galleryEmpty: $("galleryEmpty"),
    shotFull: $("shotFull"), shotViewer: $("shotViewer"),
    downloadShot: $("downloadShot"), deleteShot: $("deleteShot"),
    lastShot: $("lastShot"), thumbEmpty: $("thumbEmpty"),
    camError: $("camError"), camErrorMsg: $("camErrorMsg"),
    retryCam: $("retryCam"), demoCam: $("demoCam"),
    flash: $("flash"), toast: $("toast"),
    timerStrip: $("timerStrip"), ratioStrip: $("ratioStrip"), filterStrip: $("filterStrip"),
    proPanel: $("proPanel"), proReadout: $("proReadout"),
    isoRange: $("isoRange"), isoVal: $("isoVal"),
    shutRange: $("shutRange"), shutVal: $("shutVal"),
    wbRange: $("wbRange"), wbVal: $("wbVal"),
    evRange: $("evRange"), evVal: $("evVal"),
    focusRange: $("focusRange"), focusVal: $("focusVal"),
    zoomRange: $("zoomRange"), zoomVal: $("zoomVal"),
    histBtn: $("histBtn"), spotBtn: $("spotBtn"), pngBtn: $("pngBtn"), proReset: $("proReset"),
    aiBtn: $("aiBtn"), wmBtn: $("wmBtn"),
    histogram: $("histogram"),
  };

  const SHUTTER_STOPS = [4000, 2000, 1000, 500, 250, 125, 60, 30, 15, 8, 4, 1]; // denominators, 1 = 1s
  const DEFAULT_PRO = { iso: 400, shutIdx: 6, wb: 5500, ev: 0, focusAuto: true, focusDist: 2.0, zoom: 1 };

  const state = {
    stream: null, facing: "environment", recording: false, recorder: null,
    chunks: [], timer: 0, ratio: "4:3", filter: "none", mode: "photo",
    shots: [], selected: -1, demo: false, lastClipUrl: null,
    pro: { ...DEFAULT_PRO }, sim: {}, // per-control APPLIED vs SIMULATED
    hist: false, histTimer: null, spot: false, spotHue: null, png: false,
    aiEnhance: true, watermark: false,
  };
  const FILTER_CSS = {
    none: "none",
    vivid: "saturate(1.5) contrast(1.12)",
    mono: "grayscale(1) contrast(1.1)",
    warm: "sepia(0.35) saturate(1.2)",
    cool: "saturate(1.15) contrast(1.05) brightness(1.04) hue-rotate(-10deg)",
    noir: "grayscale(1) contrast(1.55) brightness(0.9)",
    chrome: "saturate(1.8) contrast(1.2) brightness(1.05)",
    fade: "contrast(0.82) brightness(1.14) saturate(0.78)",
    pop: "saturate(2) contrast(1.3)",
    dusk: "sepia(0.45) hue-rotate(-20deg) saturate(1.4) contrast(1.1) brightness(0.95)",
  };
  const MODE_LABEL = { photo: "PHOTO", portrait: "PORTRAIT", night: "NIGHT", video: "VIDEO", pro: "PRO" };

  /* ---------- helpers ---------- */
  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 2200);
  }

  function track() {
    return state.stream ? state.stream.getVideoTracks()[0] : null;
  }

  function ratioInset(ratio) {
    const W = els.frame.clientWidth, H = els.frame.clientHeight;
    let w = W, h = H;
    if (ratio === "1:1") { w = Math.min(W, H); }
    else if (ratio === "4:3") { const t = Math.min(W, (H * 3) / 4); w = t; h = (t * 3) / 4; }
    else if (ratio === "16:9") { const t = Math.min(W, (H * 9) / 16); w = t; h = (t * 9) / 16; }
    const top = (H - h) / 2;
    return `inset(${top}px ${(W - w) / 2}px ${top}px ${(W - w) / 2}px round 8px)`;
  }
  function applyRatio() {
    els.ratioMask.style.clipPath = ratioInset(state.ratio);
  }

  /* ---------- preview filter composition (filters + simulated EV/ISO/zoom) ---------- */
  function updateVideoFilter() {
    const parts = [];
    const f = FILTER_CSS[state.filter];
    if (f && f !== "none") parts.push(f);
    if (state.mode === "night") parts.push("brightness(1.25) contrast(1.08)");
    if (state.mode === "pro") {
      // Simulated parts only when the device rejected the hardware constraint
      if (state.sim.iso) parts.push(`brightness(${Math.min(2.5, Math.max(0.35, state.pro.iso / 400)).toFixed(2)})`);
      if (state.sim.ev) parts.push(`brightness(${Math.pow(2, state.pro.ev * 0.5).toFixed(2)})`);
    }
    // AI Enhancer: sensor-level tone boost, identical on front and back cameras
    if (state.aiEnhance) parts.push("saturate(1.1) contrast(1.06) brightness(1.04)");
    els.video.style.filter = parts.length ? parts.join(" ") : "";
    els.video.style.transform = state.facing === "user" ? "scaleX(-1)" : "";
    const z = state.mode === "pro" && state.sim.zoom ? state.pro.zoom : 1;
    els.video.style.scale = z > 1 ? String(z) : "";
  }

  /* ---------- AI status chip ---------- */
  function updateAiChip() {
    if (!state.aiEnhance) {
      els.aiChipText.textContent = "AI OFF · RAW SENSOR";
      els.aiChip.classList.remove("live");
      return;
    }
    const feats = ["HDR", "ENHANCE"];
    if (state.mode === "pro") feats.push("PRO MANUAL");
    if (state.mode === "night") feats.push("NIGHT BOOST");
    if (state.mode === "portrait") feats.push("BOKEH");
    if (state.mode === "video") feats.push("EIS");
    if (state.filter !== "none") feats.push("AI TONE");
    els.aiChipText.textContent = "AI ON · " + feats.join(" · ");
    els.aiChip.classList.add("live");
  }

  /* ---------- Camera control ---------- */
  async function startCamera() {
    stopCamera();
    els.camError.classList.add("hidden");
    els.video.classList.remove("demo");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: state.facing,
          width: { ideal: 3840 }, height: { ideal: 2160 },
        },
        audio: state.mode === "video",
      });
      state.stream = stream;
      state.demo = false;
      els.video.srcObject = stream;
      els.video.classList.toggle("mirrored", state.facing === "user");
      updateLensTag();
      updateAiChip();
      updateVideoFilter();
      if (state.mode === "pro") applyPro(false);
      toast(state.facing === "user" ? "32MP FRONT · AI ON" : "50MP WIDE · OIS · AI ON");
    } catch (err) {
      state.stream = null;
      els.camErrorMsg.textContent = err && err.name === "NotAllowedError"
        ? "Permission denied. Allow camera access in your browser settings, or retry."
        : "No camera available on this device: " + (err && err.message ? err.message : "unknown error");
      els.camError.classList.remove("hidden");
    }
  }

  function stopCamera() {
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }

  function startDemo() {
    stopCamera();
    state.demo = true;
    els.camError.classList.add("hidden");
    const c = document.createElement("canvas");
    c.width = 1600; c.height = 1200;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 1600, 1200);
    grad.addColorStop(0, "#0C0E0D"); grad.addColorStop(1, "#2a2f2b");
    g.fillStyle = grad; g.fillRect(0, 0, 1600, 1200);
    g.fillStyle = "#FFB300";
    for (let i = 0; i < 40; i++) {
      g.globalAlpha = 0.15 + Math.random() * 0.5;
      g.beginPath();
      g.arc(Math.random() * 1600, Math.random() * 1200, 2 + Math.random() * 8, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    g.fillStyle = "#E9ECE9";
    g.font = "600 44px monospace";
    g.fillText("DEMO FRAME · 50MP WIDE", 80, 1100);
    els.video.srcObject = c.captureStream();
    els.video.classList.add("demo");
    els.video.classList.remove("mirrored");
    updateLensTag();
    updateAiChip();
    updateVideoFilter();
    if (state.mode === "pro") applyPro(false);
    toast("DEMO FRAME · NO CAMERA HARDWARE");
  }

  function updateLensTag() {
    const isFront = state.facing === "user";
    const res = isFront ? "32MP" : "50MP";
    els.lensTag.textContent = state.mode === "video"
      ? `${res} · 4K${isFront ? "" : " · OIS"}`
      : `${res}${isFront ? " · FRONT LENS" : " · OIS"}`;
  }

  /* ---------- PRO manual controls ---------- */
  function applyPro(announce) {
    const t = track();
    const p = state.pro;
    const sim = {};
    if (t && !state.demo) {
      const caps = t.getCapabilities ? t.getCapabilities() : {};
      const adv = [{}];
      if (caps.exposureMode && caps.exposureMode.includes("manual")) {
        adv[0].exposureMode = "manual";
        adv[0].exposureTime = Math.round((1 / SHUTTER_STOPS[p.shutIdx]) * 1e6); // microseconds
        adv[0].iso = p.iso;
      } else sim.iso = sim.shutter = true;
      if (caps.whiteBalanceMode && caps.whiteBalanceMode.includes("manual")) {
        adv[0].whiteBalanceMode = "manual";
        adv[0].colorTemperature = p.wb;
      } else sim.wb = true;
      if (caps.exposureCompensation && caps.exposureCompensation.min <= p.ev && p.ev <= caps.exposureCompensation.max) {
        adv[0].exposureCompensation = p.ev;
      } else sim.ev = true;
      if (caps.focusMode && caps.focusMode.includes("manual") && !p.focusAuto) {
        adv[0].focusMode = "manual";
        adv[0].focusDistance = p.focusDist;
      } else if (!p.focusAuto) sim.focus = true;
      if (caps.zoom && caps.zoom.min <= p.zoom && p.zoom <= caps.zoom.max) {
        adv[0].zoom = p.zoom;
      } else if (p.zoom > 1) sim.zoom = true;
      t.applyConstraints({ advanced: adv })
        .catch(() => { Object.assign(sim, { iso: true, shutter: true, wb: true, ev: true, focus: true, zoom: p.zoom > 1 }); })
        .finally(() => { state.sim = sim; renderPro(announce); });
      return;
    }
    // Demo or no track: everything simulated, honestly labelled
    state.sim = { iso: true, shutter: true, wb: true, ev: true, focus: !p.focusAuto, zoom: p.zoom > 1 };
    renderPro(announce);
  }

  function renderPro(announce) {
    const p = state.pro, s = state.sim;
    const den = SHUTTER_STOPS[p.shutIdx];
    const shutTxt = den === 1 ? "1s" : `1/${den}`;
    els.isoVal.textContent = p.iso;
    els.shutVal.textContent = shutTxt;
    els.wbVal.textContent = p.wb;
    els.evVal.textContent = p.ev.toFixed(1);
    els.focusVal.textContent = p.focusAuto ? "AUTO" : p.focusDist.toFixed(1) + "m";
    els.zoomVal.textContent = p.zoom.toFixed(1) + "x";
    const mark = (k) => s[k] ? '<span class="sim">SIM</span>' : "M";
    els.proReadout.innerHTML =
      `ISO ${p.iso} ${mark("iso")} · ${shutTxt} ${mark("shutter")} · ${p.wb}K ${mark("wb")}` +
      ` · EV ${p.ev.toFixed(1)} ${mark("ev")} · ZOOM ${p.zoom.toFixed(1)}x ${mark("zoom")}`;
    updateVideoFilter();
    if (announce) {
      const anySim = Object.values(s).some(Boolean);
      toast(anySim ? "PRO: PART SIMULATED (HARDWARE LIMIT)" : "PRO: APPLIED TO SENSOR");
    }
  }

  function resetPro() {
    state.pro = { ...DEFAULT_PRO };
    els.isoRange.value = state.pro.iso;
    els.shutRange.value = state.pro.shutIdx;
    els.wbRange.value = state.pro.wb;
    els.evRange.value = state.pro.ev;
    els.focusRange.value = 100;
    els.zoomRange.value = 100;
    applyPro(true);
  }

  /* ---------- Histogram ---------- */
  function drawHistogram() {
    const v = els.video;
    if (!v.videoWidth && !state.demo) return;
    const ctx = els.histogram.getContext("2d");
    const W = els.histogram.width, H = els.histogram.height;
    const off = document.createElement("canvas");
    off.width = 64; off.height = 48;
    const octx = off.getContext("2d", { willReadFrequently: true });
    octx.drawImage(v, 0, 0, 64, 48);
    const d = octx.getImageData(0, 0, 64, 48).data;
    const bins = new Array(32).fill(0);
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      bins[Math.min(31, Math.floor(l / 8))]++;
    }
    const max = Math.max(...bins, 1);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,179,0,0.9)";
    const bw = W / 32;
    bins.forEach((n, i) => {
      const h = (n / max) * (H - 4);
      ctx.fillRect(i * bw, H - h, bw - 1.5, h);
    });
  }

  /* ---------- Spot Color (Moto signature): keep only the sampled hue ---------- */
  function rgbToHue(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx === mn) return null;
    const d = mx - mn;
    let h;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return ((h * 60) + 360) % 360;
  }

  function sampleSpotHue() {
    const v = els.video;
    const off = document.createElement("canvas");
    off.width = 32; off.height = 32;
    const ctx = off.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, 32, 32);
    const d = ctx.getImageData(16, 16, 1, 1).data;
    const hue = rgbToHue(d[0], d[1], d[2]);
    if (hue === null) { toast("SPOT: SAMPLE HAS NO COLOR"); return; }
    state.spotHue = hue;
    toast(`SPOT COLOR: HUE ${Math.round(hue)}° — TAP A SUBJECT, THEN SHOOT`);
  }

  function applySpotColor(ctx, w, h) {
    if (!state.spot || state.spotHue === null) return;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      if (mx === mn) { d[i + 1] = 0; continue; }
      const hue = rgbToHue(d[i], d[i + 1], d[i + 2]);
      let diff = Math.abs(hue - state.spotHue);
      if (diff > 180) diff = 360 - diff;
      if (diff > 35) d[i + 1] = 0; // desaturate everything off-hue
    }
    ctx.putImageData(img, 0, 0);
  }

  /* ---------- Portrait bokeh: sharp subject oval, blurred background ---------- */
  function applyPortraitBokeh(g, w, h) {
    const blur = document.createElement("canvas");
    blur.width = w; blur.height = h;
    const bg = blur.getContext("2d");
    bg.filter = "blur(" + Math.max(10, Math.round(w / 160)) + "px) saturate(1.08)";
    bg.drawImage(g.canvas, 0, 0);
    bg.filter = "none";
    // Punch a soft oval hole in the blurred layer where the subject sits
    bg.globalCompositeOperation = "destination-out";
    const rx = w * 0.46, ry = h * 0.34;
    const gx = w / 2, gy = h * 0.42;
    const grad = bg.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0.34, "rgba(0,0,0,1)");
    grad.addColorStop(0.78, "rgba(0,0,0,0)");
    bg.save();
    bg.translate(gx, gy);
    bg.scale(rx, ry);
    bg.fillStyle = grad;
    bg.fillRect(-1, -1, 2, 2);
    bg.restore();
    bg.globalCompositeOperation = "source-over";
    g.drawImage(blur, 0, 0);
  }

  /* ---------- Shot on Z10R watermark (Moto-style stamp) ---------- */
  function stampWatermark(g, w, h) {
    const size = Math.max(18, Math.round(w / 34));
    g.save();
    g.font = `600 ${size}px ui-monospace, monospace`;
    g.textAlign = "right";
    g.textBaseline = "bottom";
    g.shadowColor = "rgba(0,0,0,0.6)";
    g.shadowBlur = size / 3;
    g.fillStyle = "rgba(255,255,255,0.92)";
    g.fillText("Shot on Z10R", w - size, h - size * 1.6);
    g.fillStyle = "rgba(255,179,0,0.95)";
    g.font = `500 ${Math.round(size * 0.62)}px ui-monospace, monospace`;
    g.fillText("50MP OIS · AI ENHANCED", w - size, h - size * 0.55);
    g.restore();
  }

  /* ---------- Capture ---------- */
  function capturePhoto() {
    const v = els.video;
    const sw = v.videoWidth || 1600, sh = v.videoHeight || 1200;
    // Zoom crop first (simulated zoom is baked, real zoom comes from the sensor)
    const z = state.mode === "pro" && state.sim.zoom ? state.pro.zoom : 1;
    const zw = Math.round(sw / z), zh = Math.round(sh / z);
    const zx = Math.round((sw - zw) / 2), zy = Math.round((sh - zh) / 2);
    // Ratio crop within the zoomed region
    const r = state.ratio.split(":").map(Number);
    const target = r[0] / r[1];
    let w = zw, h = zh;
    if (zw / zh > target) w = Math.round(zh * target); else h = Math.round(zw / target);
    const cx = zx + Math.round((zw - w) / 2), cy = zy + Math.round((zh - h) / 2);

    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: state.spot });
    if (state.facing === "user" && !state.demo) {
      g.translate(w, 0); g.scale(-1, 1);
    }
    const css = els.video.style.filter;
    g.filter = css && css !== "none" ? css : "none";
    g.drawImage(v, cx, cy, w, h, 0, 0, w, h);
    g.filter = "none";
    if (state.facing === "user") { g.translate(w, 0); g.scale(-1, 1); } // un-mirror for pixel work
    if (state.mode === "portrait") applyPortraitBokeh(g, w, h);
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (state.spot) applySpotColor(g, w, h);
    if (state.watermark) stampWatermark(g, w, h);
    const fmt = state.png && state.mode === "pro";
    const url = fmt ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.92);
    addShot(url, fmt ? "png" : "photo");
  }

  function flashFx() {
    els.flash.classList.remove("on");
    void els.flash.offsetWidth;
    els.flash.classList.add("on");
  }

  function startRecording() {
    if (!state.stream || state.demo) { toast("VIDEO NEEDS LIVE CAMERA"); return; }
    const mime = MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm";
    state.recorder = new MediaRecorder(state.stream, { mimeType: mime });
    state.chunks = [];
    state.recorder.ondataavailable = (e) => { if (e.data.size) state.chunks.push(e.data); };
    state.recorder.onstop = () => {
      const blob = new Blob(state.chunks, { type: mime });
      addShot(URL.createObjectURL(blob), "video");
    };
    state.recorder.start();
    state.recording = true;
    els.shutter.classList.add("recording");
    els.shutter.setAttribute("aria-label", "Stop recording");
    updateAiChip();
  }

  function stopRecording() {
    if (state.recorder && state.recording) state.recorder.stop();
    state.recording = false;
    els.shutter.classList.remove("recording");
    els.shutter.setAttribute("aria-label", "Shutter");
  }

  async function onShutter() {
    if (state.recording) { stopRecording(); toast("RECORDING SAVED"); return; }
    if (state.mode === "video") { startRecording(); toast("RECORDING… TAP TO STOP"); return; }
    if (state.timer > 0) {
      for (let n = state.timer; n > 0; n--) {
        els.countdown.textContent = n;
        els.countdown.classList.remove("hidden");
        await new Promise((r) => setTimeout(r, 1000));
      }
      els.countdown.classList.add("hidden");
    }
    flashFx();
    capturePhoto();
  }

  /* ---------- Gallery ---------- */
  function addShot(url, kind) {
    state.shots.unshift({ url, kind });
    state.selected = 0;
    renderGallery();
    updateThumb();
    toast(kind === "video" ? "VIDEO SAVED TO GALLERY"
      : kind === "png" ? "PNG LOSSLESS SAVED"
      : "SAVED TO GALLERY");
  }

  function updateThumb() {
    if (state.shots.length) {
      els.lastShot.src = state.shots[0].url;
      els.lastShot.hidden = false;
      els.thumbEmpty.hidden = true;
    } else {
      els.lastShot.hidden = true;
      els.thumbEmpty.hidden = false;
    }
  }

  function renderGallery() {
    els.galleryStrip.innerHTML = "";
    els.galleryEmpty.classList.toggle("hidden", state.shots.length > 0);
    state.shots.forEach((s, i) => {
      let el;
      if (s.kind === "video") {
        el = document.createElement("video");
        el.src = s.url; el.muted = true;
      } else {
        el = document.createElement("img");
        el.src = s.url; el.alt = `Capture ${i + 1}`;
      }
      el.className = i === state.selected ? "selected" : "";
      el.addEventListener("click", () => selectShot(i));
      els.galleryStrip.appendChild(el);
    });
    selectShot(state.shots.length ? Math.max(0, state.selected) : -1, true);
  }

  function selectShot(i, quiet) {
    state.selected = i;
    const has = i >= 0 && i < state.shots.length;
    els.shotFull.hidden = !has;
    els.downloadShot.disabled = !has;
    els.deleteShot.disabled = !has;
    if (has) {
      els.shotFull.src = state.shots[i].url;
      [...els.galleryStrip.children].forEach((el, j) => el.classList.toggle("selected", j === i));
    }
    if (!quiet) {
      [...els.galleryStrip.children].forEach((el, j) => el.classList.toggle("selected", j === i));
    }
  }

  function openGallery() {
    renderGallery();
    els.gallery.classList.remove("hidden");
  }
  function closeGallery() {
    els.gallery.classList.add("hidden");
    els.shotFull.removeAttribute("src");
  }

  /* ---------- events ---------- */
  els.openCamera.addEventListener("click", () => {
    els.boot.classList.add("hidden");
    els.stage.classList.remove("hidden");
    applyRatio();
    startCamera();
  });

  els.retryCam.addEventListener("click", startCamera);
  els.demoCam.addEventListener("click", startDemo);

  els.swapBtn.addEventListener("click", () => {
    if (state.recording) { toast("STOP RECORDING FIRST"); return; }
    state.facing = state.facing === "environment" ? "user" : "environment";
    if (state.demo) { startDemo(); } else { startCamera(); }
  });

  els.shutter.addEventListener("click", onShutter);

  els.video.addEventListener("click", (e) => {
    if (e.target.closest(".rail") || e.target.closest(".topbar") || e.target.closest(".pro-panel")) return;
    const r = els.frame.getBoundingClientRect();
    els.reticle.style.left = (e.clientX - r.left) + "px";
    els.reticle.style.top = (e.clientY - r.top) + "px";
    els.reticle.classList.remove("hidden");
    const el = els.reticle;
    el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add("hidden"), 900);
    if (state.mode === "pro" && state.spot && !state.demo) sampleSpotHue();
  });

  els.timerStrip.addEventListener("click", (e) => {
    const b = e.target.closest("[data-timer]");
    if (!b) return;
    state.timer = Number(b.dataset.timer);
    [...els.timerStrip.children].forEach((x) => x.classList.toggle("active", x === b));
  });

  els.ratioStrip.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ratio]");
    if (!b) return;
    state.ratio = b.dataset.ratio;
    els.ratioMask.dataset.ratio = state.ratio;
    [...els.ratioStrip.children].forEach((x) => x.classList.toggle("active", x === b));
    applyRatio();
  });

  els.filterStrip.addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    state.filter = b.dataset.filter;
    [...els.filterStrip.children].forEach((x) => x.classList.toggle("active", x === b));
    updateVideoFilter();
    updateAiChip();
  });

  els.gridBtn.addEventListener("click", () => {
    els.gridOverlay.classList.toggle("hidden");
    els.gridBtn.classList.toggle("active");
  });

  els.aiBtn.addEventListener("click", () => {
    state.aiEnhance = !state.aiEnhance;
    els.aiBtn.classList.toggle("active", state.aiEnhance);
    els.aiBtn.setAttribute("aria-pressed", String(state.aiEnhance));
    updateVideoFilter();
    updateAiChip();
    toast(state.aiEnhance ? "AI ENHANCER ON (FRONT + BACK)" : "AI ENHANCER OFF · RAW SENSOR");
  });

  els.wmBtn.addEventListener("click", () => {
    state.watermark = !state.watermark;
    els.wmBtn.classList.toggle("active", state.watermark);
    els.wmBtn.setAttribute("aria-pressed", String(state.watermark));
    toast(state.watermark ? "SHOT ON Z10R WATERMARK ON" : "WATERMARK OFF");
  });

  document.querySelector(".modes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b) return;
    if (state.recording) { toast("STOP RECORDING FIRST"); return; }
    state.mode = b.dataset.mode;
    document.querySelectorAll(".mode-btn").forEach((x) => {
      const on = x === b;
      x.classList.toggle("active", on);
      x.setAttribute("aria-selected", String(on));
    });
    const pro = state.mode === "pro";
    els.proPanel.classList.toggle("hidden", !pro);
    els.portraitVeil.classList.toggle("hidden", state.mode !== "portrait");
    if (pro) {
      applyPro(true);
      els.histBtn.click();
    } else {
      clearInterval(state.histTimer);
      // release manual controls back to the sensor
      const t = track();
      if (t) t.applyConstraints({ advanced: [{ exposureMode: "continuous", whiteBalanceMode: "continuous", focusMode: "continuous" }] }).catch(() => {});
    }
    if ((state.stream || state.demo) && state.mode === "video" && !state.demo) startCamera();
    else updateLensTag();
    updateVideoFilter();
    updateAiChip();
    toast(MODE_LABEL[state.mode] + (pro ? " · MANUAL CONTROLS ON" : " · AI ON"));
  });

  /* Pro slider inputs */
  const proInput = (el, fn) => el.addEventListener("input", () => { fn(); renderPro(false); });
  proInput(els.isoRange, () => { state.pro.iso = Number(els.isoRange.value); });
  proInput(els.shutRange, () => { state.pro.shutIdx = Number(els.shutRange.value); });
  proInput(els.wbRange, () => { state.pro.wb = Number(els.wbRange.value); });
  proInput(els.evRange, () => { state.pro.ev = Number(els.evRange.value); });
  proInput(els.focusRange, () => {
    const v = Number(els.focusRange.value);
    state.pro.focusAuto = v >= 100;
    state.pro.focusDist = v / 10;
  });
  proInput(els.zoomRange, () => { state.pro.zoom = Number(els.zoomRange.value) / 100; });

  ["isoRange", "shutRange", "wbRange", "evRange", "focusRange", "zoomRange"].forEach((id) => {
    els[id].addEventListener("change", () => applyPro(true));
  });

  els.histBtn.addEventListener("click", () => {
    state.hist = !state.hist;
    els.histBtn.setAttribute("aria-pressed", String(state.hist));
    els.histogram.classList.toggle("hidden", !state.hist);
    clearInterval(state.histTimer);
    if (state.hist) state.histTimer = setInterval(drawHistogram, 150);
  });

  els.spotBtn.addEventListener("click", () => {
    state.spot = !state.spot;
    els.spotBtn.setAttribute("aria-pressed", String(state.spot));
    if (state.spot) { sampleSpotHue(); } else { state.spotHue = null; toast("SPOT COLOR OFF"); }
  });

  els.pngBtn.addEventListener("click", () => {
    state.png = !state.png;
    els.pngBtn.setAttribute("aria-pressed", String(state.png));
    toast(state.png ? "PNG LOSSLESS CAPTURE ON" : "JPEG CAPTURE");
  });

  els.proReset.addEventListener("click", resetPro);

  els.galleryBtn.addEventListener("click", openGallery);
  els.closeGallery.addEventListener("click", closeGallery);
  els.gallery.addEventListener("click", (e) => {
    if (e.target === els.gallery) closeGallery();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.gallery.classList.contains("hidden")) closeGallery();
  });

  els.downloadShot.addEventListener("click", () => {
    const s = state.shots[state.selected];
    if (!s) return;
    const a = document.createElement("a");
    a.href = s.url;
    a.download = s.kind === "video" ? "z10r-capture.webm"
      : s.kind === "png" ? "z10r-capture.png" : "z10r-capture.jpg";
    a.click();
  });

  els.deleteShot.addEventListener("click", () => {
    if (state.selected < 0) return;
    state.shots.splice(state.selected, 1);
    state.selected = Math.min(state.selected, state.shots.length - 1);
    renderGallery();
    updateThumb();
  });

  window.addEventListener("resize", applyRatio);
  updateAiChip();
})();
