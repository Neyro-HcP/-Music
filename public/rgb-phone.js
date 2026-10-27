(() => {
  'use strict';

  const root = document.getElementById('rgbPhoneSection');
  if (!root) return;

  const canvas = document.getElementById('rgbPhoneCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const status = document.getElementById('rgbPhoneStatus');
  const tiltButton = document.getElementById('rgbPhoneTilt');
  const soundButton = document.getElementById('rgbPhoneSound');

  const objects = [];
  const blasts = [];
  const particles = [];
  const MAX_OBJECTS = 38;
  let w = 1, h = 1, dpr = 1, lastFrame = 0, nextId = 1;
  let soundEnabled = true, tiltEnabled = false, audioContext = null, masterGain = null;
  let tiltBase = null, tiltGravityX = 0, tiltGravityY = 0, dragging = null;
  let lastSoundAt = 0, backgroundTime = 0;
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const random = (min, max) => min + Math.random() * (max - min);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const now = () => performance.now();

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const oldW = w, oldH = h;
    w = rect.width;
    h = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (objects.length && oldW > 1 && oldH > 1) {
      const sx = w / oldW, sy = h / oldH;
      for (const o of objects) { o.x *= sx; o.y *= sy; }
    }
  }

  function ensureAudio() {
    if (!soundEnabled) return;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    try {
      if (!audioContext) {
        audioContext = new AudioCtor();
        masterGain = audioContext.createGain();
        masterGain.gain.value = 0.26;
        masterGain.connect(audioContext.destination);
      }
      if (audioContext.state === 'suspended') audioContext.resume();
    } catch (_) { /* Audio remains optional if the browser blocks it. */ }
  }

  function tone(frequency, duration, type, volume, endFrequency) {
    if (!soundEnabled) return;
    ensureAudio();
    if (!audioContext || !masterGain) return;
    const t = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(Math.max(30, frequency), t);
    if (endFrequency) osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume || 0.08), t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t);
    osc.stop(t + duration + 0.025);
  }

  function noise(duration, volume, cutoff) {
    if (!soundEnabled) return;
    ensureAudio();
    if (!audioContext || !masterGain) return;
    const length = Math.max(1, Math.floor(audioContext.sampleRate * duration));
    const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff || 2400;
    gain.gain.setValueAtTime(volume || 0.1, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    source.start();
  }

  function playImpact(kind, strength) {
    const t = now();
    if (t - lastSoundAt < 58 || strength < 125) return;
    lastSoundAt = t;
    const power = clamp((strength - 100) / 560, 0.04, 0.22);
    if (kind === 'ice') {
      tone(random(1150, 1700), 0.11, 'sine', power * 0.55, random(700, 1050));
      tone(random(2100, 2750), 0.045, 'triangle', power * 0.22);
    } else if (kind === 'rubber') {
      tone(random(150, 250), 0.14, 'sine', power * 0.7, random(80, 120));
      tone(random(370, 510), 0.08, 'triangle', power * 0.24, 220);
    } else {
      tone(random(260, 420), 0.07, 'triangle', power * 0.55, random(130, 210));
      noise(0.045, power * 0.25, 1300);
    }
  }

  function makeObject(kind, x, y, options) {
    options = options || {};
    const base = Math.min(w, h);
    const ball = kind === 'rubber';
    const size = options.size || (ball ? random(13, 20) : random(22, 31));
    const colors = kind === 'rubber'
      ? ['#ff4eaa', '#a58bff', '#48e3ff', '#ffbd59', '#8df58a', '#ff6f73', '#b3a1ff']
      : kind === 'ice'
        ? ['#9ceeff', '#bceeff', '#8ed8ff', '#d0f8ff']
        : kind === 'tnt'
          ? ['#ff464f', '#ef363e']
          : ['#8975ff', '#43d8cc', '#ffbd59', '#fa7ac5', '#70aaff'];
    const o = {
      id: nextId++,
      kind,
      x: x == null ? random(base * 0.18, Math.max(base * 0.82, w - 16)) : x,
      y: y == null ? random(-h * 0.28, h * 0.12) : y,
      vx: options.vx == null ? random(-100, 100) : options.vx,
      vy: options.vy == null ? random(-30, 90) : options.vy,
      size,
      angle: random(-0.5, 0.5),
      spin: random(-2.1, 2.1),
      color: options.color || colors[Math.floor(Math.random() * colors.length)],
      restitution: kind === 'rubber' ? 0.91 : kind === 'ice' ? 0.79 : 0.67,
      fuseAt: null,
      dragged: false
    };
    objects.push(o);
    while (objects.length > MAX_OBJECTS) {
      const i = objects.findIndex(item => item.kind !== 'tnt' && !item.dragged);
      objects.splice(i < 0 ? 0 : i, 1);
    }
    return o;
  }

  function addSet(kind, count) {
    ensureAudio();
    const center = w * 0.5;
    for (let i = 0; i < count; i++) {
      const o = makeObject(kind, center + random(-w * 0.25, w * 0.25), random(-h * 0.18, h * 0.1), {
        vx: random(-150, 150),
        vy: random(-35, 75)
      });
      if (kind === 'tnt') o.fuseAt = now() + 3500 + i * 400;
    }
    setStatus(kind === 'tnt' ? 'TNT готово — брось или коснись для взрыва' : 'Тяни предмет и отпускай');
  }

  function seedScene() {
    objects.length = 0;
    blasts.length = 0;
    particles.length = 0;
    if (w < 10 || h < 10) return;
    for (let i = 0; i < 7; i++) makeObject('rubber', random(w * .15, w * .85), random(h * .12, h * .55), { vx: random(-90, 90), vy: random(-30, 20) });
    for (let i = 0; i < 3; i++) makeObject('ice', random(w * .2, w * .8), random(h * .12, h * .48), { vx: random(-70, 70) });
    for (let i = 0; i < 3; i++) makeObject('cube', random(w * .2, w * .8), random(h * .08, h * .38), { vx: random(-80, 80) });
  }

  function bounds(o) {
    return o.kind === 'rubber' ? o.size : o.size * 0.69;
  }

  function spawnSparkles(x, y, color, amount, speed) {
    for (let i = 0; i < amount; i++) {
      const a = random(0, Math.PI * 2);
      const v = random(speed * .25, speed);
      particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: random(.22, .7), maxLife: 0, size: random(1, 3.6), color
      });
      particles[particles.length - 1].maxLife = particles[particles.length - 1].life;
    }
    if (particles.length > 220) particles.splice(0, particles.length - 220);
  }

  function explode(o) {
    const index = objects.indexOf(o);
    if (index < 0) return;
    objects.splice(index, 1);
    const radius = Math.min(w, h) * .58;
    blasts.push({ x: o.x, y: o.y, radius: 0, maxRadius: radius, life: .5, maxLife: .5 });
    for (const other of objects) {
      if (other.dragged) continue;
      const dx = other.x - o.x, dy = other.y - o.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      if (dist < radius) {
        const force = (1 - dist / radius) * 850;
        other.vx += dx / dist * force + random(-65, 65);
        other.vy += dy / dist * force - (1 - dist / radius) * 220;
        other.spin += random(-6, 6) * (1 - dist / radius);
      }
    }
    spawnSparkles(o.x, o.y, '#ffb34f', 48, 260);
    spawnSparkles(o.x, o.y, '#ff536b', 28, 180);
    noise(.32, .19, 950);
    tone(88, .42, 'sawtooth', .16, 38);
    tone(190, .19, 'triangle', .09, 48);
    setStatus('Бум — всё разлетелось');
  }

  function hitRadius(o) {
    return o.kind === 'rubber' ? o.size + 9 : o.size * .92 + 9;
  }

  function pointerPos(event) {
    const r = canvas.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', event => {
    event.preventDefault();
    ensureAudio();
    const p = pointerPos(event);
    let chosen = null, best = Infinity;
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      const d = Math.hypot(p.x - o.x, p.y - o.y);
      if (d < hitRadius(o) && d < best) { chosen = o; best = d; }
    }
    const created = !chosen;
    if (!chosen) chosen = makeObject('rubber', p.x, p.y, { vx: 0, vy: 0, size: random(13, 19) });
    chosen.dragged = true;
    chosen.fuseAt = null;
    chosen.x = p.x;
    chosen.y = p.y;
    chosen.vx = 0;
    chosen.vy = 0;
    dragging = {
      object: chosen, created, startX: p.x, startY: p.y, startTime: now(),
      moved: false, points: [{ x: p.x, y: p.y, t: now() }]
    };
    canvas.setPointerCapture(event.pointerId);
    setStatus('Оттяни предмет и отпусти');
  }, { passive: false });

  canvas.addEventListener('pointermove', event => {
    if (!dragging) return;
    event.preventDefault();
    const p = pointerPos(event);
    const d = dragging;
    if (Math.hypot(p.x - d.startX, p.y - d.startY) > 8) d.moved = true;
    d.object.x = clamp(p.x, 5, w - 5);
    d.object.y = clamp(p.y, 5, h - 5);
    d.object.angle += (p.x - d.startX) * .0007;
    d.points.push({ x: p.x, y: p.y, t: now() });
    const cutoff = now() - 110;
    while (d.points.length > 2 && d.points[0].t < cutoff) d.points.shift();
  }, { passive: false });

  function releaseDrag() {
    if (!dragging) return;
    const d = dragging;
    const o = d.object;
    o.dragged = false;
    const elapsed = now() - d.startTime;
    if (o.kind === 'tnt' && !d.moved && elapsed < 450) {
      dragging = null;
      explode(o);
      return;
    }
    if (d.moved && d.points.length > 1) {
      const first = d.points[0], last = d.points[d.points.length - 1];
      const seconds = Math.max(.025, (last.t - first.t) / 1000);
      o.vx = clamp((last.x - first.x) / seconds * .92, -1150, 1150);
      o.vy = clamp((last.y - first.y) / seconds * .92, -1150, 1150);
      o.spin += clamp(o.vx / 220, -5, 5);
      if (o.kind === 'tnt') o.fuseAt = now() + 2400;
      playImpact(o.kind, Math.hypot(o.vx, o.vy) * .2);
    } else if (d.created) {
      o.vx = random(-80, 80);
      o.vy = -random(100, 230);
    }
    dragging = null;
    setStatus(o.kind === 'tnt' && o.fuseAt ? 'Фитиль горит — бросайся в укрытие…' : 'Тяни предмет и отпускай');
  }

  canvas.addEventListener('pointerup', releaseDrag);
  canvas.addEventListener('pointercancel', releaseDrag);
  canvas.addEventListener('lostpointercapture', releaseDrag);

  function collide(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const distance = Math.hypot(dx, dy) || .001;
    const minDistance = bounds(a) + bounds(b);
    if (distance >= minDistance) return;
    const nx = dx / distance, ny = dy / distance;
    const overlap = minDistance - distance;
    const invA = a.dragged ? 0 : 1 / (a.kind === 'rubber' ? 1 : 1.25);
    const invB = b.dragged ? 0 : 1 / (b.kind === 'rubber' ? 1 : 1.25);
    const sum = invA + invB;
    if (!sum) return;
    a.x -= nx * overlap * invA / sum;
    a.y -= ny * overlap * invA / sum;
    b.x += nx * overlap * invB / sum;
    b.y += ny * overlap * invB / sum;
    const relV = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (relV < 0) {
      const e = Math.min(a.restitution, b.restitution);
      const impulse = -(1 + e) * relV / sum;
      if (!a.dragged) { a.vx -= impulse * invA * nx; a.vy -= impulse * invA * ny; }
      if (!b.dragged) { b.vx += impulse * invB * nx; b.vy += impulse * invB * ny; }
      if (Math.abs(relV) > 165) {
        playImpact(a.kind === 'ice' || b.kind === 'ice' ? 'ice' : a.kind === 'rubber' && b.kind === 'rubber' ? 'rubber' : 'cube', Math.abs(relV));
        spawnSparkles((a.x + b.x) / 2, (a.y + b.y) / 2, a.kind === 'ice' || b.kind === 'ice' ? '#b8f3ff' : '#b5a2ff', 3, 38);
      }
    }
  }

  function step(dt) {
    const gX = tiltEnabled ? tiltGravityX : 0;
    const gY = tiltEnabled ? tiltGravityY : 820;
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      if (o.dragged) continue;
      o.vx += gX * dt;
      o.vy += gY * dt;
      o.vx *= Math.pow(.999, dt * 60);
      o.vy = clamp(o.vy, -1300, 1300);
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.angle += o.spin * dt;
      o.spin *= Math.pow(.996, dt * 60);

      const r = bounds(o);
      if (o.x < r + 2) { o.x = r + 2; if (o.vx < 0) { playImpact(o.kind, Math.abs(o.vx)); o.vx = Math.abs(o.vx) * o.restitution; o.spin += .2; } }
      if (o.x > w - r - 2) { o.x = w - r - 2; if (o.vx > 0) { playImpact(o.kind, Math.abs(o.vx)); o.vx = -Math.abs(o.vx) * o.restitution; o.spin -= .2; } }
      if (o.y < r + 2) { o.y = r + 2; if (o.vy < 0) { o.vy = Math.abs(o.vy) * .66; playImpact(o.kind, Math.abs(o.vy)); } }
      if (o.y > h - r - 2) {
        o.y = h - r - 2;
        if (o.vy > 30) { playImpact(o.kind, Math.abs(o.vy)); o.vy = -Math.abs(o.vy) * o.restitution; o.spin += o.vx * .003; }
        else o.vy = 0;
        o.vx *= o.kind === 'rubber' ? .993 : .965;
        if (Math.abs(o.vx) < 3) o.vx = 0;
        if (Math.abs(o.vy) < 22) o.vy = 0;
      }
      if (o.kind === 'tnt' && o.fuseAt && now() >= o.fuseAt) {
        explode(o);
        break;
      }
    }
    for (let i = 0; i < objects.length; i++) {
      for (let j = i + 1; j < objects.length; j++) collide(objects[i], objects[j]);
    }
    for (let i = blasts.length - 1; i >= 0; i--) {
      const b = blasts[i];
      b.life -= dt;
      b.radius = b.maxRadius * (1 - b.life / b.maxLife);
      if (b.life <= 0) blasts.splice(i, 1);
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.vy += 240 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= .985;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function polygon(points, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function drawBall(o) {
    const r = o.size;
    const grad = ctx.createRadialGradient(-r * .38, -r * .44, 1, r * .1, r * .18, r * 1.25);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(.12, o.color);
    grad.addColorStop(.68, o.color);
    grad.addColorStop(1, '#151522');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-r * .3, -r * .37, r * .29, r * .15, -.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.77)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r * .35, r * .37, r * .12, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.24)';
    ctx.fill();
  }

  function drawCube(o) {
    const s = o.size;
    const top = [[0, -s * .72], [s * .72, -s * .31], [0, s * .09], [-s * .72, -s * .31]];
    const left = [[-s * .72, -s * .31], [0, s * .09], [0, s * .78], [-s * .72, s * .36]];
    const right = [[0, s * .09], [s * .72, -s * .31], [s * .72, s * .36], [0, s * .78]];
    if (o.kind === 'ice') {
      polygon(left, 'rgba(83, 180, 224, .83)', 'rgba(227,250,255,.8)');
      polygon(right, 'rgba(66, 147, 200, .85)', 'rgba(218,247,255,.85)');
      polygon(top, 'rgba(190, 245, 255, .94)', 'rgba(255,255,255,.95)');
      polygon([[-s*.48,-s*.31],[-s*.13,-s*.5],[-s*.01,s*.04],[-s*.36,s*.22]], 'rgba(255,255,255,.35)');
      polygon([[s*.17,-s*.36],[s*.49,-s*.31],[s*.48,s*.11],[s*.18,s*.32]], 'rgba(215,252,255,.24)');
      ctx.beginPath();
      ctx.moveTo(-s * .46, -s * .3);
      ctx.lineTo(-s * .11, -s * .1);
      ctx.lineTo(-s * .02, s * .58);
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      return;
    }
    if (o.kind === 'tnt') {
      polygon(left, '#891c2a', 'rgba(255,255,255,.18)');
      polygon(right, '#bf2537', 'rgba(255,255,255,.22)');
      polygon(top, '#f0444d', 'rgba(255,255,255,.5)');
      ctx.strokeStyle = 'rgba(38, 8, 15, .6)';
      ctx.lineWidth = Math.max(2, s * .13);
      ctx.beginPath(); ctx.moveTo(-s*.4, -s*.12); ctx.lineTo(s*.4, -s*.12); ctx.stroke();
      ctx.save();
      ctx.rotate(.02);
      ctx.font = '900 ' + Math.max(10, s * .47) + 'px Manrope, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff3dd';
      ctx.shadowColor = '#4c000b';
      ctx.shadowBlur = 4;
      ctx.fillText('TNT', 0, s * .29);
      ctx.restore();
      if (o.fuseAt) {
        const leftTime = Math.max(0, o.fuseAt - now());
        const pulse = .5 + .5 * Math.sin(now() * .025);
        ctx.beginPath();
        ctx.arc(s * .42, -s * .55, 3 + pulse * 2, 0, Math.PI * 2);
        ctx.fillStyle = leftTime < 750 ? '#fff7a1' : '#ffb347';
        ctx.shadowColor = '#ff713d';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      return;
    }
    const topGrad = ctx.createLinearGradient(-s, -s, s, s);
    topGrad.addColorStop(0, '#ffffff');
    topGrad.addColorStop(.25, o.color);
    topGrad.addColorStop(1, '#5b4b99');
    polygon(left, '#4a477d', 'rgba(255,255,255,.17)');
    polygon(right, '#242941', 'rgba(255,255,255,.17)');
    polygon(top, topGrad, 'rgba(255,255,255,.45)');
    polygon([[-s*.39,-s*.31],[-s*.05,-s*.5],[s*.15,-s*.38],[-s*.18,-s*.2]], 'rgba(255,255,255,.22)');
  }

  function drawObject(o) {
    const groundY = h - 4;
    const elev = clamp((groundY - o.y) / h, 0, 1);
    const r = bounds(o);
    ctx.save();
    ctx.globalAlpha = .13 + .2 * (1 - elev);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(o.x + 3, groundY - (o.kind === 'rubber' ? r * .4 : r * .2), r * (1 - elev * .38), Math.max(2, r * .27 * (1 - elev * .45)), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle);
    if (o.kind === 'rubber') drawBall(o); else drawCube(o);
    if (o.dragged) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(180, 153, 255, .8)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawBackground(dt) {
    backgroundTime += dt;
    const grad = ctx.createLinearGradient(0, 0, w * .3, h);
    grad.addColorStop(0, '#090b17');
    grad.addColorStop(.52, '#101326');
    grad.addColorStop(1, '#070911');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w * .55, h * .2, 0, w * .55, h * .2, Math.max(w, h) * .85);
    glow.addColorStop(0, 'rgba(112, 77, 205, .15)');
    glow.addColorStop(.52, 'rgba(42, 85, 139, .035)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.strokeStyle = 'rgba(169, 164, 223, .045)';
    ctx.lineWidth = 1;
    const stepSize = 34;
    const offset = (backgroundTime * 7) % stepSize;
    for (let x = offset; x < w; x += stepSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = offset; y < h; y += stepSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.restore();

    const bottom = ctx.createLinearGradient(0, h * .68, 0, h);
    bottom.addColorStop(0, 'rgba(4,5,10,0)');
    bottom.addColorStop(1, 'rgba(2,3,7,.38)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, h * .68, w, h * .32);
  }

  function drawEffects() {
    for (const b of blasts) {
      const alpha = clamp(b.life / b.maxLife, 0, 1);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 194, 105, ' + (alpha * .92) + ')';
      ctx.lineWidth = 2 + alpha * 7;
      ctx.shadowColor = '#ff684c';
      ctx.shadowBlur = 22 * alpha;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius * .64, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 100, 122, ' + (alpha * .45) + ')';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 7;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function frame(time) {
    if (!lastFrame) lastFrame = time;
    const dt = clamp((time - lastFrame) / 1000, 0, .032);
    lastFrame = time;
    drawBackground(dt);
    step(dt);
    const ordered = objects.slice().sort((a, b) => a.y - b.y);
    for (const o of ordered) drawObject(o);
    drawEffects();
    requestAnimationFrame(frame);
  }

  function orientationHandler(event) {
    if (!tiltEnabled || event.beta == null || event.gamma == null) return;
    if (!tiltBase) tiltBase = { beta: event.beta, gamma: event.gamma };
    const gamma = event.gamma - tiltBase.gamma;
    const beta = event.beta - tiltBase.beta;
    tiltGravityX = clamp(gamma * 19, -760, 760);
    tiltGravityY = clamp(820 + beta * 12, 160, 1450);
  }

  async function toggleTilt() {
    if (tiltEnabled) {
      tiltEnabled = false;
      tiltBase = null;
      tiltGravityX = 0;
      tiltGravityY = 0;
      window.removeEventListener('deviceorientation', orientationHandler);
      tiltButton.setAttribute('aria-pressed', 'false');
      tiltButton.querySelector('.rgb-phone-tool-label').textContent = 'Наклон';
      setStatus('Наклон выключен');
      return;
    }
    if (!('DeviceOrientationEvent' in window)) {
      setStatus('Датчик наклона недоступен в этом браузере');
      return;
    }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') {
          setStatus('Разреши доступ к датчикам в браузере');
          return;
        }
      }
      tiltEnabled = true;
      tiltBase = null;
      tiltGravityX = 0;
      tiltGravityY = 820;
      window.addEventListener('deviceorientation', orientationHandler, true);
      tiltButton.setAttribute('aria-pressed', 'true');
      tiltButton.querySelector('.rgb-phone-tool-label').textContent = 'Наклон включён';
      setStatus('Наклоняй телефон — предметы покатятся');
    } catch (_) {
      setStatus('Не удалось включить датчик наклона');
    }
  }

  root.querySelectorAll('[data-rgb-add]').forEach(button => {
    button.addEventListener('click', () => {
      const kind = button.getAttribute('data-rgb-add');
      const amount = kind === 'rubber' ? 5 : kind === 'ice' ? 4 : kind === 'cube' ? 4 : 1;
      addSet(kind, amount);
    });
  });

  root.querySelector('[data-rgb-action="clear"]').addEventListener('click', () => {
    objects.length = 0;
    blasts.length = 0;
    particles.length = 0;
    setStatus('Экран очищен — добавь предметы');
  });

  root.querySelector('[data-rgb-action="reset"]').addEventListener('click', () => {
    seedScene();
    setStatus('Сцена обновлена');
  });

  soundButton.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    if (soundEnabled) ensureAudio();
    soundButton.setAttribute('aria-pressed', String(soundEnabled));
    soundButton.querySelector('.rgb-phone-tool-label').textContent = soundEnabled ? 'Звук включён' : 'Звук';
    if (!soundEnabled && audioContext && masterGain) masterGain.gain.setTargetAtTime(0, audioContext.currentTime, .04);
    if (soundEnabled && masterGain && audioContext) masterGain.gain.setTargetAtTime(.26, audioContext.currentTime, .04);
    setStatus(soundEnabled ? 'Звук включён' : 'Звук выключен');
  });

  tiltButton.addEventListener('click', toggleTilt);
  window.addEventListener('resize', () => { resize(); }, { passive: true });

  resize();
  seedScene();
  requestAnimationFrame(frame);
})();