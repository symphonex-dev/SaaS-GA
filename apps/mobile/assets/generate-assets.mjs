import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Génère les icônes et l'image de démarrage de l'application.
 *
 * Aucune dépendance : encodeur PNG minimal (IHDR / IDAT / IEND, RGBA 8 bits).
 * Le motif est dessiné par calcul de pixels — un anneau ouvert avec sa pointe
 * de flèche, qui évoque la récurrence, sur le bleu de marque du thème
 * (`tailwind.config.js`, `brand-600` = #1d4ed8).
 */
const OUT = process.argv[2];

const BRAND = [29, 78, 216, 255]; // #1d4ed8
const WHITE = [255, 255, 255, 255];

function crc32(buffer) {
  let table = crc32.table;
  if (table === undefined) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    crc32.table = table;
  }
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filtre « none »
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Couverture anti-crénelée d'un pixel : 1 à l'intérieur, 0 dehors, dégradé au bord. */
function coverage(distance, edge, softness = 1.5) {
  return Math.min(1, Math.max(0, (edge - distance) / softness + 0.5));
}

function blend(target, offset, color, alpha) {
  if (alpha <= 0) return;
  const inverse = 1 - alpha;
  for (let i = 0; i < 3; i += 1) {
    target[offset + i] = Math.round(target[offset + i] * inverse + color[i] * alpha);
  }
  target[offset + 3] = Math.round(target[offset + 3] * inverse + 255 * alpha);
}

/**
 * Dessine l'anneau ouvert + la pointe de flèche.
 *
 * @param scale part du côté occupée par le diamètre extérieur du motif.
 */
function drawMark(pixels, size, color, scale) {
  const center = size / 2;
  const outer = (size * scale) / 2;
  const thickness = outer * 0.26;
  const inner = outer - thickness;
  // Ouverture de l'anneau, en haut à droite : c'est elle qui fait la flèche.
  const gapFrom = -0.55;
  const gapTo = 0.62;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const distance = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const inGap = angle > gapFrom && angle < gapTo;

      if (!inGap) {
        const alpha = Math.min(coverage(distance, outer), coverage(inner, distance));
        blend(pixels, (y * size + x) * 4, color, alpha);
      }
    }
  }

  // Pointe de flèche : triangle isocèle posé à l'extrémité haute de l'anneau.
  const tipAngle = gapTo;
  const radius = (outer + inner) / 2;
  const ax = center + Math.cos(tipAngle) * radius;
  const ay = center + Math.sin(tipAngle) * radius;
  const half = thickness * 1.15;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - ax;
      const dy = y + 0.5 - ay;
      // Repère local aligné sur la tangente de l'anneau.
      const along = dx * Math.cos(tipAngle) + dy * Math.sin(tipAngle);
      const across = -dx * Math.sin(tipAngle) + dy * Math.cos(tipAngle);
      const width = half * (1 - Math.max(0, -along) / (half * 2.2));

      if (along <= 0 && along >= -half * 2.2 && Math.abs(across) <= Math.max(0, width)) {
        blend(pixels, (y * size + x) * 4, color, 1);
      }
    }
  }
}

function filled(size, color) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    pixels[i * 4] = color[0];
    pixels[i * 4 + 1] = color[1];
    pixels[i * 4 + 2] = color[2];
    pixels[i * 4 + 3] = color[3];
  }
  return pixels;
}

function write(name, buffer) {
  const target = path.join(OUT, name);
  fs.writeFileSync(target, buffer);
  console.log(`  ${name} — ${(buffer.length / 1024).toFixed(1)} KiB`);
}

fs.mkdirSync(OUT, { recursive: true });

// Icône d'application : fond opaque (iOS refuse la transparence sur l'icône).
const icon = filled(1024, BRAND);
drawMark(icon, 1024, WHITE, 0.56);
write('icon.png', encodePng(1024, 1024, icon));

// Icône adaptative Android : premier plan transparent, motif dans la zone sûre
// (66 % du côté), le fond étant fourni par `adaptiveIcon.backgroundColor`.
const adaptive = filled(1024, [0, 0, 0, 0]);
drawMark(adaptive, 1024, WHITE, 0.42);
write('adaptive-icon.png', encodePng(1024, 1024, adaptive));

// Image de démarrage : motif de marque sur fond transparent, le fond venant du
// plugin `expo-splash-screen`.
const splash = filled(1024, [0, 0, 0, 0]);
drawMark(splash, 1024, BRAND, 0.5);
write('splash-icon.png', encodePng(1024, 1024, splash));

// Favicon des pages servies par le bundler en développement.
const favicon = filled(48, BRAND);
drawMark(favicon, 48, WHITE, 0.62);
write('favicon.png', encodePng(48, 48, favicon));
