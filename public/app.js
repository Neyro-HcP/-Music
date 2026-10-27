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
    colorOne: '#d6b57c',
    colorTwo: '#8b97b0',
    background: '#08090d',
    sensitivity: 1.2,
    glow: 22,
    aspect: 'landscape',
    showTitle: true,
    showParticles: true,
    showVignette: true,
    vignette: 65,
    backgroundOpacity: 100,
    logoSize: 18,
    logoOpacity: 100,
    logoX: 50,
    logoY: 45,
    visualX: 0,
    visualY: 0,
    textX: 6,
    textY: 81,
    textSize: 100,
    particleCount: 85,
    particleSize: 1,
    particleSpeed: 1,
    beatResponse: 1.4,
    smoothing: 45
  };

  const palettes = {
    acid: { one: '#d6b57c', two: '#8b97b0', bg: '#08090d' },
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
    logoImage: null,
    logoObjectUrl: null,
    backgroundImage: null,
    backgroundObjectUrl: null,
    smoothedBands: new Float32Array(192),
    peakBands: new Float32Array(192),
    bassEnvelope: 0,
    lastBassEnergy: 0,
    beatPulse: 0,
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
    $('#showVignette').checked = state.showVignette;
    $('#vignetteRange').value = state.vignette;
    $('#backgroundOpacityRange').value = state.backgroundOpacity;
    $('#logoSizeRange').value = state.logoSize;
    $('#logoOpacityRange').value = state.logoOpacity;
    $('#logoXRange').value = state.logoX;
    $('#logoYRange').value = state.logoY;
    $('#visualXRange').value = state.visualX;
    $('#visualYRange').value = state.visualY;
    $('#textXRange').value = state.textX;
    $('#textYRange').value = state.textY;
    $('#textSizeRange').value = state.textSize;
    $('#particleCountRange').value = state.particleCount;
    $('#particleSizeRange').value = state.particleSize;
    $('#particleSpeedRange').value = state.particleSpeed;
    $('#beatResponseRange').value = state.beatResponse;
    $('#smoothingRange').value = state.smoothing;
    $('#vignetteOutput').textContent = state.vignette + '%';
    $('#backgroundOpacityOutput').textContent = state.backgroundOpacity + '%';
    $('#logoSizeOutput').textContent = state.logoSize + '%';
    $('#logoOpacityOutput').textContent = state.logoOpacity + '%';
    $('#logoXOutput').textContent = state.logoX + '%';
    $('#logoYOutput').textContent = state.logoY + '%';
    $('#visualXOutput').textContent = (state.visualX > 0 ? '+' : '') + state.visualX + '%';
    $('#visualYOutput').textContent = (state.visualY > 0 ? '+' : '') + state.visualY + '%';
    $('#textXOutput').textContent = state.textX + '%';
    $('#textYOutput').textContent = state.textY + '%';
    $('#textSizeOutput').textContent = state.textSize + '%';
    $('#particleCountOutput').textContent = state.particleCount;
    $('#particleSizeOutput').textContent = Number(state.particleSize).toFixed(1) + '×';
    $('#particleSpeedOutput').textContent = Number(state.particleSpeed).toFixed(1) + '×';
    $('#beatResponseOutput').textContent = Number(state.beatResponse).toFixed(1) + '×';
    $('#smoothingOutput').textContent = state.smoothing + '%';
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
    const target = Math.max(0, Math.min(250, Number(state.particleCount) || 0));
    while (state.particles.length < target) {
      state.particles.push({
        x: Math.random(),
        y: Math.random(),
        size: 0.45 + Math.random() * 1.15,
        phase: Math.random() * Math.PI * 2,
        speed: 0.2 + Math.random() * 0.65
      });
    }
    if (state.particles.length > target) state.particles.length = target;
  }

  function getAudioValues(now) {
    const bandCount = state.smoothedBands.length;
    const active = Boolean(state.file && state.analyser && state.frequencyData && !audio.ended);
    const dt = Math.max(0.008, Math.min(0.07, (now - (state.lastAudioTime || now - 16.7)) / 1000));
    state.lastAudioTime = now;
    if (state.analyser && state.frequencyData) {
      state.analyser.getByteFrequencyData(state.frequencyData);
      if (state.timeData) state.analyser.getByteTimeDomainData(state.timeData);
    }

    let bassEnergy = 0;
    let bassSamples = 0;
    if (active && state.frequencyData && state.audioContext) {
      const nyquist = state.audioContext.sampleRate / 2;
      const binCount = state.frequencyData.length;
      const minHz = 28;
      const maxHz = Math.min(18000, nyquist * 0.94);
      const logSpan = Math.log(maxHz / minHz);
      for (let i = 0; i < bandCount; i++) {
        const f0 = minHz * Math.exp((i / bandCount) * logSpan);
        const f1 = minHz * Math.exp(((i + 1) / bandCount) * logSpan);
        let b0 = Math.max(0, Math.floor(f0 / nyquist * binCount));
        let b1 = Math.min(binCount - 1, Math.max(b0 + 1, Math.ceil(f1 / nyquist * binCount)));
        let sum = 0;
        let count = 0;
        for (let b = b0; b <= b1; b++) {
          sum += state.frequencyData[b];
          count++;
        }
        const raw = count ? sum / count : 0;
        const normalized = Math.max(0, Math.min(1, (raw - 9) / 220));
        let target = Math.pow(normalized, 0.72) * state.sensitivity;
        if (i < 15) {
          bassEnergy += normalized;
          bassSamples++;
        }
        target = Math.max(0, Math.min(1.45, target));
        const previous = state.smoothedBands[i];
        const attack = 0.35 + (1 - state.smoothing / 100) * 0.58;
        const release = 0.32 - (state.smoothing / 100) * 0.25;
        const coefficient = target > previous ? attack : release;
        const smoothed = previous + (target - previous) * Math.min(0.96, coefficient);
        state.smoothedBands[i] = smoothed;
        state.peakBands[i] = Math.max(smoothed, state.peakBands[i] - dt * (1.5 + state.smoothing / 60));
      }
      bassEnergy = bassSamples ? bassEnergy / bassSamples : 0;
      const flux = Math.max(0, bassEnergy - state.lastBassEnergy);
      const transient = Math.max(0, bassEnergy - state.bassEnvelope * 1.06);
      const hit = Math.max(flux * 4.8, transient * 1.8) * state.beatResponse;
      state.beatPulse = Math.max(hit, state.beatPulse * Math.exp(-dt * 5.2));
      state.bassEnvelope = state.bassEnvelope * 0.91 + bassEnergy * 0.09;
      state.lastBassEnergy = bassEnergy;
    } else {
      state.beatPulse *= Math.exp(-dt * 3.5);
      for (let i = 0; i < bandCount; i++) {
        state.smoothedBands[i] *= 0.94;
        state.peakBands[i] *= 0.93;
      }
    }

    const demo = function (index, count) {
      const t = now / 1000;
      const position = index / Math.max(1, count);
      const wave = 0.12 + Math.max(0, Math.sin(t * 1.25 + position * 13)) * 0.13
        + Math.max(0, Math.sin(t * 2.1 - position * 7)) * 0.08;
      return wave * state.sensitivity;
    };
    return {
      available: active && !audio.paused,
      beat: Math.min(1, state.beatPulse),
      bass: bassEnergy,
      level: function (index, count) {
        const pos = Math.max(0, Math.min(0.9999, index / Math.max(1, count)));
        const band = Math.min(bandCount - 1, Math.floor(pos * bandCount));
        if (!active) return Math.max(0.015, demo(index, count));
        const smooth = state.smoothedBands[band] || 0;
        const peak = state.peakBands[band] || 0;
        const lowBoost = 1 - pos;
        const beatBoost = state.beatPulse * state.beatResponse * lowBoost * 0.24;
        return Math.max(0, Math.min(1.4, smooth + Math.max(0, peak - smooth) * 0.25 + beatBoost));
      },
      wave: function (index, count) {
        if (active && state.timeData && state.timeData.length && !audio.paused) {
          const sample = state.timeData[Math.min(state.timeData.length - 1, Math.floor(index / Math.max(1, count) * state.timeData.length))];
          return (sample - 128) / 128;
        }
        const t = now / 1000;
        return Math.sin(index / Math.max(1, count) * Math.PI * 8 + t * 1.5) * 0.44
          + Math.sin(index / Math.max(1, count) * Math.PI * 19 - t * 1.1) * 0.13;
      }
    };
  }

  function drawCoverImage(image, w, h) {
    if (!image || !image.width || !image.height) return;
    const scale = Math.max(w / image.width, h / image.height);
    const iw = image.width * scale;
    const ih = image.height * scale;
    ctx.drawImage(image, (w - iw) / 2, (h - ih) / 2, iw, ih);
  }

  function drawBackground(w, h, now, audioValues) {
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, state.background);
    bg.addColorStop(0.55, shadeColor(state.background, 0.22));
    bg.addColorStop(1, shadeColor(state.background, 0.56));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    if (state.backgroundImage) {
      ctx.save();
      ctx.globalAlpha = state.backgroundOpacity / 100;
      drawCoverImage(state.backgroundImage, w, h);
      ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,' + (0.08 + (state.backgroundOpacity / 100) * 0.13) + ')';
      ctx.fillRect(0, 0, w, h);
    }

    const pulse = audioValues.level(6, 64);
    const glow = ctx.createRadialGradient(w * 0.5, h * 0.48, 4, w * 0.5, h * 0.48, Math.max(w, h) * 0.65);
    glow.addColorStop(0, rgba(state.colorTwo, 0.10 + pulse * 0.08));
    glow.addColorStop(0.48, rgba(state.colorOne, 0.025));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    if (!state.backgroundImage) {
      ctx.save();
      ctx.strokeStyle = 'rgba(220,235,255,0.035)';
      ctx.lineWidth = 1;
      const grid = Math.max(48, Math.round(Math.min(w, h) / 17));
      for (let x = 0; x < w; x += grid) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += grid) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      ctx.restore();
    }

    if (state.showParticles && state.particleCount > 0) {
      ctx.save();
      for (let i = 0; i < state.particles.length; i++) {
        const p = state.particles[i];
        const flicker = 0.12 + (Math.sin(now / 700 * p.speed * state.particleSpeed + p.phase) + 1) * 0.16;
        ctx.beginPath();
        ctx.fillStyle = i % 3 === 0 ? rgba(state.colorOne, flicker) : 'rgba(224,236,255,' + flicker + ')';
        const y = (p.y * h + now * p.speed * state.particleSpeed * 0.002) % h;
        ctx.arc(p.x * w, y, p.size * state.particleSize * Math.max(0.7, w / 1280), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (state.showVignette && state.vignette > 0) {
      const amount = state.vignette / 100;
      const vignette = ctx.createRadialGradient(w * 0.5, h * 0.48, Math.min(w, h) * 0.12, w * 0.5, h * 0.48, Math.max(w, h) * 0.74);
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(0.55, 'rgba(0,0,0,' + (amount * 0.15) + ')');
      vignette.addColorStop(1, 'rgba(0,0,0,' + (amount * 0.78) + ')');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
    }
  }

  function drawCenterLogo(w, h) {
    const size = Math.max(22, Math.min(w, h) * state.logoSize / 100);
    const cx = w * state.logoX / 100;
    const cy = h * state.logoY / 100;
    ctx.save();
    ctx.globalAlpha = state.logoOpacity / 100;
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,11,18,0.82)';
    ctx.shadowBlur = state.glow * 0.7;
    ctx.shadowColor = state.colorOne;
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2 - 1.5, 0, Math.PI * 2);
    ctx.clip();
    if (state.logoImage) {
      drawCoverImageInCircle(state.logoImage, cx, cy, size);
    } else {
      ctx.shadowBlur = 0;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f5f6f8';
      ctx.font = '800 ' + Math.max(12, size * 0.31) + 'px Manrope, sans-serif';
      ctx.fillText('НсП', cx, cy);
    }
    ctx.restore();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rgba(state.colorOne, 0.82);
    ctx.lineWidth = Math.max(1.2, size * 0.012);
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawCoverImageInCircle(image, cx, cy, size) {
    if (!image || !image.width || !image.height) return;
    const scale = Math.max(size / image.width, size / image.height);
    const iw = image.width * scale;
    const ih = image.height * scale;
    ctx.drawImage(image, cx - iw / 2, cy - ih / 2, iw, ih);
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
    if (!state.showTitle) return;
    const title = ($('#trackTitle').value || 'Без названия').trim();
    const artist = ($('#trackArtist').value || 'НсП').trim();
    const scale = state.textSize / 100;
    const titleSize = Math.max(14, Math.min(Math.round(w * 0.048), Math.round(h * 0.085))) * scale;
    const artistSize = Math.max(10, Math.round(Math.min(w, h) * 0.022)) * scale;
    const xPercent = state.textX / 100;
    const yPercent = state.textY / 100;
    const x = w * xPercent;
    const safeBlockHeight = titleSize * 2.55 + artistSize;
    const y = Math.max(10, Math.min(h - safeBlockHeight - h * 0.025, h * yPercent));
    const textAlign = state.textX > 72 ? 'right' : 'left';
    const maxWidth = w * 0.84;
    const alignX = textAlign === 'right' ? Math.min(w - 12, x) : Math.max(12, Math.min(w - 12, x));
    ctx.save();
    ctx.textBaseline = 'top';
    ctx.textAlign = textAlign;
    ctx.shadowBlur = Math.min(24, state.glow * 0.65);
    ctx.shadowColor = rgba(state.colorOne, 0.25);
    ctx.font = '800 ' + Math.round(titleSize) + 'px Manrope, sans-serif';
    let shownTitle = title;
    while (shownTitle.length > 2 && ctx.measureText(shownTitle).width > maxWidth) shownTitle = shownTitle.slice(0, -2).trimEnd() + '…';
    ctx.fillStyle = '#f5f6f8';
    ctx.fillText(shownTitle, alignX, y, maxWidth);
    ctx.shadowBlur = Math.min(14, state.glow * 0.45);
    ctx.font = '600 ' + Math.round(artistSize) + 'px Manrope, sans-serif';
    ctx.fillStyle = state.colorOne;
    let shownArtist = artist;
    while (shownArtist.length > 2 && ctx.measureText(shownArtist.toUpperCase()).width > maxWidth) shownArtist = shownArtist.slice(0, -2).trimEnd() + '…';
    ctx.fillText(shownArtist.toUpperCase(), alignX, y + titleSize * 1.18, maxWidth);
    ctx.restore();
  }

  function drawFrame(now) {
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const values = getAudioValues(now);
    drawBackground(w, h, now, values);
    const dx = w * state.visualX / 100;
    const dy = h * state.visualY / 100;
    ctx.save();
    ctx.translate(dx, dy);
    if (state.style === 'spectrum') drawSpectrum(w, h, now, values);
    else if (state.style === 'orbit') drawOrbit(w, h, now, values);
    else if (state.style === 'wave') drawWave(w, h, now, values);
    else if (state.style === 'aurora') drawAurora(w, h, now, values);
    else drawRadial(w, h, now, values);
    drawCenterLogo(w, h);
    ctx.restore();
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
      state.analyser.fftSize = 4096;
      state.analyser.smoothingTimeConstant = 0.32 + state.smoothing / 100 * 0.46;
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

  function updatePositionOutputs() {
    $('#logoSizeOutput').textContent = state.logoSize + '%';
    $('#logoOpacityOutput').textContent = state.logoOpacity + '%';
    $('#logoXOutput').textContent = state.logoX + '%';
    $('#logoYOutput').textContent = state.logoY + '%';
    $('#visualXOutput').textContent = (state.visualX > 0 ? '+' : '') + state.visualX + '%';
    $('#visualYOutput').textContent = (state.visualY > 0 ? '+' : '') + state.visualY + '%';
    $('#textXOutput').textContent = state.textX + '%';
    $('#textYOutput').textContent = state.textY + '%';
    $('#textSizeOutput').textContent = state.textSize + '%';
    $('#vignetteOutput').textContent = state.vignette + '%';
    $('#backgroundOpacityOutput').textContent = state.backgroundOpacity + '%';
    $('#particleCountOutput').textContent = String(state.particleCount);
    $('#particleSizeOutput').textContent = Number(state.particleSize).toFixed(1) + '×';
    $('#particleSpeedOutput').textContent = Number(state.particleSpeed).toFixed(1) + '×';
    $('#beatResponseOutput').textContent = Number(state.beatResponse).toFixed(1) + '×';
    $('#smoothingOutput').textContent = state.smoothing + '%';
  }

  function openAssetDatabase() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('Хранилище изображений недоступно')); return; }
      const request = indexedDB.open('nsp-visual-assets', 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains('assets')) request.result.createObjectStore('assets');
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB error')); };
    });
  }

  async function storeImageAsset(key, blob) {
    try {
      const db = await openAssetDatabase();
      await new Promise(function (resolve, reject) {
        const tx = db.transaction('assets', 'readwrite');
        tx.objectStore('assets').put(blob, key);
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
      db.close();
    } catch (error) {
      toast('Изображение работает, но браузер не смог сохранить его после перезагрузки.', true);
    }
  }

  async function readImageAsset(key) {
    const db = await openAssetDatabase();
    const blob = await new Promise(function (resolve, reject) {
      const tx = db.transaction('assets', 'readonly');
      const request = tx.objectStore('assets').get(key);
      request.onsuccess = function () { resolve(request.result || null); };
      request.onerror = function () { reject(request.error); };
    });
    db.close();
    return blob;
  }

  async function deleteImageAsset(key) {
    try {
      const db = await openAssetDatabase();
      await new Promise(function (resolve, reject) {
        const tx = db.transaction('assets', 'readwrite');
        tx.objectStore('assets').delete(key);
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
      db.close();
    } catch {}
  }

  function useLocalImage(file, kind, fromStorage) {
    if (!file) return;
    const isLogo = kind === 'logo';
    const maxBytes = isLogo ? 8 * 1024 * 1024 : 20 * 1024 * 1024;
    if (!fromStorage && file.size > maxBytes) {
      toast(isLogo ? 'Логотип слишком большой. Максимум — 8 МБ.' : 'Изображение фона слишком большое. Максимум — 20 МБ.', true);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      if (isLogo) {
        if (state.logoObjectUrl) URL.revokeObjectURL(state.logoObjectUrl);
        state.logoObjectUrl = url;
        state.logoImage = img;
        $('#logoPreview').innerHTML = '<img src="' + url + '" alt="">';
        $('#logoFileName').textContent = file.name || 'Логотип НсП';
        if (!fromStorage) void storeImageAsset('logo', file);
      } else {
        if (state.backgroundObjectUrl) URL.revokeObjectURL(state.backgroundObjectUrl);
        state.backgroundObjectUrl = url;
        state.backgroundImage = img;
        $('#backgroundPickButton').innerHTML = '<span>✓</span> Фон загружен';
        if (!fromStorage) void storeImageAsset('background', file);
      }
      drawFrame(performance.now());
      if (!fromStorage) toast(isLogo ? 'Круглый логотип добавлен в сцену.' : 'Собственный фон добавлен в сцену.');
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      toast('Не удалось открыть это изображение.', true);
    };
    img.src = url;
  }

  function removeLogo() {
    state.logoImage = null;
    if (state.logoObjectUrl) URL.revokeObjectURL(state.logoObjectUrl);
    state.logoObjectUrl = null;
    $('#logoPreview').innerHTML = '<span>НсП</span>';
    $('#logoFileName').textContent = 'Логотип НсП';
    $('#logoFile').value = '';
    void deleteImageAsset('logo');
    drawFrame(performance.now());
  }

  function removeBackground() {
    state.backgroundImage = null;
    if (state.backgroundObjectUrl) URL.revokeObjectURL(state.backgroundObjectUrl);
    state.backgroundObjectUrl = null;
    $('#backgroundPickButton').innerHTML = '<span>＋</span> Загрузить изображение';
    $('#backgroundFile').value = '';
    void deleteImageAsset('background');
    drawFrame(performance.now());
  }

  async function restoreSavedAssets() {
    try {
      const logo = await readImageAsset('logo');
      if (logo) useLocalImage(new File([logo], 'logo-image', { type: logo.type || 'image/png' }), 'logo', true);
    } catch {}
    try {
      const background = await readImageAsset('background');
      if (background) useLocalImage(new File([background], 'background-image', { type: background.type || 'image/jpeg' }), 'background', true);
    } catch {}
  }

  function currentProject() {
    return {
      app: 'НсП Visual Lab',
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
        showVignette: state.showVignette,
        vignette: state.vignette,
        backgroundOpacity: state.backgroundOpacity,
        logoSize: state.logoSize,
        logoOpacity: state.logoOpacity,
        logoX: state.logoX,
        logoY: state.logoY,
        visualX: state.visualX,
        visualY: state.visualY,
        textX: state.textX,
        textY: state.textY,
        textSize: state.textSize,
        particleCount: state.particleCount,
        particleSize: state.particleSize,
        particleSpeed: state.particleSpeed,
        beatResponse: state.beatResponse,
        smoothing: state.smoothing,
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
      localStorage.setItem('nsp-visual-preset', JSON.stringify(currentProject()));
      toast('Настройки сохранены на этом устройстве.');
    } catch { toast('Браузер не разрешил сохранить настройки.', true); }
  }

  function loadPreset() {
    try {
      const saved = JSON.parse(localStorage.getItem('nsp-visual-preset') || localStorage.getItem('waveframe-preset') || 'null');
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
      if (typeof v.showVignette === 'boolean') state.showVignette = v.showVignette;
      const numericSettings = {
        vignette: [0, 100], backgroundOpacity: [0, 100], logoSize: [6, 34], logoOpacity: [20, 100],
        logoX: [10, 90], logoY: [10, 90], visualX: [-30, 30], visualY: [-30, 30],
        textX: [3, 90], textY: [5, 94], textSize: [55, 180], particleCount: [0, 250],
        particleSize: [0.4, 3], particleSpeed: [0, 3], beatResponse: [0.4, 3], smoothing: [0, 90]
      };
      Object.keys(numericSettings).forEach(function (key) {
        if (Number.isFinite(Number(v[key]))) state[key] = Math.max(numericSettings[key][0], Math.min(numericSettings[key][1], Number(v[key])));
      });
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
  $('#showVignette').addEventListener('change', function (event) { state.showVignette = event.target.checked; });
  $('#trackTitle').addEventListener('input', function () { $('#trackTitle').dataset.autoTitle = 'false'; });
  $('#playButton').addEventListener('click', togglePlay);
  $('#stopButton').addEventListener('click', stopPlayback);
  $('#rewindButton').addEventListener('click', function () { if (state.file) { audio.currentTime = 0; if (audio.paused) togglePlay(); } });
  $('#seekRange').addEventListener('input', function (event) { if (Number.isFinite(audio.duration)) audio.currentTime = Number(event.target.value) / 1000 * audio.duration; });
  $('#exportButton').addEventListener('click', startExport);
  $('#topExportButton').addEventListener('click', startExport);
  $('#pngButton').addEventListener('click', exportPng);
  $('#projectButton').addEventListener('click', function () {
    downloadText('nsp-visual-project.json', JSON.stringify(currentProject(), null, 2), 'application/json');
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
  window.addEventListener('resize', applyAspect);
  window.requestAnimationFrame(animate);
})();