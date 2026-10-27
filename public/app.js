'use strict';

(function () {
  const $ = function (selector, root) { return (root || document).querySelector(selector); };
  const $$ = function (selector, root) { return Array.from((root || document).querySelectorAll(selector)); };

  const canvas = $('#visualizer');
  const ctx = canvas.getContext('2d', { alpha: false });
  const audio = $('#audio');
  const fileInput = $('#audioFile');
  const dropzone = $('#dropzone');
  const toastEl = $('#toast');
  const defaults = {
    style: 'spectrum',
    colorOne: '#b8ff4f',
    colorTwo: '#7865ff',
    background: '#080b14',
    sensitivity: 1.2,
    glow: 22,
    aspect: 'landscape',
    showTitle: true,
    showParticles: true
  };

  const palettes = {
    acid: { one: '#b8ff4f', two: '#7865ff', bg: '#080b14' },
    ocean: { one: '#5be7ff', two: '#3475ff', bg: '#06111b' },
    sunset: { one: '#ffb14a', two: '#ff4e91', bg: '#170a16' },
    mono: { one: '#f5f7ff', two: '#8c9aaf', bg: '#080b14' },
    pink: { one: '#ff58c8', two: '#50a3ff', bg: '#10091b' }
  };

  const state = {
    ...defaults,
    file: null,
    objectUrl: null,
    audioContext: null,
    source: null,
    analyser: null,
    mediaDestination: null,
    frequencyData: null,
    timeData: null,
    recorder: null,
    recordingStream: null,
    chunks: [],
    recordingStarted: 0,
    recordingTimer: null,
    toastTimer: null,
    lastFrameTime: 0,
    particles: [],
    playing: false
  };

  function toast(message, isError) {
    toastEl.textContent = message;
    toastEl.classList.toggle('is-error', Boolean(isError));
    toastEl.classList.add('show');
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(function () { toastEl.classList.remove('show'); }, 3600);
  }

  function hexToRgb(hex) {
    const clean = String(hex || '#000000').replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(function (ch) { return ch + ch; }).join('') : clean;
    const num = parseInt(full, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function rgba(hex, alpha) {
    const rgb = hexToRgb(hex);
    return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha + ')';
  }

  function shadeColor(hex, amount) {
    const rgb = hexToRgb(hex);
    const factor = 1 - amount;
    return '#' + [rgb.r, rgb.g, rgb.b].map(function (value) {
      return Math.max(0, Math.min(255, Math.round(value * factor))).toString(16).padStart(2, '0');
    }).join('');
  }

  function niceTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins + ':' + String(secs).padStart(2, '0');
  }

  function bytesLabel(bytes) {
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function updateSettingsUI() {
    $('#colorOne').value = state.colorOne;
    $('#colorTwo').value = state.colorTwo;
    $('#backgroundColor').value = state.background;
    $('#sensitivityRange').value = state.sensitivity;
    $('#glowRange').value = state.glow;
    $('#aspectSelect').value = state.aspect;
    $('#showTitle').checked = state.showTitle;
    $('#showParticles').checked = state.showParticles;
    $('#sensitivityOutput').textContent = Number(state.sensitivity).toFixed(1) + '×';
    $('#glowOutput').textContent = String(state.glow);
    $$('.preset-card').forEach(function (button) {
      button.classList.toggle('active', button.dataset.style === state.style);
    });
    $$('.swatch').forEach(function (button) {
      button.classList.toggle('active', button.dataset.palette === activePalette());
    });
    applyAspect();
  }

  function activePalette() {
    return Object.keys(palettes).find(function (key) {
      return palettes[key].one === state.colorOne && palettes[key].two === state.colorTwo && palettes[key].bg === state.background;
    }) || '';
  }

  function applyAspect() {
    const ratios = {
      landscape: { width: 1280, height: 720, label: '16:9 · 1280 × 720' },
      square: { width: 1080, height: 1080, label: '1:1 · 1080 × 1080' },
      portrait: { width: 720, height: 1280, label: '9:16 · 720 × 1280' }
    };
    const ratio = ratios[state.aspect] || ratios.landscape;
    if (canvas.width !== ratio.width || canvas.height !== ratio.height) {
      canvas.width = ratio.width;
      canvas.height = ratio.height;
    }
    const shell = $('#canvasShell');
    shell.style.setProperty('--canvas-ratio', ratio.width + ' / ' + ratio.height);
    const availableHeight = Math.min(window.innerHeight * (window.innerWidth <= 720 ? 0.6 : 0.72), 680);
    const parentWidth = shell.parentElement.clientWidth || 1000;
    const fittedWidth = Math.min(parentWidth, availableHeight * ratio.width / ratio.height);
    shell.style.width = Math.max(1, Math.floor(fittedWidth)) + 'px';
    shell.style.maxWidth = '100%';
    shell.style.marginLeft = 'auto';
    shell.style.marginRight = 'auto';
    $('#canvasAspectBadge').textContent = ratio.label;
  }
  function setStyle(style) {
    if (!['spectrum', 'orbit', 'wave', 'aurora', 'radial'].includes(style)) return;
    state.style = style;
    $$('.preset-card').forEach(function (button) {
      button.classList.toggle('active', button.dataset.style === style);
    });
    const statusNames = {
      spectrum: 'NEON SPECTRUM',
      orbit: 'ORBITAL FIELD',
      wave: 'PURE WAVEFORM',
      aurora: 'AURORA FLOW',
      radial: 'SONIC CORE'
    };
    $('#previewStatus').textContent = state.file ? 'AUDIO REACTIVE' : 'DEMO · ' + statusNames[style];
    drawFrame(performance.now());
  }

  function setPalette(name) {
    const palette = palettes[name];
    if (!palette) return;
    state.colorOne = palette.one;
    state.colorTwo = palette.two;
    state.background = palette.bg;
    updateSettingsUI();
    drawFrame(performance.now());
  }

  function initParticles() {
    state.particles = [];
    for (let i = 0; i < 84; i++) {
      state.particles.push({
        x: Math.random(),
        y: Math.random(),
        size: 0.4 + Math.random() * 1.5,
        phase: Math.random() * Math.PI * 2,
        speed: 0.15 + Math.random() * 0.55
      });
    }
  }

  function getAudioValues(now) {
    const binCount = state.frequencyData ? state.frequencyData.length : 0;
    const available = Boolean(state.file && state.analyser && state.frequencyData && !audio.paused && !audio.ended);
    if (state.analyser && state.frequencyData) state.analyser.getByteFrequencyData(state.frequencyData);
    if (state.analyser && state.timeData) state.analyser.getByteTimeDomainData(state.timeData);
    return {
      available: available,
      binCount: binCount,
      level: function (index, count) {
        if (available && binCount) {
          const bin = Math.max(0, Math.min(binCount - 1, Math.floor(index / count * binCount * 0.82)));
          return Math.min(1, (state.frequencyData[bin] / 255) * state.sensitivity * 1.35);
        }
        const t = now / 1000;
        return Math.max(0.035, (0.16 + Math.sin(t * 1.75 + index * 0.31) * 0.12 + Math.sin(t * 0.77 + index * 0.09) * 0.09) * state.sensitivity);
      },
      wave: function (index, count) {
        if (available && state.timeData && state.timeData.length) {
          const sample = state.timeData[Math.min(state.timeData.length - 1, Math.floor(index / count * state.timeData.length))];
          return (sample - 128) / 128;
        }
        const t = now / 1000;
        return Math.sin(index / count * Math.PI * 8 + t * 1.5) * 0.44 + Math.sin(index / count * Math.PI * 19 - t * 1.1) * 0.13;
      }
    };
  }

  function drawBackground(w, h, now, audioValues) {
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, state.background);
    bg.addColorStop(0.55, shadeColor(state.background, 0.22));
    bg.addColorStop(1, shadeColor(state.background, 0.56));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const pulse = audioValues.level(6, 64);
    const glow = ctx.createRadialGradient(w * 0.5, h * 0.48, 4, w * 0.5, h * 0.48, Math.max(w, h) * 0.65);
    glow.addColorStop(0, rgba(state.colorTwo, 0.13 + pulse * 0.1));
    glow.addColorStop(0.48, rgba(state.colorOne, 0.035));
    glow.addColorStop(1, rgba(state.background, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.strokeStyle = 'rgba(220,235,255,0.055)';
    ctx.lineWidth = 1;
    const grid = Math.max(42, Math.round(Math.min(w, h) / 16));
    for (let x = 0; x < w; x += grid) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += grid) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.restore();

    if (state.showParticles) {
      ctx.save();
      for (let i = 0; i < state.particles.length; i++) {
        const p = state.particles[i];
        const flicker = 0.16 + (Math.sin(now / 700 * p.speed + p.phase) + 1) * 0.22;
        ctx.beginPath();
        ctx.fillStyle = i % 3 === 0 ? rgba(state.colorOne, flicker) : 'rgba(224,236,255,' + flicker + ')';
        ctx.arc(p.x * w, (p.y * h + now * p.speed * 0.004) % h, p.size * Math.max(0.7, w / 1280), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    const vignette = ctx.createRadialGradient(w * 0.5, h * 0.48, Math.min(w, h) * 0.16, w * 0.5, h * 0.48, Math.max(w, h) * 0.78);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.46)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }

  function colorGradient(y1, y2) {
    const gradient = ctx.createLinearGradient(0, y1, 0, y2);
    gradient.addColorStop(0, state.colorOne);
    gradient.addColorStop(0.52, state.colorTwo);
    gradient.addColorStop(1, rgba(state.colorTwo, 0.08));
    return gradient;
  }

  function drawSpectrum(w, h, now, values) {
    const count = Math.max(54, Math.min(104, Math.floor(w / 13)));
    const gap = Math.max(2, w * 0.0035);
    const barW = (w - 100) / count - gap;
    const baseline = h * 0.61;
    const maxH = h * 0.3;
    ctx.save();
    ctx.shadowBlur = state.glow;
    ctx.shadowColor = state.colorOne;
    ctx.fillStyle = colorGradient(baseline - maxH, baseline + 2);
    for (let i = 0; i < count; i++) {
      const level = values.level(i, count);
      const barH = Math.max(3, Math.min(maxH, level * maxH));
      const x = 50 + i * (barW + gap);
      ctx.globalAlpha = 0.88;
      ctx.fillRect(x, baseline - barH, Math.max(1, barW), barH);
      ctx.globalAlpha = 0.28;
      ctx.fillRect(x, baseline + 5, Math.max(1, barW), barH * 0.24);
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = rgba(state.colorOne, 0.32);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(36, baseline + 1); ctx.lineTo(w - 36, baseline + 1); ctx.stroke();
    ctx.restore();
    drawCoreRing(w * 0.5, h * 0.37, Math.min(w, h) * 0.07, now, values);
  }

  function drawCoreRing(cx, cy, radius, now, values) {
    ctx.save();
    const rings = 3;
    for (let r = 0; r < rings; r++) {
      ctx.beginPath();
      ctx.strokeStyle = r === 0 ? rgba(state.colorOne, 0.6) : rgba(state.colorTwo, 0.23);
      ctx.lineWidth = r === 0 ? 2 : 1;
      ctx.arc(cx, cy, radius * (1 + r * 0.24) + Math.sin(now / 900 + r) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    const dotGradient = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, 2, cx, cy, radius * 1.6);
    dotGradient.addColorStop(0, rgba(state.colorOne, 0.5));
    dotGradient.addColorStop(1, rgba(state.colorTwo, 0));
    ctx.fillStyle = dotGradient;
    ctx.beginPath(); ctx.arc(cx, cy, radius * 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawOrbit(w, h, now, values) {
    const cx = w * 0.5;
    const cy = h * 0.46;
    const radius = Math.min(w, h) * 0.19;
    ctx.save();
    ctx.shadowBlur = state.glow * 1.2;
    ctx.shadowColor = state.colorTwo;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rgba(state.colorTwo, 0.68);
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = rgba(state.colorOne, 0.26);
    ctx.beginPath(); ctx.arc(cx, cy, radius * 1.28, 0, Math.PI * 2); ctx.stroke();
    const count = Math.max(100, Math.floor(Math.min(w, h) * 0.42));
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2 + now / 18000;
      const amp = Math.max(3, values.level(i, count) * Math.min(w, h) * 0.12);
      const inner = radius + 7;
      const outer = inner + amp;
      const x1 = cx + Math.cos(angle) * inner;
      const y1 = cy + Math.sin(angle) * inner;
      const x2 = cx + Math.cos(angle) * outer;
      const y2 = cy + Math.sin(angle) * outer;
      ctx.lineWidth = Math.max(1, w / 900 * 2.3);
      ctx.strokeStyle = i % 2 === 0 ? state.colorOne : state.colorTwo;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.restore();
    drawCoreRing(cx, cy, radius * 0.57, now, values);
  }

  function drawWave(w, h, now, values) {
    const mid = h * 0.48;
    const count = 280;
    const amplitude = h * 0.15;
    for (let layer = 2; layer >= 0; layer--) {
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i <= count; i++) {
        const x = i / count * w;
        const signal = values.wave(i, count);
        const low = values.level(Math.floor(i / count * 40), 40);
        const wobble = Math.sin(i / count * Math.PI * 8 + now / 850 + layer) * 0.08;
        const y = mid + (signal + wobble) * amplitude * (0.78 + low * 0.6) * (layer === 0 ? 1 : 0.72 + layer * 0.15);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = layer === 0 ? state.colorOne : rgba(state.colorTwo, 0.6 - layer * 0.13);
      ctx.lineWidth = (layer === 0 ? 3 : 6 - layer) * Math.max(0.6, w / 1280);
      ctx.shadowBlur = state.glow;
      ctx.shadowColor = layer === 0 ? state.colorOne : state.colorTwo;
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = rgba(state.colorTwo, 0.2);
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
    ctx.restore();
  }

  function drawAurora(w, h, now, values) {
    const bands = [
      { y: h * 0.43, amp: h * 0.12, speed: 1, color: state.colorOne, alpha: 0.85 },
      { y: h * 0.52, amp: h * 0.16, speed: -0.75, color: state.colorTwo, alpha: 0.68 },
      { y: h * 0.6, amp: h * 0.1, speed: 0.52, color: state.colorOne, alpha: 0.4 }
    ];
    bands.forEach(function (band, index) {
      ctx.save();
      ctx.beginPath();
      const steps = 240;
      for (let i = 0; i <= steps; i++) {
        const p = i / steps;
        const x = p * w;
        const f = values.level(Math.floor(p * 64), 64);
        const y = band.y + Math.sin(p * Math.PI * (4 + index) + now / 1100 * band.speed) * band.amp * (0.4 + f * 1.05)
          + Math.sin(p * Math.PI * 9 - now / 1800 * band.speed) * band.amp * 0.2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(band.color, band.alpha);
      ctx.lineWidth = (index === 0 ? 4 : 2.6) * Math.max(0.8, w / 1280);
      ctx.shadowBlur = state.glow * 1.25;
      ctx.shadowColor = band.color;
      ctx.stroke();
      ctx.lineTo(w, h * 0.88);
      ctx.lineTo(0, h * 0.88);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, band.y - band.amp, 0, h * 0.9);
      fill.addColorStop(0, rgba(band.color, 0.1));
      fill.addColorStop(1, rgba(band.color, 0));
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
    });
  }

  function drawRadial(w, h, now, values) {
    const cx = w * 0.5;
    const cy = h * 0.44;
    const radius = Math.min(w, h) * 0.145;
    const count = Math.max(96, Math.floor(Math.min(w, h) * 0.36));
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowBlur = state.glow;
    ctx.shadowColor = state.colorOne;
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2 - Math.PI / 2;
      const level = values.level(i, count);
      const inner = radius + Math.sin(now / 1100 + i * 0.17) * 2;
      const outer = inner + 7 + level * Math.min(w, h) * 0.15;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.strokeStyle = i % 3 === 0 ? state.colorOne : state.colorTwo;
      ctx.lineWidth = Math.max(1.2, w / 800 * 1.6);
      ctx.stroke();
    }
    ctx.restore();
    drawCoreRing(cx, cy, radius * 0.75, now, values);

    ctx.save();
    ctx.strokeStyle = rgba(state.colorOne, 0.2);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, radius * 1.9, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawTypography(w, h) {
    ctx.save();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = '500 ' + Math.max(10, Math.round(Math.min(w, h) * 0.015)) + 'px "DM Mono", monospace';
    ctx.fillStyle = 'rgba(228,239,255,0.66)';
    ctx.fillText('WAVEFRAME / VISUAL LAB', w * 0.045, h * 0.055);
    ctx.textAlign = 'right';
    ctx.fillStyle = rgba(state.colorOne, 0.82);
    ctx.fillText('●  LIVE SIGNAL', w * 0.955, h * 0.055);

    if (state.showTitle) {
      const title = ($('#trackTitle').value || 'YOUR TRACK').trim();
      const artist = ($('#trackArtist').value || 'YOUR ARTIST').trim();
      const titleSize = Math.max(20, Math.min(Math.round(w * 0.048), Math.round(h * 0.085)));
      const artistSize = Math.max(12, Math.round(Math.min(w, h) * 0.022));
      const fade = ctx.createLinearGradient(0, h * 0.75, 0, h);
      fade.addColorStop(0, 'rgba(0,0,0,0)');
      fade.addColorStop(1, 'rgba(0,0,0,0.58)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, h * 0.72, w, h * 0.28);
      ctx.textAlign = 'left';
      ctx.font = '800 ' + titleSize + 'px Manrope, sans-serif';
      ctx.fillStyle = '#f6f8ff';
      ctx.shadowBlur = 18;
      ctx.shadowColor = rgba(state.colorOne, 0.25);
      const maxTitleWidth = w * 0.78;
      let shownTitle = title;
      while (shownTitle.length > 2 && ctx.measureText(shownTitle).width > maxTitleWidth) shownTitle = shownTitle.slice(0, -2).trimEnd() + '…';
      ctx.fillText(shownTitle, w * 0.055, h * 0.815);
      ctx.shadowBlur = 0;
      ctx.font = '500 ' + artistSize + 'px "DM Mono", monospace';
      ctx.fillStyle = rgba(state.colorOne, 0.95);
      let shownArtist = artist;
      while (shownArtist.length > 2 && ctx.measureText(shownArtist).width > maxTitleWidth) shownArtist = shownArtist.slice(0, -2).trimEnd() + '…';
      ctx.fillText(shownArtist.toUpperCase(), w * 0.058, h * 0.815 + titleSize * 1.2);
      ctx.textAlign = 'right';
      ctx.font = '500 ' + Math.max(10, Math.round(Math.min(w, h) * 0.015)) + 'px "DM Mono", monospace';
      ctx.fillStyle = 'rgba(230,239,255,0.68)';
      ctx.fillText('WF—' + String(Math.floor((audio.currentTime || 0) * 10)).padStart(5, '0'), w * 0.945, h * 0.925);
    }
    ctx.restore();
  }

  function drawFrame(now) {
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const values = getAudioValues(now);
    drawBackground(w, h, now, values);
    if (state.style === 'spectrum') drawSpectrum(w, h, now, values);
    else if (state.style === 'orbit') drawOrbit(w, h, now, values);
    else if (state.style === 'wave') drawWave(w, h, now, values);
    else if (state.style === 'aurora') drawAurora(w, h, now, values);
    else drawRadial(w, h, now, values);
    drawTypography(w, h);
    state.lastFrameTime = now;
  }

  function animate(now) {
    drawFrame(now);
    window.requestAnimationFrame(animate);
  }

  function ensureAudioGraph() {
    if (!state.file) return false;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Этот браузер не поддерживает аудиоанализ. Попробуй Chrome.');
    if (!state.audioContext) state.audioContext = new AudioContextClass();
    if (!state.source) {
      state.source = state.audioContext.createMediaElementSource(audio);
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 2048;
      state.analyser.smoothingTimeConstant = 0.83;
      state.analyser.minDecibels = -90;
      state.analyser.maxDecibels = -15;
      state.mediaDestination = state.audioContext.createMediaStreamDestination();
      state.frequencyData = new Uint8Array(state.analyser.frequencyBinCount);
      state.timeData = new Uint8Array(state.analyser.fftSize);
      state.source.connect(state.analyser);
      state.analyser.connect(state.audioContext.destination);
      state.analyser.connect(state.mediaDestination);
    }
    return true;
  }

  function updateTransport() {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    $('#currentTime').textContent = niceTime(current);
    $('#durationTime').textContent = niceTime(duration);
    $('#seekRange').value = duration ? String(Math.round(current / duration * 1000)) : '0';
    $('#seekRange').disabled = !state.file || !duration;
    $('#playGlyph').textContent = audio.paused ? '▶' : 'Ⅱ';
    $('#playButton').setAttribute('aria-label', audio.paused ? 'Воспроизвести' : 'Пауза');
    $('#playButton').disabled = !state.file;
    $('#stopButton').disabled = !state.file;
  }

  function updateLoadedFile(file) {
    state.file = file;
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(file);
    audio.src = state.objectUrl;
    audio.load();
    const cleanName = file.name.replace(/\.[^/.]+$/, '');
    $('#loadedTrackName').textContent = file.name;
    $('#loadedTrackInfo').textContent = bytesLabel(file.size) + ' · ЛОКАЛЬНЫЙ ФАЙЛ';
    if (!$('#trackTitle').value.trim() || $('#trackTitle').dataset.autoTitle === 'true') {
      $('#trackTitle').value = cleanName;
      $('#trackTitle').dataset.autoTitle = 'true';
    }
    $('#previewStatus').textContent = 'AUDIO READY';
    $('#previewHint').textContent = 'Аудио загружено. Нажми Play — визуал начнёт реагировать на звук.';
    $('#exportButton').disabled = false;
    $('#topExportButton').classList.add('ready');
    $('#exportButton').classList.add('ready');
    updateTransport();
    toast('Аудио готово. Файл не загружался в интернет.', false);
  }

  function selectAudio(file) {
    if (!file) return;
    if (file.type && !file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|flac|opus|webm|aif|aiff)$/i.test(file.name)) {
      toast('Выбери аудиофайл: MP3, WAV, M4A, AAC, OGG, FLAC или WEBM.', true);
      return;
    }
    if (state.recorder && state.recorder.state !== 'inactive') {
      toast('Сначала останови текущий экспорт.', true);
      return;
    }
    if (state.file) audio.pause();
    updateLoadedFile(file);
    fileInput.value = '';
  }

  function setPlayState() {
    $('#playGlyph').textContent = audio.paused ? '▶' : 'Ⅱ';
    $('#playButton').classList.toggle('is-playing', !audio.paused);
    if (state.file) $('#previewStatus').textContent = audio.paused ? 'AUDIO PAUSED' : 'AUDIO REACTIVE';
    if (state.file && !audio.paused) $('#previewHint').textContent = 'Визуал анализирует частоты в реальном времени.';
  }

  async function togglePlay() {
    if (!state.file) {
      toast('Сначала добавь аудиофайл в панели справа.', true);
      return;
    }
    try {
      ensureAudioGraph();
      if (state.audioContext.state === 'suspended') await state.audioContext.resume();
      if (audio.paused) await audio.play();
      else audio.pause();
      setPlayState();
    } catch (error) {
      toast(error.message || 'Не удалось воспроизвести аудио в браузере.', true);
    }
  }

  function stopPlayback() {
    audio.pause();
    try { audio.currentTime = 0; } catch {}
    setPlayState();
    updateTransport();
  }

  function supportedRecorderType() {
    if (!window.MediaRecorder) return '';
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return types.find(function (type) { return MediaRecorder.isTypeSupported(type); }) || '';
  }

  function setExportUI(active) {
    const buttonText = active ? '■ Остановить запись' : '● Экспорт WebM';
    $('#exportButton').textContent = buttonText;
    $('#topExportButton').textContent = active ? '■ Остановить запись' : '↗ Экспорт видео';
    $('#exportButton').classList.toggle('recording', active);
    $('#topExportButton').classList.toggle('recording', active);
    $('#exportProgressWrap').hidden = !active;
  }

  function stopExport(manual) {
    if (!state.recorder || state.recorder.state === 'inactive') return;
    if (manual) {
      audio.pause();
      $('#exportStatus').textContent = 'Завершаем файл…';
    }
    try { state.recorder.stop(); } catch (error) { toast('Не удалось завершить запись: ' + error.message, true); }
  }

  async function startExport() {
    if (state.recorder && state.recorder.state !== 'inactive') {
      stopExport(true);
      return;
    }
    if (!state.file) {
      toast('Сначала добавь аудио — затем экспортируй визуализатор.', true);
      return;
    }
    if (!window.MediaRecorder || !canvas.captureStream) {
      toast('Экспорт видео недоступен в этом браузере. Попробуй Chrome или Edge.', true);
      return;
    }
    const mimeType = supportedRecorderType();
    if (!mimeType) {
      toast('Браузер не поддерживает запись WebM. Попробуй обновить Chrome.', true);
      return;
    }

    try {
      ensureAudioGraph();
      if (state.audioContext.state === 'suspended') await state.audioContext.resume();
      audio.pause();
      audio.currentTime = 0;
      const canvasStream = canvas.captureStream(30);
      const audioTracks = state.mediaDestination.stream.getAudioTracks();
      if (!audioTracks.length) throw new Error('Не удалось подключить звук к записи.');
      audioTracks.forEach(function (track) { canvasStream.addTrack(track); });
      state.recordingStream = canvasStream;
      state.chunks = [];
      state.recordingStarted = Date.now();
      const options = { mimeType: mimeType, videoBitsPerSecond: state.aspect === 'portrait' ? 4500000 : 6000000, audioBitsPerSecond: 192000 };
      state.recorder = new MediaRecorder(canvasStream, options);
      state.recorder.ondataavailable = function (event) {
        if (event.data && event.data.size > 0) state.chunks.push(event.data);
      };
      state.recorder.onerror = function () { toast('Ошибка записи видео. Попробуй записать ещё раз.', true); };
      state.recorder.onstop = function () {
        window.clearInterval(state.recordingTimer);
        state.recordingTimer = null;
        if (state.recordingStream) state.recordingStream.getTracks().forEach(function (track) { track.stop(); });
        state.recordingStream = null;
        const blob = new Blob(state.chunks, { type: mimeType });
        state.chunks = [];
        state.recorder = null;
        setExportUI(false);
        $('#exportProgress').style.width = '0%';
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'waveframe-' + new Date().toISOString().slice(0, 10) + '.webm';
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
          toast('Видео готово: WEBM · ' + bytesLabel(blob.size) + '.');
        } else {
          toast('Запись пустая. Запусти трек и попробуй ещё раз.', true);
        }
        $('#exportStatus').textContent = 'Экспорт завершён';
        setPlayState();
      };
      state.recorder.start(1000);
      setExportUI(true);
      $('#exportStatus').textContent = 'Записываем визуализатор…';
      state.recordingTimer = window.setInterval(function () {
        const elapsed = Math.max(0, Math.floor((Date.now() - state.recordingStarted) / 1000));
        $('#exportElapsed').textContent = niceTime(elapsed);
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        $('#exportProgress').style.width = (duration ? Math.min(100, elapsed / duration * 100) : 3) + '%';
      }, 300);
      await audio.play();
      setPlayState();
      $('#previewHint').textContent = 'Идёт экспорт в реальном времени. Трек должен доиграть до конца.';
    } catch (error) {
      if (state.recorder && state.recorder.state !== 'inactive') {
        try { state.recorder.stop(); } catch {}
      }
      if (state.recordingStream) state.recordingStream.getTracks().forEach(function (track) { track.stop(); });
      state.recordingStream = null;
      setExportUI(false);
      toast(error.message || 'Экспорт не запустился. Попробуй другой браузер.', true);
    }
  }

  function exportPng() {
    try {
      canvas.toBlob(function (blob) {
        if (!blob) {
          toast('Не удалось создать PNG-кадр.', true);
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'waveframe-frame.png';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
        toast('PNG-кадр сохранён.');
      }, 'image/png');
    } catch (error) { toast('Не удалось сохранить кадр: ' + error.message, true); }
  }

  function currentProject() {
    return {
      app: 'WAVEFRAME',
      version: 1,
      savedAt: new Date().toISOString(),
      visualizer: {
        style: state.style,
        colorOne: state.colorOne,
        colorTwo: state.colorTwo,
        background: state.background,
        sensitivity: Number(state.sensitivity),
        glow: Number(state.glow),
        aspect: state.aspect,
        showTitle: state.showTitle,
        showParticles: state.showParticles,
        title: $('#trackTitle').value,
        artist: $('#trackArtist').value
      },
      note: 'This file stores visualizer settings only. It does not contain audio.'
    };
  }

  function downloadText(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  function savePreset() {
    try {
      localStorage.setItem('waveframe-preset', JSON.stringify(currentProject()));
      toast('Настройки сохранены на этом устройстве.');
    } catch { toast('Браузер не разрешил сохранить настройки.', true); }
  }

  function loadPreset() {
    try {
      const saved = JSON.parse(localStorage.getItem('waveframe-preset') || 'null');
      const v = saved && saved.visualizer;
      if (!v) return;
      if (['spectrum', 'orbit', 'wave', 'aurora', 'radial'].includes(v.style)) state.style = v.style;
      if (/^#[0-9a-f]{6}$/i.test(v.colorOne || '')) state.colorOne = v.colorOne;
      if (/^#[0-9a-f]{6}$/i.test(v.colorTwo || '')) state.colorTwo = v.colorTwo;
      if (/^#[0-9a-f]{6}$/i.test(v.background || '')) state.background = v.background;
      if (Number.isFinite(Number(v.sensitivity))) state.sensitivity = Math.max(0.5, Math.min(2.5, Number(v.sensitivity)));
      if (Number.isFinite(Number(v.glow))) state.glow = Math.max(0, Math.min(40, Number(v.glow)));
      if (['landscape', 'square', 'portrait'].includes(v.aspect)) state.aspect = v.aspect;
      if (typeof v.showTitle === 'boolean') state.showTitle = v.showTitle;
      if (typeof v.showParticles === 'boolean') state.showParticles = v.showParticles;
      if (typeof v.title === 'string') { $('#trackTitle').value = v.title; $('#trackTitle').dataset.autoTitle = 'false'; }
      if (typeof v.artist === 'string') $('#trackArtist').value = v.artist;
    } catch {}
  }

  function resetSettings() {
    Object.assign(state, defaults);
    $('#trackTitle').value = state.file ? state.file.name.replace(/\.[^/.]+$/, '') : '';
    $('#trackTitle').dataset.autoTitle = state.file ? 'true' : 'false';
    $('#trackArtist').value = '';
    updateSettingsUI();
    setStyle(state.style);
    toast('Настройки возвращены к исходным.');
  }

  fileInput.addEventListener('change', function () { if (fileInput.files && fileInput.files[0]) selectAudio(fileInput.files[0]); });
  dropzone.addEventListener('click', function (event) { if (event.target !== fileInput) fileInput.click(); });
  ['dragenter', 'dragover'].forEach(function (name) {
    dropzone.addEventListener(name, function (event) {
      event.preventDefault(); event.stopPropagation(); dropzone.classList.add('is-dragging');
    });
  });
  ['dragleave', 'drop'].forEach(function (name) {
    dropzone.addEventListener(name, function (event) {
      event.preventDefault(); event.stopPropagation(); dropzone.classList.remove('is-dragging');
    });
  });
  dropzone.addEventListener('drop', function (event) {
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) selectAudio(file);
  });

  $$('.preset-card').forEach(function (button) { button.addEventListener('click', function () { setStyle(button.dataset.style); }); });
  $$('.swatch').forEach(function (button) { button.addEventListener('click', function () { setPalette(button.dataset.palette); }); });
  $('#colorOne').addEventListener('input', function (event) { state.colorOne = event.target.value; updateSettingsUI(); });
  $('#colorTwo').addEventListener('input', function (event) { state.colorTwo = event.target.value; updateSettingsUI(); });
  $('#backgroundColor').addEventListener('input', function (event) { state.background = event.target.value; updateSettingsUI(); });
  $('#sensitivityRange').addEventListener('input', function (event) {
    state.sensitivity = Number(event.target.value); $('#sensitivityOutput').textContent = state.sensitivity.toFixed(1) + '×';
  });
  $('#glowRange').addEventListener('input', function (event) {
    state.glow = Number(event.target.value); $('#glowOutput').textContent = String(state.glow);
  });
  $('#aspectSelect').addEventListener('change', function (event) {
    state.aspect = event.target.value; applyAspect(); drawFrame(performance.now());
  });
  $('#showTitle').addEventListener('change', function (event) { state.showTitle = event.target.checked; });
  $('#showParticles').addEventListener('change', function (event) { state.showParticles = event.target.checked; });
  $('#trackTitle').addEventListener('input', function () { $('#trackTitle').dataset.autoTitle = 'false'; });
  $('#playButton').addEventListener('click', togglePlay);
  $('#stopButton').addEventListener('click', stopPlayback);
  $('#rewindButton').addEventListener('click', function () { if (state.file) { audio.currentTime = 0; if (audio.paused) togglePlay(); } });
  $('#seekRange').addEventListener('input', function (event) { if (Number.isFinite(audio.duration)) audio.currentTime = Number(event.target.value) / 1000 * audio.duration; });
  $('#exportButton').addEventListener('click', startExport);
  $('#topExportButton').addEventListener('click', startExport);
  $('#pngButton').addEventListener('click', exportPng);
  $('#projectButton').addEventListener('click', function () {
    downloadText('waveframe-project.json', JSON.stringify(currentProject(), null, 2), 'application/json');
    toast('Настройки проекта сохранены в JSON.');
  });
  $('#savePresetButton').addEventListener('click', savePreset);
  $('#resetButton').addEventListener('click', resetSettings);
  audio.addEventListener('loadedmetadata', updateTransport);
  audio.addEventListener('timeupdate', updateTransport);
  audio.addEventListener('play', setPlayState);
  audio.addEventListener('pause', setPlayState);
  audio.addEventListener('ended', function () {
    setPlayState();
    if (state.recorder && state.recorder.state !== 'inactive') stopExport(false);
  });

  initParticles();
  loadPreset();
  updateSettingsUI();
  setStyle(state.style);
  updateTransport();
  window.requestAnimationFrame(animate);
})();