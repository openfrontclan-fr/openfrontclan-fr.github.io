// Dessine assets/world.svg, la carte du monde en points derrière l'accueil.
// Source : resources/maps/world/map16x.bin d'OpenFront (CC BY-SA 4.0, attribution « OpenFront »), 516 × 258 cases,
// un octet par case dont le bit 0x80 dit « terre ». On garde une case sur 4 dans chaque sens, sans le cadre de la carte.
// Usage : node scripts/world-map.mjs chemin/vers/map16x.bin
import { readFile, writeFile } from "node:fs/promises";

const [source] = process.argv.slice(2);
if (!source) throw new Error("Usage : node scripts/world-map.mjs chemin/vers/map16x.bin");
const W = 516;
const H = 258;
const STEP = 4;
const tiles = await readFile(source);
if (tiles.length !== W * H) throw new Error(`Taille inattendue : ${tiles.length} octets au lieu de ${W * H}`);

let d = "";
for (let y = STEP; y < H - STEP; y += STEP) {
  for (let x = STEP; x < W - STEP; x += STEP) {
    if (tiles[y * W + x] & 0x80) d += `M${x / STEP} ${y / STEP}h0`;
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W / STEP} ${H / STEP}">`
  + `<!-- Carte « World » d'OpenFront (CC BY-SA 4.0, © OpenFront and Contributors), réduite en points. Même licence. -->`
  + `<path d="${d}" fill="none" stroke="#7f9dff" stroke-opacity=".1" stroke-width=".5" stroke-linecap="round"/></svg>\n`;
await writeFile("assets/world.svg", svg);
console.log("assets/world.svg", (svg.length / 1024).toFixed(1), "Ko");
