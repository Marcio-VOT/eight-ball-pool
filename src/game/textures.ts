import * as THREE from 'three';
import {
  BALL_COLORS,
  HEAD_STRING_X,
  PLAY_HALF_LENGTH,
  PLAY_HALF_WIDTH,
} from '@/engine/constants';

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function makeRng(seedInit: number): () => number {
  let seed = seedInit >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed & 0xffff) / 0xffff;
  };
}

export function createFeltTextures(): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
} {
  const w = 1024;
  const h = 512;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d')!;

  // Classic heritage hunter-baize wool cloth (warmer, deeper & less neon than digital emerald)
  const grad = ctx.createRadialGradient(
    w * 0.5,
    h * 0.5,
    h * 0.1,
    w * 0.5,
    h * 0.5,
    w * 0.64
  );
  grad.addColorStop(0, '#186344');
  grad.addColorStop(0.6, '#124e35');
  grad.addColorStop(1, '#0b3624');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Fine woven worsted wool micro-texture + subtle organic chalk nap
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const bumpCanvas = makeCanvas(512, 256);
  const bumpCtx = bumpCanvas.getContext('2d')!;
  const bumpImg = bumpCtx.createImageData(512, 256);
  const bData = bumpImg.data;
  const rand = makeRng(1337);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const weave = ((x + y) & 1) === 0 ? 2.5 : -2.5;
      const n = (rand() - 0.5) * 11 + weave;
      data[idx] = Math.max(0, Math.min(255, data[idx] + n * 0.65));
      data[idx + 1] = Math.max(0, Math.min(255, data[idx + 1] + n));
      data[idx + 2] = Math.max(0, Math.min(255, data[idx + 2] + n * 0.58));
    }
  }
  ctx.putImageData(img, 0, 0);

  for (let i = 0; i < bData.length; i += 4) {
    const v = 114 + Math.floor(rand() * 32);
    bData[i] = v;
    bData[i + 1] = v;
    bData[i + 2] = v;
    bData[i + 3] = 255;
  }
  bumpCtx.putImageData(bumpImg, 0, 0);

  // Subtle chalk-drawn head string line and vintage cloth spots
  const toPxX = (worldX: number) =>
    ((worldX + PLAY_HALF_LENGTH) / (PLAY_HALF_LENGTH * 2)) * w;
  const toPxY = (worldZ: number) =>
    ((worldZ + PLAY_HALF_WIDTH) / (PLAY_HALF_WIDTH * 2)) * h;

  const headX = toPxX(HEAD_STRING_X);
  ctx.strokeStyle = 'rgba(237, 226, 198, 0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(headX, 0);
  ctx.lineTo(headX, h);
  ctx.stroke();

  const drawSpot = (wx: number, wz: number, radius: number, ring = false) => {
    const px = toPxX(wx);
    const py = toPxY(wz);
    ctx.fillStyle = 'rgba(238, 227, 200, 0.36)';
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
    if (ring) {
      ctx.strokeStyle = 'rgba(238, 227, 200, 0.16)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 24, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  drawSpot(HEAD_STRING_X, 0, 4);
  drawSpot(0, 0, 3.5, true);
  drawSpot(-HEAD_STRING_X, 0, 4.5);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;

  return { map, bumpMap };
}

function paintHorizontalWoodGrain(
  ctx: CanvasRenderingContext2D,
  bumpCtx: CanvasRenderingContext2D,
  w: number,
  h: number
): void {
  const rand = makeRng(9041);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#4c2614');
  grad.addColorStop(0.35, '#3b1b0d');
  grad.addColorStop(0.7, '#542a16');
  grad.addColorStop(1, '#36170b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  bumpCtx.fillStyle = '#808080';
  bumpCtx.fillRect(0, 0, w, h);

  // Longitudinal walnut/oak cathedral grain fibers along X
  for (let i = 0; i < 210; i++) {
    const baseY = (i / 210) * h;
    const isDark = i % 3 === 0;
    const alpha = isDark ? 0.28 : 0.14;
    ctx.strokeStyle = isDark
      ? `rgba(20, 7, 3, ${alpha})`
      : `rgba(148, 84, 42, ${alpha})`;
    ctx.lineWidth = 0.8 + rand() * 2.1;

    bumpCtx.strokeStyle = isDark ? 'rgba(40,40,40,0.32)' : 'rgba(195,195,195,0.2)';
    bumpCtx.lineWidth = ctx.lineWidth;

    const freq = 0.012 + rand() * 0.015;
    const phase = rand() * Math.PI * 2;
    const amp = 2.5 + rand() * 5.5;

    ctx.beginPath();
    bumpCtx.beginPath();
    for (let x = 0; x <= w; x += 16) {
      const y = baseY + Math.sin(x * freq + phase) * amp;
      if (x === 0) {
        ctx.moveTo(x, y);
        bumpCtx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
        bumpCtx.lineTo(x, y);
      }
    }
    ctx.stroke();
    bumpCtx.stroke();
  }

  // Subtle dark heartwood knots
  for (let k = 0; k < 3; k++) {
    const kx = (0.18 + k * 0.32 + rand() * 0.08) * w;
    const ky = (0.2 + rand() * 0.6) * h;
    const kGrad = ctx.createRadialGradient(kx, ky, 1, kx, ky, 22);
    kGrad.addColorStop(0, 'rgba(24, 9, 4, 0.5)');
    kGrad.addColorStop(0.55, 'rgba(54, 22, 10, 0.22)');
    kGrad.addColorStop(1, 'rgba(54, 22, 10, 0)');
    ctx.fillStyle = kGrad;
    ctx.save();
    ctx.translate(kx, ky);
    ctx.scale(2.4, 0.7);
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export function createWoodTextures(): {
  mapH: THREE.CanvasTexture;
  mapV: THREE.CanvasTexture;
  bumpMapH: THREE.CanvasTexture;
  bumpMapV: THREE.CanvasTexture;
} {
  const size = 512;
  const cH = makeCanvas(size, size);
  const bH = makeCanvas(size, size);
  paintHorizontalWoodGrain(cH.getContext('2d')!, bH.getContext('2d')!, size, size);

  const rotate90 = (src: HTMLCanvasElement): HTMLCanvasElement => {
    const out = makeCanvas(size, size);
    const ctx = out.getContext('2d')!;
    ctx.translate(size / 2, size / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(src, -size / 2, -size / 2);
    return out;
  };

  const cV = rotate90(cH);
  const bV = rotate90(bH);

  const configure = (canvas: HTMLCanvasElement, isColor: boolean) => {
    const tex = new THREE.CanvasTexture(canvas);
    if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1.25, 1.25);
    tex.anisotropy = 8;
    return tex;
  };

  return {
    mapH: configure(cH, true),
    mapV: configure(cV, true),
    bumpMapH: configure(bH, false),
    bumpMapV: configure(bV, false),
  };
}

export function createChalkTipTexture(): THREE.CanvasTexture {
  const w = 128;
  const h = 128;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const rand = makeRng(401);

  ctx.fillStyle = '#1e4a73';
  ctx.fillRect(0, 0, w, h * 0.74);

  // Subtle chalk dust grain
  for (let i = 0; i < 420; i++) {
    ctx.fillStyle =
      rand() > 0.5 ? 'rgba(130, 185, 232, 0.22)' : 'rgba(16, 40, 66, 0.28)';
    ctx.fillRect(rand() * w, rand() * h * 0.74, 2.2, 2.2);
  }

  // Dark tanned leather pad base
  ctx.fillStyle = '#331a0e';
  ctx.fillRect(0, h * 0.74, w, h * 0.26);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCueShaftTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 512;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const rand = makeRng(2107);

  // Aged kiln-dried ash / maple shaft (top = tip side, bottom = joint side)
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#d8bc8b');
  grad.addColorStop(0.18, '#e3c798');
  grad.addColorStop(1, '#d3ad76');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Fine straight longitudinal wood grain
  for (let i = 0; i < 84; i++) {
    const x = (i / 84) * w;
    ctx.strokeStyle =
      i % 2 === 0 ? 'rgba(136, 94, 48, 0.16)' : 'rgba(248, 232, 200, 0.14)';
    ctx.lineWidth = 0.8 + rand() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 0; y <= h; y += 32) {
      ctx.lineTo(x + Math.sin(y * 0.015 + i) * 1.4, y);
    }
    ctx.stroke();
  }

  // Subtle blue chalk wear near ferrule
  const chalkGrad = ctx.createLinearGradient(0, 0, 0, h * 0.1);
  chalkGrad.addColorStop(0, 'rgba(34, 82, 128, 0.22)');
  chalkGrad.addColorStop(1, 'rgba(34, 82, 128, 0)');
  ctx.fillStyle = chalkGrad;
  ctx.fillRect(0, 0, w, h * 0.1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function createCueButtTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 512;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const rand = makeRng(7712);

  // Top section (forearm): golden maple base with 4 classic rosewood spliced points
  const forearmEnd = h * 0.45;
  ctx.fillStyle = '#cfa670';
  ctx.fillRect(0, 0, w, forearmEnd);

  // Subtle grain in forearm
  for (let i = 0; i < 48; i++) {
    ctx.strokeStyle = 'rgba(115, 74, 34, 0.15)';
    ctx.lineWidth = 1;
    const x = (i / 48) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, forearmEnd);
    ctx.stroke();
  }

  // 4 spliced rosewood points with amber/ivory veneer outlines
  for (let p = 0; p < 4; p++) {
    const cx = ((p + 0.5) / 4) * w;
    const halfBase = w / 8.5;
    const tipY = h * 0.045;

    // Outer brass/amber veneer
    ctx.fillStyle = '#c48f36';
    ctx.beginPath();
    ctx.moveTo(cx, tipY - 10);
    ctx.lineTo(cx + halfBase + 4, forearmEnd);
    ctx.lineTo(cx - halfBase - 4, forearmEnd);
    ctx.closePath();
    ctx.fill();

    // Inner crimson veneer
    ctx.fillStyle = '#7c2418';
    ctx.beginPath();
    ctx.moveTo(cx, tipY - 3);
    ctx.lineTo(cx + halfBase + 1.5, forearmEnd);
    ctx.lineTo(cx - halfBase - 1.5, forearmEnd);
    ctx.closePath();
    ctx.fill();

    // Rosewood splice core
    ctx.fillStyle = '#3b190d';
    ctx.beginPath();
    ctx.moveTo(cx, tipY + 6);
    ctx.lineTo(cx + halfBase - 2, forearmEnd);
    ctx.lineTo(cx - halfBase + 2, forearmEnd);
    ctx.closePath();
    ctx.fill();
  }

  // Brass + dark phenolic trim ring before wrap
  ctx.fillStyle = '#180d07';
  ctx.fillRect(0, forearmEnd - 4, w, 10);
  ctx.fillStyle = '#c59944';
  ctx.fillRect(0, forearmEnd - 1, w, 4);

  // Grip wrap (stitched dark saddle leather / Irish linen texture)
  const wrapStart = forearmEnd + 6;
  const wrapEnd = h * 0.79;
  ctx.fillStyle = '#21120b';
  ctx.fillRect(0, wrapStart, w, wrapEnd - wrapStart);
  for (let y = wrapStart; y < wrapEnd; y += 3) {
    ctx.strokeStyle =
      y % 6 === 0 ? 'rgba(65, 38, 24, 0.45)' : 'rgba(10, 5, 3, 0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  for (let i = 0; i < 650; i++) {
    ctx.fillStyle =
      rand() > 0.5 ? 'rgba(72, 44, 28, 0.2)' : 'rgba(8, 4, 2, 0.25)';
    ctx.fillRect(rand() * w, wrapStart + rand() * (wrapEnd - wrapStart), 2, 2);
  }

  // Brass ring between wrap and butt sleeve
  ctx.fillStyle = '#180d07';
  ctx.fillRect(0, wrapEnd - 3, w, 9);
  ctx.fillStyle = '#c59944';
  ctx.fillRect(0, wrapEnd, w, 3);

  // Butt sleeve: deep aged walnut/rosewood + subtle inlaid bone diamonds
  const sleeveStart = wrapEnd + 6;
  ctx.fillStyle = '#3c1a0e';
  ctx.fillRect(0, sleeveStart, w, h - sleeveStart);
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = 'rgba(18, 6, 3, 0.28)';
    ctx.lineWidth = 1.4;
    const x = (i / 40) * w;
    ctx.beginPath();
    ctx.moveTo(x, sleeveStart);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  const midSleeveY = sleeveStart + (h - sleeveStart) * 0.5;
  ctx.fillStyle = '#e8d8b5';
  for (let p = 0; p < 4; p++) {
    const cx = ((p + 0.5) / 4) * w;
    ctx.beginPath();
    ctx.moveTo(cx, midSleeveY - 13);
    ctx.lineTo(cx + 8, midSleeveY);
    ctx.lineTo(cx, midSleeveY + 13);
    ctx.lineTo(cx - 8, midSleeveY);
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function createFloorPlankTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d')!;
  const rand = makeRng(5521);

  ctx.fillStyle = '#150d08';
  ctx.fillRect(0, 0, size, size);

  const plankCount = 8;
  const plankH = size / plankCount;
  for (let p = 0; p < plankCount; p++) {
    const y0 = p * plankH;
    const shade = Math.floor((rand() - 0.5) * 14);
    ctx.fillStyle = `rgb(${26 + shade}, ${16 + Math.floor(shade * 0.7)}, ${10 + Math.floor(shade * 0.4)})`;
    ctx.fillRect(0, y0 + 1, size, plankH - 2);

    // Grain streaks
    for (let g = 0; g < 16; g++) {
      const gy = y0 + 3 + rand() * (plankH - 6);
      ctx.strokeStyle =
        g % 2 === 0 ? 'rgba(8, 4, 2, 0.35)' : 'rgba(68, 42, 24, 0.16)';
      ctx.lineWidth = 1 + rand() * 1.5;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(size, gy + (rand() - 0.5) * 4);
      ctx.stroke();
    }

    // Staggered vertical plank joint seam
    const seamX = ((p * 173 + 90) % (size - 80)) + 40;
    ctx.fillStyle = 'rgba(5, 3, 2, 0.78)';
    ctx.fillRect(0, y0, size, 2);
    ctx.fillRect(seamX, y0, 2, plankH);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 4);
  tex.anisotropy = 4;
  return tex;
}

export function createBallTexture(id: number): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const ivory = '#f1e7ce';
  const color = BALL_COLORS[id] ?? '#ffffff';

  if (id === 0) {
    // Classic warm-ivory Pro-Cup cue ball with 6 balanced spots
    ctx.fillStyle = ivory;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#b91c1c';
    const dotR = 9;
    // 4 equatorial spots
    for (const u of [0.125, 0.375, 0.625, 0.875]) {
      ctx.beginPath();
      ctx.arc(u * w, h * 0.5, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
    // 2 upper/lower spots compensated horizontally for equirectangular latitude projection
    for (const [u, v] of [
      [0.25, 0.24],
      [0.75, 0.76],
    ] as const) {
      ctx.save();
      ctx.translate(u * w, v * h);
      ctx.scale(1.45, 1);
      ctx.beginPath();
      ctx.arc(0, 0, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  const isStripe = id >= 9;
  if (isStripe) {
    ctx.fillStyle = ivory;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = color;
    const bandTop = h * 0.25;
    const bandHeight = h * 0.5;
    ctx.fillRect(0, bandTop, w, bandHeight);
    ctx.fillStyle = 'rgba(20, 10, 5, 0.16)';
    ctx.fillRect(0, bandTop, w, 2.5);
    ctx.fillRect(0, bandTop + bandHeight - 2.5, w, 2.5);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  }

  // Vintage cream number medallions on opposite sides of equator
  const badgeRadius = 36;
  for (const cx of [w * 0.25, w * 0.75]) {
    const cy = h * 0.5;
    ctx.fillStyle = ivory;
    ctx.beginPath();
    ctx.arc(cx, cy, badgeRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(24, 15, 8, 0.42)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, badgeRadius - 2.5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#18110b';
    ctx.font = '700 34px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(id), cx, cy + 1.5);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function createShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.08,
    size / 2,
    size / 2,
    size * 0.5
  );
  grad.addColorStop(0, 'rgba(8, 4, 2, 0.62)');
  grad.addColorStop(0.55, 'rgba(8, 4, 2, 0.26)');
  grad.addColorStop(1, 'rgba(8, 4, 2, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(canvas);
}
