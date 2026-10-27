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
    showLogo: false,
    logoShape: 'circle',
    logoPulseEnabled: true,
    logoPulseMode: 'both',
    logoPulseAmount: 45,
    logoHaloEnabled: true,
    logoHaloCount: 3,
    logoHaloWidth: 2,
    logoHaloColor: '#d6b57c',
    logoGlow: 14,
    showVisualizer: true,
    visualizerGradient: true,
    visualizerShadow: 12,
    visualizerFilter: 'none',
    visualizerLayers: [],
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
    visualScale: 100,
    visualOpacity: 100,
    visualLineWidth: 1,
    titleX: 6,
    titleY: 78,
    titleSize: 100,
    titleColor: '#f5f6f8',
    titleOpacity: 100,
    artistX: 6,
    artistY: 88,
    artistSize: 100,
    artistColor: '#d6b57c',
    artistOpacity: 100,
    particleCount: 85,
    particleSize: 1,
    particleSpeed: 1,
    particleDirection: 'float',
    particleShape: 'circle',
    particleColor: '#d6b57c',
    particleOpacity: 65,
    particleGlow: 0,
    beatResponse: 1.8,
    smoothing: 45,
    cameraShakeEnabled: false,
    cameraShakeMode: 'both',
    cameraShake: 12,
    visualizerPulse: 35,
    particlePulse: 30,
    vignettePulse: 28
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
    frequencyBands: [],
    lastRenderAt: 0,
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
    converting: false,
    currentExportFormat: 'mp4',
    currentRecorderMimeType: '',
    ffmpegPromise: null,
    recordingStarted: 0,
    recordingTimer: null,
    toastTimer: null,
    lastFrameTime: 0,
    particles: [],
    visualizerLayers: [],
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
    $('#showLogo').checked = state.showLogo;
    $('#logoShapeSelect').value = state.logoShape;
    $('#logoPreview').dataset.shape = state.logoShape;
    $('#logoPulseEnabled').checked = state.logoPulseEnabled;
    $('#logoPulseModeSelect').value = state.logoPulseMode;
    $('#logoPulseAmountRange').value = state.logoPulseAmount;
    $('#logoHaloEnabled').checked = state.logoHaloEnabled;
    $('#logoHaloCountRange').value = state.logoHaloCount;
    $('#logoHaloWidthRange').value = state.logoHaloWidth;
    $('#logoHaloColorInput').value = state.logoHaloColor;
    $('#logoGlowRange').value = state.logoGlow;
    $('#showVisualizer').checked = state.showVisualizer;
    $('#visualizerGradientEnabled').checked = state.visualizerGradient;
    $('#visualizerShadowRange').value = state.visualizerShadow;
    $('#visualizerFilterSelect').value = state.visualizerFilter;
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
    $('#visualScaleRange').value = state.visualScale;
    $('#visualOpacityRange').value = state.visualOpacity;
    $('#visualLineWidthRange').value = state.visualLineWidth;
    $('#titleXRange').value = state.titleX;
    $('#titleYRange').value = state.titleY;
    $('#titleSizeRange').value = state.titleSize;
    $('#titleColorInput').value = state.titleColor;
    $('#titleOpacityRange').value = state.titleOpacity;
    $('#artistXRange').value = state.artistX;
    $('#artistYRange').value = state.artistY;
    $('#artistSizeRange').value = state.artistSize;
    $('#artistColorInput').value = state.artistColor;
    $('#artistOpacityRange').value = state.artistOpacity;
    $('#particleDirectionSelect').value = state.particleDirection;
    $('#particleShapeSelect').value = state.particleShape;
    $('#particleColorInput').value = state.particleColor;
    $('#particleOpacityRange').value = state.particleOpacity;
    $('#particleGlowRange').value = state.particleGlow;
    $('#particleCountRange').value = state.particleCount;
    $('#particleSizeRange').value = state.particleSize;
    $('#particleSpeedRange').value = state.particleSpeed;
    $('#beatResponseRange').value = state.beatResponse;
    $('#smoothingRange').value = state.smoothing;
    $('#cameraShakeEnabled').checked = state.cameraShakeEnabled;
    $('#cameraShakeModeSelect').value = state.cameraShakeMode;
    $('#cameraShakeRange').value = state.cameraShake;
    $('#visualizerPulseRange').value = state.visualizerPulse;
    $('#particlePulseRange').value = state.particlePulse;
    $('#vignettePulseRange').value = state.vignettePulse;
    $('#vignetteOutput').textContent = state.vignette + '%';
    $('#backgroundOpacityOutput').textContent = state.backgroundOpacity + '%';
    $('#logoSizeOutput').textContent = state.logoSize + '%';
    $('#logoOpacityOutput').textContent = state.logoOpacity + '%';
    $('#logoPulseAmountOutput').textContent = state.logoPulseAmount + '%';
    $('#logoHaloCountOutput').textContent = String(state.logoHaloCount);
    $('#logoHaloWidthOutput').textContent = String(state.logoHaloWidth);
    $('#logoGlowOutput').textContent = String(state.logoGlow);
    $('#visualizerShadowOutput').textContent = String(state.visualizerShadow);
    $('#logoXOutput').textContent = state.logoX + '%';
    $('#logoYOutput').textContent = state.logoY + '%';
    $('#visualXOutput').textContent = (state.visualX > 0 ? '+' : '') + state.visualX + '%';
    $('#visualYOutput').textContent = (state.visualY > 0 ? '+' : '') + state.visualY + '%';
    $('#visualScaleOutput').textContent = state.visualScale + '%';
    $('#visualOpacityOutput').textContent = state.visualOpacity + '%';
    $('#visualLineWidthOutput').textContent = Number(state.visualLineWidth).toFixed(1) + '×';
    $('#titleXOutput').textContent = state.titleX + '%';
    $('#titleYOutput').textContent = state.titleY + '%';
    $('#titleSizeOutput').textContent = state.titleSize + '%';
    $('#titleOpacityOutput').textContent = state.titleOpacity + '%';
    $('#artistXOutput').textContent = state.artistX + '%';
    $('#artistYOutput').textContent = state.artistY + '%';
    $('#artistSizeOutput').textContent = state.artistSize + '%';
    $('#artistOpacityOutput').textContent = state.artistOpacity + '%';
    $('#particleOpacityOutput').textContent = state.particleOpacity + '%';
    $('#particleGlowOutput').textContent = String(state.particleGlow);
    $('#particleCountOutput').textContent = state.particleCount;
    $('#particleSizeOutput').textContent = Number(state.particleSize).toFixed(1) + '×';
    $('#particleSpeedOutput').textContent = Number(state.particleSpeed).toFixed(1) + '×';
    $('#beatResponseOutput').textContent = Number(state.beatResponse).toFixed(1) + '×';
    $('#smoothingOutput').textContent = state.smoothing + '%';
    $('#cameraShakeOutput').textContent = Number(state.cameraShake).toFixed(0) + ' px';
    $('#visualizerPulseOutput').textContent = state.visualizerPulse + '%';
    $('#particlePulseOutput').textContent = state.particlePulse + '%';
    $('#vignettePulseOutput').textContent = state.vignettePulse + '%';
    $('#sensitivityOutput').textContent = Number(state.sensitivity).toFixed(1) + '×';
    $('#glowOutput').textContent = String(state.glow);
    renderVisualizerLayerList();
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
    if (!['spectrum', 'orbit', 'wave', 'aurora', 'radial', 'impact', 'matrix', 'scope', 'tunnel', 'shockwave', 'bars3d'].includes(style)) return;
    state.style = style;
    $$('.preset-card').forEach(function (button) {
      button.classList.toggle('active', button.dataset.style === style);
    });
    const statusNames = {
      spectrum: 'NEON SPECTRUM',
      orbit: 'ORBITAL FIELD',
      wave: 'PURE WAVEFORM',
      aurora: 'AURORA FLOW',
      radial: 'SONIC CORE',
      impact: 'BASS IMPACT',
      matrix: 'POWER MATRIX',
      scope: 'LIVE OSCILLOSCOPE',
      tunnel: 'SONIC TUNNEL',
      shockwave: 'BASS SHOCKWAVE',
      bars3d: 'FREQUENCY WALL'
    };
    $('#previewStatus').textContent = state.file ? 'AUDIO REACTIVE' : 'DEMO · ' + statusNames[style];
    // The capped animation loop renders the new style on the next frame instead of blocking the click.
  }

  function setPalette(name) {
    const palette = palettes[name];
    if (!palette) return;
    state.colorOne = palette.one;
    state.colorTwo = palette.two;
    state.background = palette.bg;
    state.particleColor = palette.one;
    state.artistColor = palette.one;
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
    const dt = Math.max(0.008, Math.min(0.06, (now - (state.lastAudioTime || now - 33.3)) / 1000));
    state.lastAudioTime = now;
    if (state.analyser && state.frequencyData) {
      state.analyser.getByteFrequencyData(state.frequencyData);
      if (state.timeData) state.analyser.getByteTimeDomainData(state.timeData);
    }

    let bassEnergy = 0;
    let bassSamples = 0;
    if (active && state.frequencyData && state.audioContext) {
      const bins = state.frequencyData;
      const bands = state.frequencyBands;
      for (let i = 0; i < bandCount; i++) {
        const band = bands[i];
        let sum = 0;
        let count = 0;
        for (let b = band.start; b <= band.end; b++) {
          sum += bins[b];
          count++;
        }
        const raw = count ? sum / count : 0;
        const normalized = Math.max(0, Math.min(1, (raw - 7) / 210));
        const target = Math.max(0, Math.min(1.5, Math.pow(normalized, 0.68) * state.sensitivity));
        if (i < 46) {
          bassEnergy += normalized;
          bassSamples++;
        }
        const previous = state.smoothedBands[i];
        const attack = 0.42 + (1 - state.smoothing / 100) * 0.52;
        const release = 0.38 - (state.smoothing / 100) * 0.27;
        state.smoothedBands[i] = previous + (target - previous) * Math.min(0.96, target > previous ? attack : release);
        state.peakBands[i] = Math.max(state.smoothedBands[i], state.peakBands[i] - dt * (1.2 + state.smoothing / 42));
      }
      bassEnergy = bassSamples ? bassEnergy / bassSamples : 0;
      const flux = Math.max(0, bassEnergy - state.lastBassEnergy);
      const transient = Math.max(0, bassEnergy - state.bassEnvelope * 1.04);
      const hit = Math.max(flux * 5.2, transient * 1.7) * state.beatResponse;
      state.beatPulse = Math.max(Math.min(1, hit), state.beatPulse * Math.exp(-dt * 5.6));
      state.bassEnvelope = state.bassEnvelope * 0.89 + bassEnergy * 0.11;
      state.lastBassEnergy = bassEnergy;
    } else {
      state.beatPulse *= Math.exp(-dt * 3.5);
      for (let i = 0; i < bandCount; i++) {
        state.smoothedBands[i] *= 0.94;
        state.peakBands[i] *= 0.92;
      }
    }

    const demo = function (index, count) {
      const t = now / 1000;
      const position = index / Math.max(1, count);
      return (0.06 + Math.max(0, Math.sin(t * 1.35 + position * 17)) * 0.28
        + Math.max(0, Math.sin(t * 2.25 - position * 7.4)) * 0.18) * state.sensitivity;
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
        const bassBoost = Math.max(0, state.beatPulse * (1 - pos) * 0.18);
        return Math.max(0, Math.min(1.45, smooth + Math.max(0, peak - smooth) * 0.2 + bassBoost));
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

  function drawBackground(w, h, now, audioValues, effects) {
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
      if (effects && effects.shakeEnabled) ctx.translate(effects.shakeX * 0.58, effects.shakeY * 0.58);
      const travelScale = now * 0.000012 * state.particleSpeed;
      for (let i = 0; i < state.particles.length; i++) {
        const p = state.particles[i];
        const travel = ((travelScale * p.speed) % 1 + 1) % 1;
        let nx = p.x;
        let ny = p.y;
        if (state.particleDirection === 'up') ny = (p.y - travel + 1) % 1;
        else if (state.particleDirection === 'down') ny = (p.y + travel) % 1;
        else if (state.particleDirection === 'left') nx = (p.x - travel + 1) % 1;
        else if (state.particleDirection === 'right') nx = (p.x + travel) % 1;
        else if (state.particleDirection === 'out' || state.particleDirection === 'in') {
          const angle = p.phase;
          let radius = Math.hypot(p.x - 0.5, p.y - 0.5) + travel * 0.68;
          if (state.particleDirection === 'in') radius = Math.hypot(p.x - 0.5, p.y - 0.5) - travel * 0.68;
          radius = (radius % 0.74 + 0.74) % 0.74;
          nx = 0.5 + Math.cos(angle) * radius;
          ny = 0.5 + Math.sin(angle) * radius;
          if (nx < 0 || nx > 1 || ny < 0 || ny > 1) { nx = p.x; ny = p.y; }
        } else {
          nx = (p.x + Math.sin(now / 1600 * p.speed * state.particleSpeed + p.phase) * 0.025 + 1) % 1;
          ny = (p.y + Math.cos(now / 1850 * p.speed * state.particleSpeed + p.phase) * 0.025 + 1) % 1;
        }
        const x = nx * w;
        const y = ny * h;
        const pulseSize = 1 + (effects ? effects.pulse : 0) * state.particlePulse / 100 * 0.8;
        const size = Math.max(0.6, p.size * state.particleSize * Math.max(0.7, w / 1280) * pulseSize);
        const shimmer = 0.72 + 0.28 * Math.sin(now / 700 * p.speed + p.phase);
        ctx.globalAlpha = state.particleOpacity / 100 * shimmer;
        ctx.fillStyle = state.particleColor;
        ctx.strokeStyle = state.particleColor;
        ctx.shadowColor = state.particleColor;
        ctx.shadowBlur = state.particleGlow > 0 && i % 3 === 0 ? Math.min(20, state.particleGlow) : 0;
        ctx.lineWidth = Math.max(0.8, size * 0.55);
        if (state.particleShape === 'square') {
          ctx.fillRect(x - size, y - size, size * 2, size * 2);
        } else if (state.particleShape === 'diamond') {
          ctx.beginPath(); ctx.moveTo(x, y - size * 1.5); ctx.lineTo(x + size, y); ctx.lineTo(x, y + size * 1.5); ctx.lineTo(x - size, y); ctx.closePath(); ctx.fill();
        } else if (state.particleShape === 'line') {
          const angle = p.phase + ((state.particleDirection === 'left' || state.particleDirection === 'right') ? 0 : Math.PI / 2);
          ctx.beginPath(); ctx.moveTo(x - Math.cos(angle) * size * 2.2, y - Math.sin(angle) * size * 2.2); ctx.lineTo(x + Math.cos(angle) * size * 2.2, y + Math.sin(angle) * size * 2.2); ctx.stroke();
        } else if (state.particleShape === 'star') {
          ctx.beginPath();
          for (let point = 0; point < 10; point++) {
            const radius = point % 2 === 0 ? size * 1.65 : size * 0.68;
            const angle = point * Math.PI / 5 - Math.PI / 2;
            const px = x + Math.cos(angle) * radius;
            const py = y + Math.sin(angle) * radius;
            if (point === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath(); ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    }

    if (state.showVignette && state.vignette > 0) {
      const pulseVignette = effects ? effects.pulse * state.vignettePulse : 0;
      const amount = clamp(state.vignette + pulseVignette, 0, 100) / 100;
      const vignette = ctx.createRadialGradient(w * 0.5, h * 0.48, Math.min(w, h) * 0.12, w * 0.5, h * 0.48, Math.max(w, h) * 0.74);
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(0.55, 'rgba(0,0,0,' + (amount * 0.15) + ')');
      vignette.addColorStop(1, 'rgba(0,0,0,' + (amount * 0.78) + ')');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
    }
  }

  function traceLogoShape(cx, cy, size, shape) {
    const half = size / 2;
    ctx.beginPath();
    if (shape === 'square') ctx.rect(cx - half, cy - half, size, size);
    else if (shape === 'diamond') { ctx.moveTo(cx, cy - half); ctx.lineTo(cx + half, cy); ctx.lineTo(cx, cy + half); ctx.lineTo(cx - half, cy); ctx.closePath(); }
    else if (shape === 'hexagon') {
      for (let i = 0; i < 6; i++) { const angle = i * Math.PI / 3 - Math.PI / 6, x = cx + Math.cos(angle) * half, y = cy + Math.sin(angle) * half; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.closePath();
    } else ctx.arc(cx, cy, half, 0, Math.PI * 2);
  }

  function drawCenterLogo(w, h, now, values) {
    const baseSize = Math.max(22, Math.min(w, h) * state.logoSize / 100);
    const cx = w * state.logoX / 100, cy = h * state.logoY / 100;
    const beat = clamp(values && values.beat || 0, 0, 1), bass = clamp((values && values.bass || 0) * 3.6, 0, 1);
    const pulse = state.logoPulseMode === 'beat' ? beat : state.logoPulseMode === 'bass' ? bass : Math.max(beat, bass);
    const pulseAmt = state.logoPulseEnabled ? pulse * state.logoPulseAmount / 100 : 0;
    const size = baseSize * (1 + pulseAmt * 0.28);
    ctx.save();
    if (state.logoHaloEnabled && state.logoHaloCount > 0) {
      for (let ring = state.logoHaloCount; ring >= 1; ring--) {
        const radiusSize = size * (1.18 + ring * 0.19 + pulseAmt * 0.13), count = Math.max(48, 128 - ring * 10);
        ctx.save(); ctx.globalAlpha = state.logoOpacity / 100 * (0.25 + (state.logoHaloCount - ring + 1) / state.logoHaloCount * 0.62);
        ctx.lineWidth = Math.max(1, state.logoHaloWidth * (ring === 1 ? 1.35 : 0.8)); ctx.lineCap = 'round';
        for (let i = 0; i < count; i++) {
          const angle = i / count * Math.PI * 2, level = values && values.level ? values.level(i + ring * 11, count) : 0.1;
          const inner = radiusSize * 0.47, outer = inner + size * (0.03 + level * 0.2 + pulseAmt * 0.08);
          ctx.beginPath(); ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner); ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
          ctx.strokeStyle = i % 5 === 0 ? state.logoHaloColor : rgba(state.logoHaloColor, 0.78); ctx.shadowColor = state.logoHaloColor; ctx.shadowBlur = Math.min(24, state.logoGlow * 0.9); ctx.stroke();
        }
        ctx.restore();
      }
      for (let ring = 1; ring <= state.logoHaloCount; ring++) {
        traceLogoShape(cx, cy, size * (1.12 + ring * 0.16 + pulseAmt * 0.1), state.logoShape);
        ctx.strokeStyle = rgba(state.logoHaloColor, 0.1 + pulseAmt * 0.17); ctx.lineWidth = Math.max(0.8, state.logoHaloWidth * 0.65); ctx.shadowBlur = Math.min(16, state.logoGlow * 0.55); ctx.shadowColor = state.logoHaloColor; ctx.stroke();
      }
    }
    ctx.globalAlpha = state.logoOpacity / 100;
    traceLogoShape(cx, cy, size, state.logoShape); ctx.fillStyle = 'rgba(8,11,18,0.86)'; ctx.shadowBlur = state.logoGlow + pulseAmt * 15; ctx.shadowColor = state.logoHaloColor; ctx.fill();
    ctx.save(); traceLogoShape(cx, cy, Math.max(1, size - 3), state.logoShape); ctx.clip();
    if (state.logoImage) drawCoverImageInShape(state.logoImage, cx, cy, size);
    else { ctx.shadowBlur = 0; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f5f6f8'; ctx.font = '800 ' + Math.max(12, size * 0.31) + 'px Manrope, sans-serif'; ctx.fillText('НсП', cx, cy); }
    ctx.restore(); ctx.shadowBlur = 0; traceLogoShape(cx, cy, size, state.logoShape); ctx.strokeStyle = rgba(state.logoHaloColor, 0.9); ctx.lineWidth = Math.max(1.2, size * 0.012); ctx.stroke(); ctx.restore();
  }

  function drawCoverImageInShape(image, cx, cy, size) {
    if (!image || !image.width || !image.height) return;
    const scale = Math.max(size / image.width, size / image.height), iw = image.width * scale, ih = image.height * scale;
    ctx.drawImage(image, cx - iw / 2, cy - ih / 2, iw, ih);
  }


  function colorGradient(y1, y2) {
    const gradient = ctx.createLinearGradient(0, y1, 0, y2);
    if (!state.visualizerGradient) {
      gradient.addColorStop(0, state.colorOne); gradient.addColorStop(0.52, state.colorOne); gradient.addColorStop(1, rgba(state.colorOne, 0.08));
    } else {
      gradient.addColorStop(0, state.colorOne); gradient.addColorStop(0.52, state.colorTwo); gradient.addColorStop(1, rgba(state.colorTwo, 0.08));
    }
    return gradient;
  }

  function drawSpectrum(w, h, now, values) {
    const count = Math.max(50, Math.min(104, Math.floor(w / 13)));
    const gap = Math.max(2, w * 0.003);
    const cell = (w - 100) / count;
    const barW = Math.max(1, (cell - gap) * (0.68 + state.visualLineWidth * 0.22));
    const baseline = h * 0.61;
    const maxH = h * 0.34;
    const gradient = colorGradient(baseline - maxH, baseline + 2);
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.shadowBlur = 0;
    for (let i = 0; i < count; i++) {
      const level = values.level(i, count);
      const barH = Math.max(2, Math.min(maxH, Math.pow(level, 0.82) * maxH * 1.12));
      const x = 50 + i * cell + (cell - barW) * 0.5;
      ctx.globalAlpha = 0.92;
      if (ctx.roundRect) {
        ctx.beginPath(); ctx.roundRect(x, baseline - barH, barW, barH, Math.min(barW * 0.45, 6)); ctx.fill();
      } else {
        ctx.fillRect(x, baseline - barH, barW, barH);
      }
      ctx.globalAlpha = 0.13;
      ctx.fillRect(x, baseline + 5, barW, barH * 0.22);
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = rgba(state.colorOne, 0.38);
    ctx.lineWidth = Math.max(1, state.visualLineWidth);
    ctx.shadowColor = state.colorOne;
    ctx.shadowBlur = Math.min(18, state.glow * 0.65);
    ctx.beginPath(); ctx.moveTo(36, baseline + 1); ctx.lineTo(w - 36, baseline + 1); ctx.stroke();
    ctx.restore();

  }

  function drawOrbit(w, h, now, values) {
    const cx = w * 0.5;
    const cy = h * 0.46;
    const radius = Math.min(w, h) * 0.19;
    ctx.save();
    ctx.lineWidth = Math.max(1, state.visualLineWidth);
    ctx.shadowBlur = Math.min(18, state.glow * 0.6);
    ctx.shadowColor = state.colorTwo;
    ctx.strokeStyle = rgba(state.colorTwo, 0.58);
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rgba(state.colorOne, 0.24);
    ctx.beginPath(); ctx.arc(cx, cy, radius * 1.28, 0, Math.PI * 2); ctx.stroke();
    const count = Math.min(280, Math.max(100, Math.floor(Math.min(w, h) * 0.34)));
    const baseWidth = Math.max(1, w / 900 * 2.0 * state.visualLineWidth);
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2 + now / 24000;
      const amp = Math.max(2, Math.pow(values.level(i, count), 0.82) * Math.min(w, h) * 0.17);
      const inner = radius + 7;
      const outer = inner + amp;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.lineWidth = baseWidth;
      ctx.strokeStyle = i % 2 === 0 ? state.colorOne : state.colorTwo;
      ctx.stroke();
    }
    ctx.restore();

  }

  function drawWave(w, h, now, values) {
    const mid = h * 0.48;
    const count = 280;
    const amplitude = h * 0.19;
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
      ctx.lineWidth = (layer === 0 ? 3 : 6 - layer) * Math.max(0.6, w / 1280) * state.visualLineWidth;
      ctx.shadowBlur = Math.min(18, state.glow * 0.6);
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
      ctx.lineWidth = (index === 0 ? 4 : 2.6) * Math.max(0.8, w / 1280) * state.visualLineWidth;
      ctx.shadowBlur = Math.min(18, state.glow * 0.6);
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
    const count = Math.min(260, Math.max(96, Math.floor(Math.min(w, h) * 0.27)));
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowBlur = 0;
    const baseWidth = Math.max(1.1, w / 800 * 1.5 * state.visualLineWidth);
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2 - Math.PI / 2;
      const level = values.level(i, count);
      const inner = radius + Math.sin(now / 1100 + i * 0.17) * 2;
      const outer = inner + 7 + Math.pow(level, 0.82) * Math.min(w, h) * 0.21;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.strokeStyle = i % 3 === 0 ? state.colorOne : state.colorTwo;
      ctx.lineWidth = baseWidth;
      ctx.stroke();
    }
    ctx.restore();

  }

  function titleAnchor(w, xPercent) {
    return xPercent > 72 ? { x: Math.min(w - 12, w * xPercent / 100), align: 'right' } : { x: Math.max(12, Math.min(w - 12, w * xPercent / 100)), align: 'left' };
  }

  function drawTypography(w, h) {
    if (!state.showTitle) return;
    const title = ($('#trackTitle').value || 'Без названия').trim();
    const artist = ($('#trackArtist').value || 'НсП').trim();
    const base = Math.min(w, h);
    const titlePx = Math.max(16, Math.min(Math.round(w * 0.048), Math.round(h * 0.085))) * state.titleSize / 100;
    const artistPx = Math.max(10, Math.round(base * 0.022)) * state.artistSize / 100;
    const titleAnchorPos = titleAnchor(w, state.titleX);
    const artistAnchorPos = titleAnchor(w, state.artistX);
    const titleY = Math.max(10, Math.min(h - titlePx - 12, h * state.titleY / 100));
    const artistY = Math.max(10, Math.min(h - artistPx - 12, h * state.artistY / 100));
    const maxWidth = w * 0.84;

    ctx.save();
    ctx.textBaseline = 'top';
    ctx.textAlign = titleAnchorPos.align;
    ctx.font = '800 ' + Math.round(titlePx) + 'px Manrope, sans-serif';
    let shownTitle = title;
    while (shownTitle.length > 2 && ctx.measureText(shownTitle).width > maxWidth) shownTitle = shownTitle.slice(0, -2).trimEnd() + '…';
    ctx.globalAlpha = state.titleOpacity / 100;
    ctx.fillStyle = state.titleColor;
    ctx.shadowBlur = Math.min(10, state.glow * 0.35);
    ctx.shadowColor = state.titleColor;
    ctx.fillText(shownTitle, titleAnchorPos.x, titleY, maxWidth);
    ctx.restore();

    ctx.save();
    ctx.textBaseline = 'top';
    ctx.textAlign = artistAnchorPos.align;
    ctx.font = '600 ' + Math.round(artistPx) + 'px Manrope, sans-serif';
    let shownArtist = artist.toUpperCase();
    while (shownArtist.length > 2 && ctx.measureText(shownArtist).width > maxWidth) shownArtist = shownArtist.slice(0, -2).trimEnd() + '…';
    ctx.globalAlpha = state.artistOpacity / 100;
    ctx.fillStyle = state.artistColor;
    ctx.shadowBlur = 0;
    ctx.fillText(shownArtist, artistAnchorPos.x, artistY, maxWidth);
    ctx.restore();
  }

  function drawImpact(w, h, now, values) {
    const cx = w * 0.5, cy = h * 0.49, size = Math.min(w, h);
    const beat = values.beat || 0;
    ctx.save();
    ctx.lineCap = 'round';
    for (let layer = 0; layer < 3; layer++) {
      const points = 240;
      const base = size * (0.075 + layer * 0.038 + beat * 0.035);
      ctx.beginPath();
      for (let i = 0; i <= points; i++) {
        const angle = i / points * Math.PI * 2;
        const level = values.level(i + layer * 19, points);
        const radius = base + Math.pow(level, 0.76) * size * (0.065 + layer * 0.012)
          + Math.sin(angle * (11 + layer * 4) + now / (125 + layer * 28)) * size * 0.003;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = layer === 0 ? rgba(state.colorOne, 0.95) : rgba(state.colorTwo, 0.46 - layer * 0.08);
      ctx.lineWidth = Math.max(1, (2.8 - layer * 0.55) * state.visualLineWidth);
      ctx.shadowColor = layer === 0 ? state.colorOne : state.colorTwo;
      ctx.shadowBlur = Math.min(24, state.glow * 0.82);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    const rays = Math.min(220, Math.max(110, Math.floor(size * 0.28)));
    for (let i = 0; i < rays; i++) {
      const angle = i / rays * Math.PI * 2;
      const level = Math.pow(values.level(i, rays), 0.78);
      const inner = size * (0.14 + beat * 0.045);
      const outer = inner + size * (0.025 + level * 0.19);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.strokeStyle = i % 5 === 0 ? state.colorOne : rgba(state.colorTwo, 0.68);
      ctx.lineWidth = Math.max(0.8, (i % 5 === 0 ? 2.1 : 1.05) * state.visualLineWidth);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMatrix(w,h,now,values){
    const columns=Math.min(100,Math.max(56,Math.floor(w/11))),gap=Math.max(2,w*.0025),cw=(w-80)/columns-gap,mid=h*.58,maxHeight=h*.37;ctx.save();
    for(let i=0;i<columns;i++){const level=Math.max(.015,Math.pow(values.level(i,columns),.8)),blocks=Math.max(1,Math.min(18,Math.ceil(level*16))),x=40+i*(cw+gap);
      for(let b=0;b<blocks;b++){const t=b/Math.max(1,blocks),bh=Math.max(2,h*.012),y=mid-(b+1)*(maxHeight/18);
        ctx.globalAlpha=.35+t*.65;ctx.fillStyle=b>blocks-3?state.colorOne:state.colorTwo;ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=b===blocks-1?Math.min(18,state.glow):0;
        ctx.fillRect(x,y,cw,bh);ctx.globalAlpha=.08+t*.16;ctx.fillRect(x,mid+b*maxHeight/18+5,cw,bh*.8);}}
    ctx.globalAlpha=.55;ctx.shadowBlur=Math.min(18,state.glow*.7);ctx.shadowColor=state.colorOne;ctx.strokeStyle=rgba(state.colorOne,.5);ctx.lineWidth=Math.max(1,state.visualLineWidth);
    ctx.beginPath();ctx.moveTo(34,mid);ctx.lineTo(w-34,mid);ctx.stroke();ctx.restore();
  }

  function drawScope(w,h,now,values){
    const mid=h*.49,count=500;ctx.save();
    for(let layer=2;layer>=0;layer--){ctx.beginPath();const phase=now/1000*(layer===0?1:.72)+layer*.45;
      for(let i=0;i<=count;i++){const x=i/count*w,wave=values.wave(i,count),low=values.level(Math.floor(i/count*80),80),y=mid+(wave*.82+Math.sin(i/count*Math.PI*24+phase)*.09)*h*(.22+low*.1);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
      ctx.strokeStyle=layer===0?state.colorOne:rgba(state.colorTwo,.18+layer*.16);ctx.lineWidth=(layer===0?3.8:6-layer)*Math.max(.7,w/1280)*state.visualLineWidth;
      ctx.shadowColor=layer===0?state.colorOne:state.colorTwo;ctx.shadowBlur=Math.min(24,state.glow*.85);ctx.stroke();}
    ctx.shadowBlur=0;ctx.globalAlpha=.24;ctx.strokeStyle=state.colorTwo;ctx.lineWidth=1;for(let i=1;i<8;i++){ctx.beginPath();ctx.moveTo(0,h*i/8);ctx.lineTo(w,h*i/8);ctx.stroke();}ctx.restore();
  }

  function drawTunnel(w,h,now,values){
    const cx=w*.5,cy=h*.48,size=Math.min(w,h),sides=10,layers=12;ctx.save();ctx.lineJoin='round';
    for(let layer=layers-1;layer>=0;layer--){const progress=layer/layers,motion=(now/2800+progress)%1,radius=size*(.035+motion*.49);ctx.beginPath();
      for(let p=0;p<=sides;p++){const angle=p/sides*Math.PI*2-Math.PI/2+now/17000*(layer%2?1:-1),f=values.level(p*5+layer*13,sides*5),r=radius*(1+f*.11),x=cx+Math.cos(angle)*r,y=cy+Math.sin(angle)*r*(h/w>1.2?1.18:.82);if(p===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
      ctx.strokeStyle=layer%3===0?rgba(state.colorOne,.82):rgba(state.colorTwo,.36+(1-progress)*.3);ctx.lineWidth=Math.max(.8,(2.3-progress)*state.visualLineWidth);
      ctx.shadowColor=layer%3===0?state.colorOne:state.colorTwo;ctx.shadowBlur=Math.min(18,state.glow*.65);ctx.stroke();}ctx.restore();
  }

  // Broad bass waves with no central sphere.
  function drawShockwave(w, h, now, values) {
    const mid = h * 0.5, layers = 5, samples = 260;
    ctx.save();
    ctx.lineCap = 'round';
    for (let layer = 0; layer < layers; layer++) {
      const centerY = mid + (layer - (layers - 1) / 2) * h * 0.075;
      const direction = layer % 2 ? -1 : 1;
      ctx.beginPath();
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const level = values.level(i + layer * 23, samples);
        const wave = values.wave(i, samples);
        const envelope = Math.pow(Math.max(0, Math.sin(t * Math.PI)), 0.72);
        const impactValue = (wave * 0.22 + Math.sin(t * Math.PI * (5 + layer) + now / 210 * direction) * 0.075
          + (level - 0.16) * 0.36) * h * envelope;
        const x = t * w, y = centerY + impactValue;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = layer % 2 ? rgba(state.colorTwo, 0.5) : rgba(state.colorOne, 0.88);
      ctx.lineWidth = Math.max(1, (layer === 2 ? 3.6 : 1.6) * state.visualLineWidth);
      ctx.shadowColor = layer % 2 ? state.colorTwo : state.colorOne;
      ctx.shadowBlur = Math.min(22, state.glow * (layer === 2 ? 0.85 : 0.45));
      ctx.stroke();
    }
    ctx.restore();
  }

  // Mirrored frequency wall for hard, bass-led visuals.
  function drawBars3d(w, h, now, values) {
    const count = Math.max(56, Math.min(112, Math.floor(w / 11)));
    const gap = Math.max(2, w * 0.0026);
    const cell = (w - 72) / count;
    const barW = Math.max(1.2, cell - gap);
    const mid = h * 0.53, maxH = h * 0.34;
    const gradient = ctx.createLinearGradient(0, mid - maxH, 0, mid + maxH);
    gradient.addColorStop(0, state.colorTwo);
    gradient.addColorStop(0.48, state.colorOne);
    gradient.addColorStop(1, rgba(state.colorTwo, 0.22));
    ctx.save();
    ctx.fillStyle = gradient;
    for (let i = 0; i < count; i++) {
      const level = Math.max(0.025, Math.pow(values.level(i, count), 0.78));
      const kick = (values.beat || 0) * 0.16 * (1 - i / count);
      const barH = Math.min(maxH, maxH * (level * 0.92 + kick));
      const x = 36 + i * cell + (cell - barW) * 0.5;
      ctx.globalAlpha = 0.94;
      if (ctx.roundRect) {
        ctx.beginPath(); ctx.roundRect(x, mid - barH, barW, barH, Math.min(4, barW * 0.35)); ctx.fill();
        ctx.beginPath(); ctx.roundRect(x, mid + 6, barW, barH * 0.7, Math.min(4, barW * 0.35)); ctx.fill();
      } else {
        ctx.fillRect(x, mid - barH, barW, barH);
        ctx.fillRect(x, mid + 6, barW, barH * 0.7);
      }
      if (i % 6 === 0) {
        ctx.globalAlpha = 0.4;
        ctx.shadowColor = state.colorOne;
        ctx.shadowBlur = Math.min(14, state.glow * 0.55);
        ctx.fillRect(x, mid - barH, barW, Math.max(2, state.visualLineWidth * 2));
        ctx.shadowBlur = 0;
      }
    }
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = rgba(state.colorOne, 0.6);
    ctx.lineWidth = Math.max(1, state.visualLineWidth);
    ctx.beginPath(); ctx.moveTo(30, mid + 2); ctx.lineTo(w - 30, mid + 2); ctx.stroke();
    ctx.restore();
  }


  function visualizerFilterCss(filter) {
    return ({none:'',punch:'contrast(1.22) saturate(1.18)',mono:'grayscale(1) contrast(1.08)',warm:'sepia(.25) saturate(1.25)',cold:'hue-rotate(16deg) saturate(1.22)',bloom:'brightness(1.18) saturate(1.45)'})[filter] || '';
  }
  function drawSelectedVisualizer(w,h,now,values) {
    if (state.style === 'spectrum') drawSpectrum(w,h,now,values);
    else if (state.style === 'orbit') drawOrbit(w,h,now,values);
    else if (state.style === 'wave') drawWave(w,h,now,values);
    else if (state.style === 'aurora') drawAurora(w,h,now,values);
    else if (state.style === 'radial') drawRadial(w,h,now,values);
    else if (state.style === 'impact') drawImpact(w,h,now,values);
    else if (state.style === 'matrix') drawMatrix(w,h,now,values);
    else if (state.style === 'scope') drawScope(w,h,now,values);
    else if (state.style === 'tunnel') drawTunnel(w,h,now,values);
    else if (state.style === 'shockwave') drawShockwave(w,h,now,values);
    else if (state.style === 'bars3d') drawBars3d(w,h,now,values);
  }
  function drawVisualizerLayer(w,h,now,values,layer) {
    const original={colorOne:state.colorOne,colorTwo:state.colorTwo,glow:state.glow,visualizerGradient:state.visualizerGradient};
    const colorOne=layer?layer.colorOne:state.colorOne,colorTwo=layer?layer.colorTwo:state.colorTwo;
    const glow=layer?layer.glow:state.glow,gradient=layer?layer.gradient:state.visualizerGradient;
    const shadow=layer?layer.shadow:state.visualizerShadow;
    state.colorOne=colorOne;state.colorTwo=gradient?colorTwo:colorOne;state.glow=glow;state.visualizerGradient=gradient;
    const impact=state.cameraShakeMode==='beat'?values.beat:state.cameraShakeMode==='bass'?clamp(values.bass*3.6,0,1):Math.max(values.beat,clamp(values.bass*3.6,0,1));
    const dx=w*state.visualX/100+(state.cameraShakeEnabled?state.cameraShake*impact*Math.sin(now*.117):0)+(layer?w*layer.x/100:0);
    const dy=h*state.visualY/100+(state.cameraShakeEnabled?state.cameraShake*impact*.72*Math.cos(now*.151):0)+(layer?h*layer.y/100:0);
    const scale=state.visualScale/100*(1+impact*state.visualizerPulse/100*.34)*(layer?layer.scale/100:1);
    ctx.save();ctx.translate(w*.5+dx,h*.5+dy);ctx.scale(scale,scale);ctx.translate(-w*.5,-h*.5);
    ctx.globalAlpha=state.visualOpacity/100*(layer?layer.opacity/100:1);
    if('filter' in ctx){const pieces=[visualizerFilterCss(state.visualizerFilter)];if(shadow>0)pieces.push('drop-shadow(0px 0px '+Math.min(40,shadow)+'px '+colorOne+')');ctx.filter=pieces.filter(Boolean).join(' ')||'none';}
    drawSelectedVisualizer(w,h,now,values);ctx.restore();
    state.colorOne=original.colorOne;state.colorTwo=original.colorTwo;state.glow=original.glow;state.visualizerGradient=original.visualizerGradient;
  }

  function drawFrame(now) {
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const values = getAudioValues(now);
    const beatPulse = clamp(values.beat || 0, 0, 1);
    const bassPulse = clamp((values.bass || 0) * 3.6, 0, 1);
    const impactPulse = state.cameraShakeMode === 'beat' ? beatPulse : state.cameraShakeMode === 'bass' ? bassPulse : Math.max(beatPulse, bassPulse);
    const shake = state.cameraShakeEnabled ? state.cameraShake * impactPulse : 0;
    const shakeX = Math.sin(now * 0.117) * shake;
    const shakeY = Math.cos(now * 0.151) * shake * 0.72;
    const effects = { pulse: impactPulse, shakeX: shakeX, shakeY: shakeY, shakeEnabled: state.cameraShakeEnabled };
    drawBackground(w, h, now, values, effects);

    if (state.showVisualizer) {
      drawVisualizerLayer(w,h,now,values,null);
      state.visualizerLayers.forEach(function(layer){if(layer.enabled!==false)drawVisualizerLayer(w,h,now,values,layer);});
    }

    ctx.save();
    if (state.cameraShakeEnabled) ctx.translate(shakeX * 0.32, shakeY * 0.32);
    if (state.showLogo) drawCenterLogo(w,h,now,values);
    drawTypography(w, h);
    ctx.restore();
    state.lastFrameTime = now;
  }

  function animate(now) {
    if (document.hidden) {
      window.requestAnimationFrame(animate);
      return;
    }
    if (now - state.lastRenderAt >= 1000 / 30) {
      drawFrame(now);
      state.lastRenderAt = now;
    }
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
      state.frequencyBands = [];
      const nyquist = state.audioContext.sampleRate / 2;
      const minHz = 28;
      const maxHz = Math.min(18000, nyquist * 0.94);
      const logSpan = Math.log(maxHz / minHz);
      for (let i = 0; i < state.smoothedBands.length; i++) {
        const f0 = minHz * Math.exp((i / state.smoothedBands.length) * logSpan);
        const f1 = minHz * Math.exp(((i + 1) / state.smoothedBands.length) * logSpan);
        const start = Math.max(0, Math.min(state.frequencyData.length - 1, Math.floor(f0 / nyquist * state.frequencyData.length)));
        const end = Math.max(start, Math.min(state.frequencyData.length - 1, Math.ceil(f1 / nyquist * state.frequencyData.length)));
        state.frequencyBands.push({ start: start, end: end });
      }
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

  function supportedRecorderType(preferMp4) {
    if (!window.MediaRecorder) return '';
    const mp4Types = ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'];
    const webmTypes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const types = preferMp4 ? mp4Types : webmTypes;
    return types.find(function (type) { return MediaRecorder.isTypeSupported(type); }) || '';
  }

  function setExportUI(active) {
    const selectedFormat = $('#exportFormatSelect').value || 'mp4';
    const actionText = selectedFormat.toUpperCase();
    const activeText = state.converting ? '↻ Конвертация MP4…' : '■ Остановить запись';
    $('#exportButton').textContent = active ? activeText : '● Экспорт ' + actionText;
    $('#topExportButton').textContent = active ? activeText : '↗ Экспорт ' + actionText;
    $('#exportButton').classList.toggle('recording', active);
    $('#topExportButton').classList.toggle('recording', active);
    $('#exportProgressWrap').hidden = !active;
  }

  function loadExternalScript(src) {
    return new Promise(function (resolve, reject) {
      const existing = Array.from(document.scripts).find(function (script) { return script.src === src; });
      if (existing) {
        if (window.FFmpeg && window.FFmpeg.createFFmpeg) resolve();
        else reject(new Error('Не удалось инициализировать конвертер MP4.'));
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = function () { reject(new Error('Не удалось загрузить конвертер MP4. Проверь интернет и повтори экспорт.')); };
      document.head.appendChild(script);
    });
  }

  async function convertWebmToMp4(webmBlob) {
    if (!state.ffmpegPromise) {
      state.ffmpegPromise = (async function () {
        if (!window.FFmpeg || !window.FFmpeg.createFFmpeg) {
          await loadExternalScript('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js');
        }
        const api = window.FFmpeg;
        if (!api || !api.createFFmpeg || !api.fetchFile) throw new Error('Конвертер MP4 не инициализировался.');
        const ffmpeg = api.createFFmpeg({
          log: false,
          corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js',
          progress: function (progress) {
            const ratio = progress && Number.isFinite(progress.ratio) ? progress.ratio : 0;
            $('#exportProgress').style.width = Math.round(12 + Math.max(0, Math.min(1, ratio)) * 84) + '%';
            $('#exportStatus').textContent = 'Конвертируем MP4…';
          }
        });
        await ffmpeg.load();
        return { ffmpeg: ffmpeg, fetchFile: api.fetchFile };
      })().catch(function (error) { state.ffmpegPromise = null; throw error; });
    }
    const ready = await state.ffmpegPromise;
    const ffmpeg = ready.ffmpeg;
    const inputName = 'nsp-recording-input.webm';
    const outputName = 'nsp-recording-output.mp4';
    try {
      ffmpeg.FS('writeFile', inputName, await ready.fetchFile(webmBlob));
      await ffmpeg.run('-i', inputName, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputName);
      const data = ffmpeg.FS('readFile', outputName);
      const exactBytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      return new Blob([exactBytes], { type: 'video/mp4' });
    } finally {
      try { ffmpeg.FS('unlink', inputName); } catch {}
      try { ffmpeg.FS('unlink', outputName); } catch {}
    }
  }

  function downloadVideoBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
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
    if (state.converting) { toast('Дождись завершения конвертации MP4.', true); return; }
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
    const wantsMp4 = $('#exportFormatSelect').value === 'mp4';
    const nativeMp4Type = wantsMp4 ? supportedRecorderType(true) : '';
    const mimeType = nativeMp4Type || supportedRecorderType(false);
    if (!mimeType) { toast('Браузер не поддерживает запись видео. Попробуй обновить Chrome.', true); return; }
    state.currentExportFormat = wantsMp4 ? 'mp4' : 'webm';
    state.currentRecorderMimeType = mimeType;

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
      state.recorder.onstop = async function () {
        window.clearInterval(state.recordingTimer);
        state.recordingTimer = null;
        if (state.recordingStream) state.recordingStream.getTracks().forEach(function (track) { track.stop(); });
        state.recordingStream = null;
        const blob = new Blob(state.chunks, { type: mimeType });
        state.chunks = [];
        state.recorder = null;
        $('#exportProgress').style.width = '0%';
        const wantsMp4Now = state.currentExportFormat === 'mp4';
        const recordedMp4 = mimeType.toLowerCase().indexOf('video/mp4') === 0;
        const filenameBase = 'nsp-visualizer-' + new Date().toISOString().slice(0, 10);
        if (blob.size <= 0) {
          setExportUI(false);
          toast('Запись пустая. Запусти трек и попробуй ещё раз.', true);
        } else if (wantsMp4Now && !recordedMp4) {
          state.converting = true;
          setExportUI(true);
          $('#exportStatus').textContent = 'Загрузка конвертера MP4…';
          try {
            const mp4Blob = await convertWebmToMp4(blob);
            if (!mp4Blob || mp4Blob.size <= 0) throw new Error('Конвертер вернул пустой файл.');
            downloadVideoBlob(mp4Blob, filenameBase + '.mp4');
            toast('Готово: настоящий MP4 · ' + bytesLabel(mp4Blob.size) + '.');
          } catch (error) {
            downloadVideoBlob(blob, filenameBase + '.webm');
            toast('Не удалось собрать MP4: ' + (error.message || 'ошибка конвертации') + '. Скачан исходный WebM, его формат не подменён.', true);
          } finally {
            state.converting = false;
            state.currentExportFormat = $('#exportFormatSelect').value || 'mp4';
            setExportUI(false);
            $('#exportProgress').style.width = '0%';
            $('#exportStatus').textContent = 'Экспорт завершён';
            setPlayState();
          }
          return;
        } else {
          const extension = recordedMp4 ? 'mp4' : 'webm';
          downloadVideoBlob(blob, filenameBase + '.' + extension);
          setExportUI(false);
          toast('Видео готово: ' + extension.toUpperCase() + ' · ' + bytesLabel(blob.size) + '.');
        }
        state.currentExportFormat = $('#exportFormatSelect').value || 'mp4';
        setExportUI(false);
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
    $('#logoPulseAmountOutput').textContent = state.logoPulseAmount + '%';
    $('#logoHaloCountOutput').textContent = String(state.logoHaloCount);
    $('#logoHaloWidthOutput').textContent = String(state.logoHaloWidth);
    $('#logoGlowOutput').textContent = String(state.logoGlow);
    $('#visualizerShadowOutput').textContent = String(state.visualizerShadow);
    $('#logoXOutput').textContent = state.logoX + '%';
    $('#logoYOutput').textContent = state.logoY + '%';
    $('#visualXOutput').textContent = (state.visualX > 0 ? '+' : '') + state.visualX + '%';
    $('#visualYOutput').textContent = (state.visualY > 0 ? '+' : '') + state.visualY + '%';
    $('#visualScaleOutput').textContent = state.visualScale + '%';
    $('#visualOpacityOutput').textContent = state.visualOpacity + '%';
    $('#visualLineWidthOutput').textContent = Number(state.visualLineWidth).toFixed(1) + '×';
    $('#titleXOutput').textContent = state.titleX + '%';
    $('#titleYOutput').textContent = state.titleY + '%';
    $('#titleSizeOutput').textContent = state.titleSize + '%';
    $('#titleOpacityOutput').textContent = state.titleOpacity + '%';
    $('#artistXOutput').textContent = state.artistX + '%';
    $('#artistYOutput').textContent = state.artistY + '%';
    $('#artistSizeOutput').textContent = state.artistSize + '%';
    $('#artistOpacityOutput').textContent = state.artistOpacity + '%';
    $('#vignetteOutput').textContent = state.vignette + '%';
    $('#backgroundOpacityOutput').textContent = state.backgroundOpacity + '%';
    $('#particleCountOutput').textContent = String(state.particleCount);
    $('#particleSizeOutput').textContent = Number(state.particleSize).toFixed(1) + '×';
    $('#particleSpeedOutput').textContent = Number(state.particleSpeed).toFixed(1) + '×';
    $('#particleOpacityOutput').textContent = state.particleOpacity + '%';
    $('#particleGlowOutput').textContent = String(state.particleGlow);
    $('#beatResponseOutput').textContent = Number(state.beatResponse).toFixed(1) + '×';
    $('#smoothingOutput').textContent = state.smoothing + '%';
    $('#cameraShakeOutput').textContent = Number(state.cameraShake).toFixed(0) + ' px';
    $('#visualizerPulseOutput').textContent = state.visualizerPulse + '%';
    $('#particlePulseOutput').textContent = state.particlePulse + '%';
    $('#vignettePulseOutput').textContent = state.vignettePulse + '%';
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
        showLogo: state.showLogo,
        logoShape: state.logoShape, logoPulseEnabled: state.logoPulseEnabled, logoPulseMode: state.logoPulseMode, logoPulseAmount: state.logoPulseAmount,
        logoHaloEnabled: state.logoHaloEnabled, logoHaloCount: state.logoHaloCount, logoHaloWidth: state.logoHaloWidth, logoHaloColor: state.logoHaloColor, logoGlow: state.logoGlow,
        showVisualizer: state.showVisualizer, visualizerGradient: state.visualizerGradient, visualizerShadow: state.visualizerShadow, visualizerFilter: state.visualizerFilter, visualizerLayers: state.visualizerLayers,
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
        visualScale: state.visualScale,
        visualOpacity: state.visualOpacity,
        visualLineWidth: state.visualLineWidth,
        titleX: state.titleX,
        titleY: state.titleY,
        titleSize: state.titleSize,
        titleColor: state.titleColor,
        titleOpacity: state.titleOpacity,
        artistX: state.artistX,
        artistY: state.artistY,
        artistSize: state.artistSize,
        artistColor: state.artistColor,
        artistOpacity: state.artistOpacity,
        particleCount: state.particleCount,
        particleSize: state.particleSize,
        particleSpeed: state.particleSpeed,
        particleDirection: state.particleDirection,
        particleShape: state.particleShape,
        particleColor: state.particleColor,
        particleOpacity: state.particleOpacity,
        particleGlow: state.particleGlow,
        beatResponse: state.beatResponse,
        smoothing: state.smoothing,
        cameraShakeEnabled: state.cameraShakeEnabled,
        cameraShakeMode: state.cameraShakeMode,
        cameraShake: state.cameraShake,
        visualizerPulse: state.visualizerPulse,
        particlePulse: state.particlePulse,
        vignettePulse: state.vignettePulse,
        title: $('#trackTitle').value,
        artist: $('#trackArtist').value
      },
      note: 'The JSON stores settings only. It does not contain audio or image files; the browser keeps uploaded logo and background locally.'
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
      if (['spectrum', 'orbit', 'wave', 'aurora', 'radial', 'impact', 'matrix', 'scope', 'tunnel', 'shockwave', 'bars3d'].includes(v.style)) state.style = v.style;
      if (/^#[0-9a-f]{6}$/i.test(v.colorOne || '')) state.colorOne = v.colorOne;
      if (/^#[0-9a-f]{6}$/i.test(v.colorTwo || '')) state.colorTwo = v.colorTwo;
      if (/^#[0-9a-f]{6}$/i.test(v.background || '')) state.background = v.background;
      if (Number.isFinite(Number(v.sensitivity))) state.sensitivity = Math.max(0.5, Math.min(2.5, Number(v.sensitivity)));
      if (Number.isFinite(Number(v.glow))) state.glow = Math.max(0, Math.min(40, Number(v.glow)));
      if (['landscape', 'square', 'portrait'].includes(v.aspect)) state.aspect = v.aspect;
      if (typeof v.showTitle === 'boolean') state.showTitle = v.showTitle;
      if (typeof v.showLogo === 'boolean') state.showLogo = v.showLogo;
      if (typeof v.showVisualizer === 'boolean') state.showVisualizer = v.showVisualizer;
      if (typeof v.logoPulseEnabled === 'boolean') state.logoPulseEnabled = v.logoPulseEnabled;
      if (typeof v.logoHaloEnabled === 'boolean') state.logoHaloEnabled = v.logoHaloEnabled;
      if (['circle','square','diamond','hexagon'].includes(v.logoShape)) state.logoShape = v.logoShape;
      if (['beat','bass','both'].includes(v.logoPulseMode)) state.logoPulseMode = v.logoPulseMode;
      if (['none','punch','mono','warm','cold','bloom'].includes(v.visualizerFilter)) state.visualizerFilter = v.visualizerFilter;
      if (typeof v.visualizerGradient === 'boolean') state.visualizerGradient = v.visualizerGradient;
      if (Array.isArray(v.visualizerLayers)) state.visualizerLayers = v.visualizerLayers.slice(0,8).filter(function(layer){return layer&&typeof layer==='object';}).map(function(layer,index){return {id:index+1,colorOne:/^#[0-9a-f]{6}$/i.test(layer.colorOne||'')?layer.colorOne:'#8b97b0',colorTwo:/^#[0-9a-f]{6}$/i.test(layer.colorTwo||'')?layer.colorTwo:'#d6b57c',opacity:clamp(Number(layer.opacity)||70,0,100),glow:clamp(Number(layer.glow)||0,0,40),shadow:clamp(Number(layer.shadow)||0,0,40),scale:clamp(Number(layer.scale)||94,50,150),x:clamp(Number(layer.x)||0,-35,35),y:clamp(Number(layer.y)||0,-35,35),gradient:layer.gradient!==false,enabled:layer.enabled!==false};});
      if (typeof v.showParticles === 'boolean') state.showParticles = v.showParticles;
      if (typeof v.showTitle === 'boolean') state.showTitle = v.showTitle;
      if (typeof v.showVignette === 'boolean') state.showVignette = v.showVignette;
      if (typeof v.cameraShakeEnabled === 'boolean') state.cameraShakeEnabled = v.cameraShakeEnabled;
      if (['beat', 'bass', 'both'].includes(v.cameraShakeMode)) state.cameraShakeMode = v.cameraShakeMode;
      if (typeof v.titleColor === 'string' && /^#[0-9a-f]{6}$/i.test(v.titleColor)) state.titleColor = v.titleColor;
      if (typeof v.artistColor === 'string' && /^#[0-9a-f]{6}$/i.test(v.artistColor)) state.artistColor = v.artistColor;
      if (typeof v.particleColor === 'string' && /^#[0-9a-f]{6}$/i.test(v.particleColor)) state.particleColor = v.particleColor;
      if (['up','down','left','right','out','in','float'].includes(v.particleDirection)) state.particleDirection = v.particleDirection;
      if (['circle','square','diamond','line','star'].includes(v.particleShape)) state.particleShape = v.particleShape;
      const numericSettings = {
        vignette: [0, 100], backgroundOpacity: [0, 100], logoSize: [6, 34], logoOpacity: [20, 100],
        logoX: [5, 95], logoY: [5, 95], visualX: [-35, 35], visualY: [-35, 35],
        visualScale: [35, 175], visualOpacity: [10, 100], visualLineWidth: [0.5, 3],
        titleX: [2, 90], titleY: [5, 92], titleSize: [40, 200], titleOpacity: [10, 100],
        artistX: [2, 90], artistY: [8, 96], artistSize: [40, 200], artistOpacity: [10, 100],
        particleCount: [0, 250], particleSize: [0.4, 3], particleSpeed: [0, 3],
        particleOpacity: [5, 100], particleGlow: [0, 24], beatResponse: [0.4, 3], smoothing: [0, 90],
        cameraShake: [0, 24], visualizerPulse: [0, 100], particlePulse: [0, 100], vignettePulse: [0, 100], logoPulseAmount:[0,100], logoHaloCount:[0,6], logoHaloWidth:[1,8], logoGlow:[0,30], visualizerShadow:[0,40]
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
    state.visualizerLayers = [];
    nextVisualizerLayerId = 1;
    removeLogo();
    removeBackground();
    initParticles();
    $('#trackTitle').value = state.file ? state.file.name.replace(/\.[^/.]+$/, '') : '';
    $('#trackTitle').dataset.autoTitle = state.file ? 'true' : 'false';
    $('#trackArtist').value = '';
    updateSettingsUI();
    setStyle(state.style);
    toast('Настройки возвращены к исходным.');
  }

  let nextVisualizerLayerId = 1;
  function renderVisualizerLayerList() {
    const host=$('#visualizerLayerList'); if(!host)return;host.innerHTML='';
    if(!state.visualizerLayers.length){const empty=document.createElement('p');empty.className='empty-layer-note';empty.textContent='Пока только основной слой.';host.appendChild(empty);}
    state.visualizerLayers.forEach(function(layer,index){
      const card=document.createElement('section');card.className='visual-layer-card';
      card.innerHTML=`
        <div class="visual-layer-head"><b>Слой ${index+2}</b><button type="button" class="text-button layer-remove-button" data-remove-layer="${layer.id}">Удалить</button></div>
        <div class="color-row layer-color-row">
          <label class="color-control"><input type="color" data-layer-id="${layer.id}" data-layer-key="colorOne" value="${layer.colorOne}"><span><b>ЦВЕТ 1</b><small>Основной</small></span></label>
          <label class="color-control"><input type="color" data-layer-id="${layer.id}" data-layer-key="colorTwo" value="${layer.colorTwo}"><span><b>ЦВЕТ 2</b><small>Градиент</small></span></label>
        </div>
        <div class="two-range-grid layer-range-grid">
          <label><span>Прозрачность <output>${layer.opacity}%</output></span><input type="range" min="0" max="100" data-layer-id="${layer.id}" data-layer-key="opacity" value="${layer.opacity}"></label>
          <label><span>Масштаб <output>${layer.scale}%</output></span><input type="range" min="50" max="150" data-layer-id="${layer.id}" data-layer-key="scale" value="${layer.scale}"></label>
        </div>
        <div class="two-range-grid layer-range-grid">
          <label><span>Свечение <output>${layer.glow}</output></span><input type="range" min="0" max="40" data-layer-id="${layer.id}" data-layer-key="glow" value="${layer.glow}"></label>
          <label><span>Тень <output>${layer.shadow}</output></span><input type="range" min="0" max="40" data-layer-id="${layer.id}" data-layer-key="shadow" value="${layer.shadow}"></label>
        </div>
        <div class="two-range-grid layer-range-grid">
          <label><span>Сдвиг X <output>${layer.x}%</output></span><input type="range" min="-35" max="35" data-layer-id="${layer.id}" data-layer-key="x" value="${layer.x}"></label>
          <label><span>Сдвиг Y <output>${layer.y}%</output></span><input type="range" min="-35" max="35" data-layer-id="${layer.id}" data-layer-key="y" value="${layer.y}"></label>
        </div>
        <label class="toggle-row layer-gradient-row"><span><b>Градиент слоя</b><small>Использовать оба цвета</small></span><input type="checkbox" data-layer-id="${layer.id}" data-layer-key="gradient" ${layer.gradient?'checked':''}><i></i></label>`;
      host.appendChild(card);
    });
    $('#visualizerLayerCount').textContent=(state.visualizerLayers.length+1)+' слой'+(state.visualizerLayers.length===0?'а':state.visualizerLayers.length<4?'а':'ев');
    $('#addVisualizerLayerButton').disabled=state.visualizerLayers.length>=8;
    $('#addVisualizerLayerButton').textContent=state.visualizerLayers.length>=8?'Лимит: 9 слоёв':'＋ Добавить слой';
  }
  function addVisualizerLayer() {
    if(state.visualizerLayers.length>=8){toast('Максимум 9 слоёв вместе с основным.');return;}
    const prev=state.visualizerLayers.length?state.visualizerLayers[state.visualizerLayers.length-1]:{colorOne:state.colorOne,colorTwo:state.colorTwo,glow:state.glow,shadow:state.visualizerShadow,scale:100,x:0,y:0};
    state.visualizerLayers.push({id:nextVisualizerLayerId++,colorOne:prev.colorTwo||state.colorTwo,colorTwo:prev.colorOne||state.colorOne,opacity:72,glow:Math.round((prev.glow||0)*.7),shadow:Math.round((prev.shadow||0)*.7),scale:Math.max(50,Math.min(150,(prev.scale||100)-6)),x:Number(prev.x||0),y:Number(prev.y||0),gradient:true,enabled:true});
    renderVisualizerLayerList();drawFrame(performance.now());
  }
  $('#addVisualizerLayerButton').addEventListener('click',addVisualizerLayer);
  $('#visualizerLayerList').addEventListener('input',function(event){
    const input=event.target.closest('[data-layer-id][data-layer-key]');if(!input)return;
    const layer=state.visualizerLayers.find(item=>String(item.id)===input.dataset.layerId);if(!layer)return;
    const key=input.dataset.layerKey;layer[key]=input.type==='checkbox'?input.checked:input.type==='color'?input.value:Number(input.value);
    const output=input.closest('label')&&input.closest('label').querySelector('output');if(output)output.textContent=input.value+(['opacity','scale','x','y'].includes(key)?'%':'');
  });
  $('#visualizerLayerList').addEventListener('click',function(event){
    const button=event.target.closest('[data-remove-layer]');if(!button)return;
    state.visualizerLayers=state.visualizerLayers.filter(layer=>String(layer.id)!==button.dataset.removeLayer);renderVisualizerLayerList();drawFrame(performance.now());
  });

  function setSettingsTab(name) {
    $$('.settings-tab').forEach(function(button){const active=button.dataset.settingsTab===name;button.classList.toggle('active',active);button.setAttribute('aria-selected',active?'true':'false');button.tabIndex=active?0:-1;});
    $$('[data-settings-panel]').forEach(function(panel){panel.hidden=panel.dataset.settingsPanel!==name;});
  }
  $$('.settings-tab').forEach(function(button){button.addEventListener('click',function(){setSettingsTab(button.dataset.settingsTab);});});
  $$('.settings-tab').forEach(function(button,index,buttons){button.addEventListener('keydown',function(event){
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length;
    buttons[next].focus();setSettingsTab(buttons[next].dataset.settingsTab);
  });});

  function setSiteWeather(mode,persist) {
    if(!['off','snow','leaves'].includes(mode))mode='off';
    const select=$('#siteParticlesMode'),layer=$('#siteWeatherLayer');select.value=mode;layer.innerHTML='';layer.dataset.mode=mode;
    if(mode!=='off'){
      const reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches,total=reduced?8:22;
      for(let i=0;i<total;i++){
        const particle=document.createElement('span');particle.className='site-weather-particle';particle.textContent=mode==='snow'?'❄':'❧';
        particle.style.left=(2+Math.random()*96).toFixed(1)+'%';particle.style.animationDuration=(3.8+Math.random()*7.5).toFixed(2)+'s';
        particle.style.animationDelay=(-Math.random()*9).toFixed(2)+'s';particle.style.fontSize=(mode==='snow'?7+Math.random()*9:10+Math.random()*10)+'px';
        particle.style.opacity=(.22+Math.random()*.48).toFixed(2);particle.style.setProperty('--drift',((Math.random()-.5)*38).toFixed(1)+'px');layer.appendChild(particle);
      }
    }
    if(persist){try{localStorage.setItem('nsp-site-weather',mode);}catch{}}
  }
  $('#siteParticlesMode').addEventListener('change',function(event){setSiteWeather(event.target.value,true);});
  let savedWeather='off';try{savedWeather=localStorage.getItem('nsp-site-weather')||'off';}catch{}
  setSiteWeather(savedWeather,false);

  const logoFileInput = $('#logoFile');
  const backgroundFileInput = $('#backgroundFile');
  $('#logoPickButton').addEventListener('click', function () { logoFileInput.click(); });
  $('#backgroundPickButton').addEventListener('click', function () { backgroundFileInput.click(); });
  $('#removeLogoButton').addEventListener('click', function () { removeLogo(); toast('Используется монограмма НсП.'); });
  $('#removeBackgroundButton').addEventListener('click', function () { removeBackground(); toast('Изображение фона убрано.'); });
  logoFileInput.addEventListener('change', function () {
    const file = logoFileInput.files && logoFileInput.files[0];
    if (file) useLocalImage(file, 'logo', false);
    logoFileInput.value = '';
  });
  backgroundFileInput.addEventListener('change', function () {
    const file = backgroundFileInput.files && backgroundFileInput.files[0];
    if (file) useLocalImage(file, 'background', false);
    backgroundFileInput.value = '';
  });

  const rangeBindings = [
    ['logoSizeRange', 'logoSize'], ['logoOpacityRange', 'logoOpacity'], ['logoXRange', 'logoX'],
    ['logoYRange', 'logoY'], ['visualXRange', 'visualX'], ['visualYRange', 'visualY'],
    ['visualScaleRange', 'visualScale'], ['visualOpacityRange', 'visualOpacity'], ['visualLineWidthRange', 'visualLineWidth'],
    ['titleXRange', 'titleX'], ['titleYRange', 'titleY'], ['titleSizeRange', 'titleSize'], ['titleOpacityRange', 'titleOpacity'],
    ['artistXRange', 'artistX'], ['artistYRange', 'artistY'], ['artistSizeRange', 'artistSize'], ['artistOpacityRange', 'artistOpacity'],
    ['logoPulseAmountRange','logoPulseAmount'], ['logoHaloCountRange','logoHaloCount'], ['logoHaloWidthRange','logoHaloWidth'], ['logoGlowRange','logoGlow'], ['visualizerShadowRange','visualizerShadow'],
    ['vignetteRange', 'vignette'], ['backgroundOpacityRange', 'backgroundOpacity'],
    ['particleCountRange', 'particleCount'], ['particleSizeRange', 'particleSize'], ['particleSpeedRange', 'particleSpeed'],
    ['particleOpacityRange', 'particleOpacity'], ['particleGlowRange', 'particleGlow'],
    ['beatResponseRange', 'beatResponse'], ['smoothingRange', 'smoothing'],
    ['cameraShakeRange', 'cameraShake'], ['visualizerPulseRange', 'visualizerPulse'],
    ['particlePulseRange', 'particlePulse'], ['vignettePulseRange', 'vignettePulse']
  ];
  rangeBindings.forEach(function (binding) {
    const input = $('#' + binding[0]);
    const key = binding[1];
    input.addEventListener('input', function () {
      state[key] = Number(input.value);
      if (key === 'particleCount') initParticles();
      if (key === 'smoothing' && state.analyser) state.analyser.smoothingTimeConstant = 0.32 + state.smoothing / 100 * 0.46;
      updatePositionOutputs();
    });
  });

    let canvasDrag = null;
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width * canvas.width,
      y: (event.clientY - rect.top) / rect.height * canvas.height
    };
  }
  function titleTextY(h) {
    const size = Math.max(16, Math.min(Math.round(canvas.width * 0.048), Math.round(h * 0.085))) * state.titleSize / 100;
    return Math.max(10, Math.min(h - size - 12, h * state.titleY / 100));
  }
  function artistTextY(h) {
    const size = Math.max(10, Math.round(Math.min(canvas.width, h) * 0.022)) * state.artistSize / 100;
    return Math.max(10, Math.min(h - size - 12, h * state.artistY / 100));
  }
  function nearText(p, key, y, h) {
    const xPercent = state[key + 'X'];
    const anchor = titleAnchor(canvas.width, xPercent);
    const left = anchor.align === 'right' ? anchor.x - canvas.width * 0.84 : anchor.x;
    return p.x >= left - 12 && p.x <= left + canvas.width * 0.84 + 12
      && p.y >= y - 10 && p.y <= y + h * (key === 'title' ? 0.105 : 0.055);
  }
  canvas.addEventListener('pointerdown', function (event) {
    const p = canvasPoint(event);
    const w = canvas.width, h = canvas.height;
    const lx = w * state.logoX / 100;
    const ly = h * state.logoY / 100;
    const logoRadius = Math.min(w, h) * state.logoSize / 200 * 1.25;
    let mode = 'visual';
    if (state.showLogo && Math.hypot(p.x - lx, p.y - ly) <= logoRadius) {
      mode = 'logo';
    } else if (state.showTitle && nearText(p, 'title', titleTextY(h), h)) {
      mode = 'title';
    } else if (state.showTitle && nearText(p, 'artist', artistTextY(h), h)) {
      mode = 'artist';
    }
    canvasDrag = { mode: mode, lastX: p.x, lastY: p.y };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', function (event) {
    if (!canvasDrag) return;
    const p = canvasPoint(event);
    const dx = (p.x - canvasDrag.lastX) / canvas.width * 100;
    const dy = (p.y - canvasDrag.lastY) / canvas.height * 100;
    if (canvasDrag.mode === 'visual') {
      state.visualX = Math.round(clamp(state.visualX + dx, -35, 35));
      state.visualY = Math.round(clamp(state.visualY + dy, -35, 35));
      $('#visualXRange').value = state.visualX;
      $('#visualYRange').value = state.visualY;
    } else if (canvasDrag.mode === 'logo') {
      state.logoX = Math.round(clamp(state.logoX + dx, 5, 95));
      state.logoY = Math.round(clamp(state.logoY + dy, 5, 95));
      $('#logoXRange').value = state.logoX;
      $('#logoYRange').value = state.logoY;
    } else if (canvasDrag.mode === 'title') {
      state.titleX = Math.round(clamp(state.titleX + dx, 2, 90));
      state.titleY = Math.round(clamp(state.titleY + dy, 5, 92));
      $('#titleXRange').value = state.titleX;
      $('#titleYRange').value = state.titleY;
    } else {
      state.artistX = Math.round(clamp(state.artistX + dx, 2, 90));
      state.artistY = Math.round(clamp(state.artistY + dy, 8, 96));
      $('#artistXRange').value = state.artistX;
      $('#artistYRange').value = state.artistY;
    }
    canvasDrag.lastX = p.x;
    canvasDrag.lastY = p.y;
    updatePositionOutputs();
    event.preventDefault();
  });
  function endCanvasDrag(event) {
    canvasDrag = null;
    canvas.style.cursor = 'grab';
    if (event && canvas.hasPointerCapture && canvas.hasPointerCapture(event.pointerId)) {
      try { canvas.releasePointerCapture(event.pointerId); } catch {}
    }
  }
  canvas.addEventListener('pointerup', endCanvasDrag);
  canvas.addEventListener('pointercancel', endCanvasDrag);
  canvas.addEventListener('lostpointercapture', function () { canvasDrag = null; canvas.style.cursor = 'grab'; });

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
  $('#titleColorInput').addEventListener('input', function (event) { state.titleColor = event.target.value; });
  $('#artistColorInput').addEventListener('input', function (event) { state.artistColor = event.target.value; });
  $('#particleColorInput').addEventListener('input', function (event) { state.particleColor = event.target.value; });
  $('#particleDirectionSelect').addEventListener('change', function (event) { state.particleDirection = event.target.value; });
  $('#particleShapeSelect').addEventListener('change', function (event) { state.particleShape = event.target.value; });
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
  $('#showLogo').addEventListener('change', function (event) { state.showLogo = event.target.checked; });
  $('#logoShapeSelect').addEventListener('change', function(event){state.logoShape=event.target.value;$('#logoPreview').dataset.shape=state.logoShape;});
  $('#logoPulseEnabled').addEventListener('change', function(event){state.logoPulseEnabled=event.target.checked;});
  $('#logoPulseModeSelect').addEventListener('change', function(event){state.logoPulseMode=event.target.value;});
  $('#logoHaloEnabled').addEventListener('change', function(event){state.logoHaloEnabled=event.target.checked;});
  $('#logoHaloColorInput').addEventListener('input', function(event){state.logoHaloColor=event.target.value;});
  $('#showParticles').addEventListener('change', function (event) { state.showParticles = event.target.checked; });
  $('#showVisualizer').addEventListener('change', function(event){state.showVisualizer=event.target.checked;});
  $('#visualizerGradientEnabled').addEventListener('change', function(event){state.visualizerGradient=event.target.checked;});
  $('#visualizerFilterSelect').addEventListener('change', function(event){state.visualizerFilter=event.target.value;});
  $('#showVignette').addEventListener('change', function (event) { state.showVignette = event.target.checked; });
  $('#cameraShakeEnabled').addEventListener('change', function (event) { state.cameraShakeEnabled = event.target.checked; });
  $('#cameraShakeModeSelect').addEventListener('change', function (event) { state.cameraShakeMode = event.target.value; });
  $('#trackTitle').addEventListener('input', function () { $('#trackTitle').dataset.autoTitle = 'false'; });
  $('#playButton').addEventListener('click', togglePlay);
  $('#stopButton').addEventListener('click', stopPlayback);
  $('#rewindButton').addEventListener('click', function () { if (state.file) { audio.currentTime = 0; if (audio.paused) togglePlay(); } });
  $('#seekRange').addEventListener('input', function (event) { if (Number.isFinite(audio.duration)) audio.currentTime = Number(event.target.value) / 1000 * audio.duration; });
  $('#exportButton').addEventListener('click', startExport);
  $('#topExportButton').addEventListener('click', startExport);
  $('#exportFormatSelect').addEventListener('change', function () { setExportUI(false); });
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

  loadPreset();
  state.visualizerLayers = Array.isArray(state.visualizerLayers) ? state.visualizerLayers : [];
  nextVisualizerLayerId = state.visualizerLayers.reduce(function(max,layer){return Math.max(max,Number(layer.id)||0);},0)+1;
  initParticles();
  updateSettingsUI();
  setStyle(state.style);
  updateTransport();
  void restoreSavedAssets();
  window.addEventListener('resize', applyAspect);
  window.requestAnimationFrame(animate);
})();