// Tests de la app entera en un Chromium real: se le preparan datos en el
// almacenamiento, se abre la página y se lee lo que enseña.
//   node --test
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

function cargarPlaywright() {
  try { return require("playwright"); }
  catch (e) {
    const g = require("node:child_process").execSync("npm root -g").toString().trim();
    return require(path.join(g, "playwright"));
  }
}
const { chromium } = cargarPlaywright();

const RAIZ = path.join(__dirname, "..");
const KEY = "incentivos:v1";
const fmt = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", useGrouping: "always" });
// El € va con un espacio duro: se normaliza para poder comparar con texto escrito
const blanco = t => t.replace(/[\u00a0\u202f]/g, " ");
const EUR = { format: v => blanco(fmt.format(v)) };

let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const f = path.join(RAIZ, decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html"));
    if (!f.startsWith(RAIZ) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    const tipo = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png" };
    res.writeHead(200, { "content-type": tipo[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port + "/";
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

// Abre la app con este estado guardado y el reloj en esta fecha
async function abrir(estado, fecha = "2026-10-15T12:00:00") {
  const ctx = await browser.newContext({ reducedMotion: "reduce", locale: "es-ES" });
  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", e => errores.push(e.message));
  await page.clock.setFixedTime(new Date(fecha));
  if (estado !== undefined) {
    await page.addInitScript(([k, v]) => {
      // Solo la primera vez: al recargar debe quedar lo que guardó la app
      if (!sessionStorage.getItem("pre")) { localStorage.setItem(k, v); sessionStorage.setItem("pre", "1"); }
    }, [KEY, JSON.stringify(estado)]);
  }
  await page.goto(base);
  await page.waitForSelector("#totalIncentivo");
  page.errores = errores;
  page.ctx = ctx;
  return page;
}
const texto = async (page, sel) => blanco(await page.locator(sel).innerText());
const guardado = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
async function cerrar(page) {
  assert.deepEqual(page.errores, [], "errores de JavaScript en la página");
  await page.ctx.close();
}

// Un mes con las cifras escritas a mano: facturación, score y CARE/seguros
// sobre 100 unidades centrales, para poder poner cualquier porcentaje entero
function mesAMano(mk, fact, score, care, seg, nAt = 100, extra = {}) {
  return Object.assign({
    ventas: [],
    overrides: { [mk]: { fact, factBase: 0, score, scoreBase: 0, nCare: care, nCareBase: 0, nSeg: seg, nSegBase: 0, nAt, nAtBase: 0 } }
  }, extra);
}

// La fórmula del PDF, escrita aparte de la app para comprobarla
const PDF = {
  fact: [[20000, 0], [40000, 0.1], [55000, 0.15], [65000, 0.175], [80000, 0.2], [100000, 0.22], [Infinity, 0.25]],
  score: [[100, 1], [200, 1.5], [350, 2], [500, 2.25], [650, 2.5], [800, 2.75], [Infinity, 3]],
  care: [[0, 0.25], [35, 0.75], [40, 1], [45, 1.25]],
  seg: [[0, 0.25], [30, 0.75], [32, 1], [38, 1.25]]
};
const trunc = x => Math.floor(Math.round(x * 1e6) / 1e4) / 100;
const hasta = (t, v) => t.find(([h]) => v <= h)[1];
const desde = (t, p) => t.filter(([d]) => p >= d).pop()[1];
function incentivoPDF(fact, score, pc, ps) {
  const p1 = trunc(fact * hasta(PDF.fact, fact) / 100);
  const p2 = trunc(p1 * hasta(PDF.score, score));
  return trunc(p2 * desde(PDF.care, pc) * desde(PDF.seg, ps));
}

/* ===== Los ejemplos del PDF ===== */

test("ejemplo 1 del PDF: 48.000 €, 346 de score, 48 % CARE y 45 % seguros = 225 €", async () => {
  const p = await abrir(mesAMano("2026-10", 48000, 346, 48, 45));
  assert.equal(await texto(p, "#totalIncentivo"), "225,00 €");
  const chain = await texto(p, "#chain");
  assert.match(chain, /72,00/);
  assert.match(chain, /\b2\b/);
  assert.match(chain, /1,25[\s\S]*1,25/);
  await cerrar(p);
});

test("ejemplo 2 del PDF: 71.000 €, 510 de score = 554,68 € (trunca, no redondea)", async () => {
  const p = await abrir(mesAMano("2026-10", 71000, 510, 48, 45));
  assert.equal(await texto(p, "#totalIncentivo"), "554,68 €");
  await cerrar(p);
});

test("los 7 tramos de facturación, justo en cada corte", async () => {
  const p = await abrir(undefined);
  for (const f of [0, 20000, 20001, 40000, 40001, 55000, 55001, 65000, 65001, 80000, 80001, 100000, 100001, 250000]) {
    await p.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(mesAMano("2026-10", f, 50, 50, 50))]);
    await p.reload();
    assert.equal(await texto(p, "#totalIncentivo"), EUR.format(incentivoPDF(f, 50, 50, 50)), "facturación " + f);
  }
  await cerrar(p);
});

test("los 7 tramos de score, justo en cada corte", async () => {
  const p = await abrir(undefined);
  for (const s of [0, 100, 101, 200, 201, 350, 351, 500, 501, 650, 651, 800, 801, 2000]) {
    await p.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(mesAMano("2026-10", 60000, s, 50, 50))]);
    await p.reload();
    assert.equal(await texto(p, "#totalIncentivo"), EUR.format(incentivoPDF(60000, s, 50, 50)), "score " + s);
  }
  await cerrar(p);
});

test("CARE y seguros tienen cada uno sus 4 tramos", async () => {
  const p = await abrir(undefined);
  const casos = [
    // [CARE, seguros, × CARE, × seguros]
    [34, 29, "0,25", "0,25"], [35, 30, "0,75", "0,75"], [39, 31, "0,75", "0,75"],
    [40, 32, "1", "1"], [44, 37, "1", "1"], [45, 38, "1,25", "1,25"], [80, 90, "1,25", "1,25"]
  ];
  for (const [c, g, mc, mg] of casos) {
    await p.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(mesAMano("2026-10", 60000, 400, c, g))]);
    await p.reload();
    assert.equal(await texto(p, "#lvlCare"), "× " + mc, "CARE " + c + " %");
    assert.equal(await texto(p, "#lvlSeg"), "× " + mg, "seguros " + g + " %");
    assert.equal(await texto(p, "#totalIncentivo"), EUR.format(incentivoPDF(60000, 400, c, g)));
    assert.equal(await p.locator("#stCare i").count(), 4);
  }
  await cerrar(p);
});

test("9 de 20 es un 45 % justo y ya entra en el tramo alto pese a la coma flotante", async () => {
  const p = await abrir(mesAMano("2026-10", 60000, 400, 9, 9, 20));
  assert.equal(await texto(p, "#lvlCare"), "× 1,25");
  await cerrar(p);
});

/* ===== Los meses de antes siguen con la fórmula del email ===== */

test("septiembre de 2026 sigue con la fórmula del email: su ejemplo da 563,83 €", async () => {
  const p = await abrir(mesAMano("2026-09", 55000, 346, 48, 45));
  await p.click("#prevM");
  assert.equal(await texto(p, "#totalIncentivo"), "563,83 €");
  assert.equal(await p.locator("#stCare i").count(), 3);
  assert.equal(await p.locator("#stFact i").count(), 5);
  await cerrar(p);
});

test("el total del año suma cada mes con su fórmula", async () => {
  const e = mesAMano("2026-10", 48000, 346, 48, 45);
  Object.assign(e.overrides, mesAMano("2026-09", 55000, 346, 48, 45).overrides);
  // El total del año solo cuenta los meses con ventas
  e.ventas = [
    { id: "a", date: "2026-09-10", ts: 1, amount: 0, score: 0, care: false, seguro: false, acc: true, items: [] },
    { id: "b", date: "2026-10-10", ts: 2, amount: 0, score: 0, care: false, seguro: false, acc: true, items: [] }
  ];
  const p = await abrir(e);
  assert.equal(await texto(p, "#yearTotal"), "Total estimado 2026: " + EUR.format(563.83 + 225));
  await cerrar(p);
});

/* ===== Lo que ya había guardado en cada móvil ===== */

test("lo guardado antes del PDF se migra: la fórmula del email pasa a los meses de antes con sus retoques", async () => {
  const viejo = mesAMano("2026-09", 55000, 346, 48, 45, 100, {
    cfg: {
      fact: [{ hasta: 5000, pct: 0 }, { hasta: 20000, pct: 0.10 }, { hasta: 46000, pct: 0.15 }, { hasta: 70000, pct: 0.25 }, { hasta: null, pct: 0.30 }],
      score: [{ hasta: 100, mult: 1 }, { hasta: 250, mult: 1.5 }, { hasta: 375, mult: 2.25 }, { hasta: 500, mult: 2.5 }, { hasta: null, mult: 3 }],
      at: { t1: 25, t2: 45, m1: 0.25, m2: 0.75, m3: 1.4 }, col: 1
    }
  });
  viejo.ventas = [{ id: "a", date: "2026-09-10", ts: 1, amount: 1000, score: 10, care: true, seguro: false, items: [] }];
  viejo.overrides["2026-09"].factBase = 1000; viejo.overrides["2026-09"].scoreBase = 10;
  viejo.overrides["2026-09"].nCareBase = 1; viejo.overrides["2026-09"].nAtBase = 1; viejo.overrides["2026-09"].nSegBase = 0;
  const p = await abrir(viejo);
  const g = await guardado(p);
  assert.equal(g.cfg.desde, "2026-10");
  assert.equal(g.cfg.fact.length, 7);
  assert.deepEqual(g.cfg.care.map(t => t.desde), [0, 35, 40, 45]);
  assert.deepEqual(g.cfg.seg.map(t => t.desde), [0, 30, 32, 38]);
  assert.equal(g.cfgAnt.length, 1);
  assert.equal(g.cfgAnt[0].desde, null);
  assert.equal(g.cfgAnt[0].care[2].mult, 1.4, "se conserva el retoque de la fórmula del email");
  assert.equal(g.ventas.length, 1, "las ventas siguen ahí");
  await p.click("#prevM");
  // En la del email los tramos de attach eran los mismos para los dos: 309,37 × 1,4 × 1,4 = 606,37
  assert.equal(await texto(p, "#totalIncentivo"), "606,37 €");
  // Abrir otra vez no vuelve a migrar ni cambia nada
  await p.reload();
  assert.deepEqual(await guardado(p), g);
  await cerrar(p);
});

test("lo guardado sin fórmula propia también se migra y septiembre no cambia", async () => {
  const viejo = mesAMano("2026-09", 55000, 346, 48, 45);
  viejo.ventas = [{ id: "a", date: "2026-09-10", ts: 1, amount: 0, score: 0, care: false, seguro: false, acc: true, items: [] }];
  const p = await abrir(viejo);
  const g = await guardado(p);
  assert.equal(g.cfgAnt[0].care[2].mult, 1.35);
  await p.click("#prevM");
  assert.equal(await texto(p, "#totalIncentivo"), "563,83 €");
  await cerrar(p);
});

test("importar una copia de antes del PDF la migra igual", async () => {
  const p = await abrir(undefined);
  const copia = mesAMano("2026-09", 55000, 346, 48, 45, 100, {
    cfg: {
      fact: [{ hasta: 5000, pct: 0 }, { hasta: 20000, pct: 0.10 }, { hasta: 46000, pct: 0.15 }, { hasta: 70000, pct: 0.25 }, { hasta: null, pct: 0.30 }],
      score: [{ hasta: 100, mult: 1 }, { hasta: 250, mult: 1.5 }, { hasta: 375, mult: 2.25 }, { hasta: 500, mult: 2.5 }, { hasta: null, mult: 3 }],
      at: { t1: 25, t2: 45, m1: 0.25, m2: 0.75, m3: 1.35 }, col: 1
    }
  });
  copia.ventas = [{ id: "a", date: "2026-09-10", ts: 1, amount: 0, score: 0, care: false, seguro: false, acc: true, items: [] }];
  await p.setInputFiles("#fileImport", { name: "copia.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(copia)) });
  await p.click("#askYes");
  await p.waitForFunction(() => document.getElementById("toastMsg").textContent.includes("importada"));
  const g = await guardado(p);
  assert.equal(g.cfg.fact.length, 7);
  assert.equal(g.cfgAnt[0].fact.length, 5);
  await p.click("#prevM");
  assert.equal(await texto(p, "#totalIncentivo"), "563,83 €");
  await cerrar(p);
});

/* ===== Ajustes ===== */

test("en Ajustes se cambia desde qué mes cuenta la fórmula del PDF", async () => {
  const p = await abrir(mesAMano("2026-09", 48000, 346, 48, 45));
  await p.click("#prevM");
  assert.equal(await texto(p, "#totalIncentivo"), EUR.format(
    // Con la del email: 48.000 × 0,25 % = 120 → × 2,25 = 270 → × 1,35 × 1,35
    Math.round(270 * 1.35 * 1.35 * 100) / 100));
  await p.click("#btnCfg");
  assert.equal(await p.inputValue("#cfgDesde"), "2026-10");
  assert.equal(await p.locator("#cfgCare tr").count(), 4);
  assert.equal(await p.locator("#cfgSeg tr").count(), 4);
  assert.equal(await p.locator("#cfgFact tr").count(), 7);
  await p.fill("#cfgDesde", "2026-09");
  await p.click("#cfgSave");
  assert.equal(await texto(p, "#totalIncentivo"), "225,00 €");
  assert.equal((await guardado(p)).cfg.desde, "2026-09");
  await cerrar(p);
});

test("los tramos de attach se editan por separado y se validan", async () => {
  const p = await abrir(mesAMano("2026-10", 48000, 346, 36, 45));
  assert.equal(await texto(p, "#lvlCare"), "× 0,75");
  await p.click("#btnCfg");
  await p.fill("#cfCD1", "37");
  await p.click("#cfgSave");
  assert.equal(await texto(p, "#lvlCare"), "× 0,25");
  assert.equal(await texto(p, "#lvlSeg"), "× 1,25", "seguros no se toca");
  await p.click("#btnCfg");
  await p.fill("#cfGD2", "20");
  await p.click("#cfgSave");
  assert.match(await texto(p, "#toastMsg"), /menor a mayor/);
  assert.equal((await guardado(p)).cfg.seg[2].desde, 32, "no se guarda");
  await cerrar(p);
});

test("Valores del PDF no cambia nada si se cierra sin guardar", async () => {
  const p = await abrir(mesAMano("2026-10", 48000, 346, 36, 45));
  await p.click("#btnCfg");
  await p.fill("#cfCD1", "37");
  await p.click("#cfgSave");
  assert.equal(await texto(p, "#lvlCare"), "× 0,25");
  await p.click("#btnCfg");
  await p.click("#cfgReset");
  assert.equal(await p.inputValue("#cfCD1"), "35");
  await p.keyboard.press("Escape");
  await p.reload();
  assert.equal(await texto(p, "#lvlCare"), "× 0,25");
  assert.equal((await guardado(p)).cfg.care[1].desde, 37);
  // Y guardando sí vuelve a los del PDF
  await p.click("#btnCfg");
  await p.click("#cfgReset");
  await p.click("#cfgSave");
  assert.equal(await texto(p, "#lvlCare"), "× 0,75");
  await cerrar(p);
});

/* ===== Lo que se enseña alrededor ===== */

test("con ventas reales, en el 35 % justo de CARE avisa de que la próxima sin CARE baja", async () => {
  const ventas = [];
  for (let i = 0; i < 20; i++)
    ventas.push({ id: "v" + i, date: "2026-10-0" + (1 + i % 9), ts: i, amount: 2500, score: 20, care: i < 7, seguro: i < 9, items: [] });
  const p = await abrir({ ventas, overrides: {} });
  assert.equal(await texto(p, "#lvlCare"), "× 0,75");
  assert.match(await texto(p, "#hCare"), /próxima sin CARE te baja/);
  assert.match(await texto(p, "#tip"), /CARE te baja a × 0,25/);
  await cerrar(p);
});

test("lo que falta para subir propone los CARE que llevan al siguiente tramo del PDF", async () => {
  // Sin ninguna venta apuntada no se proponen movimientos: se pone una suelta
  const e = mesAMano("2026-10", 48000, 346, 33, 45);
  e.ventas = [{ id: "a", date: "2026-10-05", ts: 1, amount: 0, score: 0, care: false, seguro: false, acc: true, items: [] }];
  const p = await abrir(e);
  const vistos = new Set();
  for (let i = 0; i < 4; i++) {
    vistos.add(await texto(p, "#levs"));
    await p.click("#levs");
    await p.waitForTimeout(250);
  }
  // 33 de 100: con 3 más, 36/103 = 34,95 % no llega; con 4, 37/104 = 35,6 % sí
  const need = Math.ceil((35 * 100 - 100 * 33) / 65);
  assert.ok([...vistos].some(t => t.includes(need + " CARE")), [...vistos].join(" | "));
  await cerrar(p);
});

test("Cómo se calcula enseña las tablas del mes en vista", async () => {
  const p = await abrir({ ventas: [], overrides: {} });
  await p.click("#btnInfo");
  assert.equal(await p.locator("#infoFact tr").count(), 8);
  assert.equal(await p.locator("#infoCare tr").count(), 5);
  assert.match(await texto(p, "#infoSeg"), /38 % o más/);
  assert.match(await texto(p, "#infoCual"), /piloto/);
  await p.keyboard.press("Escape");
  await p.click("#prevM");
  await p.click("#btnInfo");
  assert.equal(await p.locator("#infoFact tr").count(), 6);
  assert.match(await texto(p, "#infoCual"), /email/);
  await cerrar(p);
});

test("la app abre sin datos guardados y sin errores", async () => {
  const p = await abrir(undefined);
  assert.equal(await texto(p, "#totalIncentivo"), "0,00 €");
  await cerrar(p);
});

/* ===== Lo que falta para el siguiente tramo, en las fichas ===== */

// 40 ventas de 1.400 €: las primeras con CARE y las últimas con seguro
function mesDeVentas(care, seg, n = 40) {
  const ventas = [];
  for (let i = 0; i < n; i++)
    ventas.push({ id: "v" + i, date: "2026-10-" + String(1 + i % 14).padStart(2, "0"), ts: i, amount: 1400, score: 12, care: i < care, seguro: i >= n - seg, items: [] });
  return { ventas, overrides: {} };
}

test("la ficha de seguros dice cuántos faltan para el siguiente tramo, igual que la línea de movimientos", async () => {
  // 13 de 40 = 32,5 % (× 1): 13/41 = 31,7 % ya baja, y para el 38 % hacen falta 4 más, 17/44 = 38,6 %
  const p = await abrir(mesDeVentas(18, 13));
  const h = await texto(p, "#hSeg");
  assert.match(h, /próxima sin seguro te baja/);
  assert.match(h, /Con 4 seguros más, × 1,25/);
  const vistos = new Set();
  for (let i = 0; i < 5; i++) { vistos.add(await texto(p, "#levs")); await p.click("#levs"); await p.waitForTimeout(250); }
  assert.ok([...vistos].some(t => /4 seguros más/.test(t)), [...vistos].join(" | "));
  await cerrar(p);
});

test("en el tramo más bajo la ficha lo dice en servicios, no en puntos", async () => {
  // 10 de 40 = 25 % de CARE: para el 35 % hacen falta 7, 17/47 = 36,2 % (con 6, 16/46 = 34,8 %)
  const p = await abrir(mesDeVentas(10, 13));
  assert.equal(await texto(p, "#hCare"), "Con 7 CARE más, × 0,75");
  await cerrar(p);
});

test("en el tramo alto no hay siguiente y solo queda el margen", async () => {
  const p = await abrir(mesDeVentas(30, 20));
  const h = await texto(p, "#hCare");
  assert.match(h, /^Aguantas \d+ unidades sin CARE$/);
  await cerrar(p);
});

test("con el aviso en rojo, lo que falta para subir va debajo sin teñirse", async () => {
  // 7 de 20 = 35 % justo de CARE: la próxima sin CARE baja; para el 40 % faltan 2 (9/22 = 40,9 %)
  const p = await abrir(mesDeVentas(7, 9, 20));
  assert.match(await texto(p, "#hCare"), /próxima sin CARE te baja\s*Con 2 CARE más, × 1/);
  const color = await p.$eval("#hCare .sig", e => getComputedStyle(e).fontWeight);
  assert.equal(color, "400");
  await cerrar(p);
});

/* ===== Parte 4 · Multiplicadores colectivos, mes a mes ===== */

// El ejemplo 1 del PDF (225 € tras las tres primeras partes) con datos de la Parte 4
function conP4(p4, delegacion, mk = "2026-11") {
  const e = mesAMano(mk, 48000, 346, 48, 45);
  e.overrides[mk].p4 = p4;
  if (delegacion) e.delegacion = delegacion;
  return e;
}

test("Parte 4: cada multiplicador cae en su tramo, justo en los cortes", async () => {
  const p = await abrir(undefined, "2026-11-20T12:00:00");
  const casos = [
    // [datos del mes, delegación, multiplicador esperado]
    [{ resenas: 30 }, "grande", 0.95], [{ resenas: 31 }, "grande", 1], [{ resenas: 40 }, "grande", 1], [{ resenas: 41 }, "grande", 1.05],
    [{ resenas: 20 }, "mediana", 0.95], [{ resenas: 21 }, "mediana", 1], [{ resenas: 30 }, "mediana", 1], [{ resenas: 31 }, "mediana", 1.05],
    [{ resenas: 10 }, "pequena", 0.95], [{ resenas: 11 }, "pequena", 1], [{ resenas: 20 }, "pequena", 1], [{ resenas: 21 }, "pequena", 1.05],
    [{ resenas: 50 }, null, 1], // sin tamaño de delegación no se puede saber
    [{ llamadas: 64.9, calidad: 9 }, null, 0.95], [{ llamadas: 65, calidad: 7 }, null, 1], [{ llamadas: 79.9, calidad: 7 }, null, 1],
    [{ llamadas: 80, calidad: 7 }, null, 1.05], [{ llamadas: 95, calidad: 6.9 }, null, 0.95],
    [{ llamadas: 50 }, null, 0.95], [{ calidad: 5 }, null, 0.95], [{ llamadas: 85 }, null, 1], [{ calidad: 8 }, null, 1],
    [{ repar: 89.9 }, null, 0.95], [{ repar: 90 }, null, 1], [{ repar: 99.9 }, null, 1], [{ repar: 100 }, null, 1.05], [{ repar: 120 }, null, 1.05],
    // Objetivos: facturación del mes 48.000 €
    [{ obj: 48000, tienda: true }, null, 1.1], [{ obj: 48000 }, null, 1], [{ obj: 48000, tienda: false }, null, 1],
    [{ obj: 50000, tienda: true }, null, 1], [{ obj: 50000 }, null, 0.9], [{ obj: 50000, tienda: false }, null, 0.9],
    [{ tienda: true }, null, 1] // sin tu objetivo puesto no cuenta
  ];
  for (const [p4, del, m] of casos) {
    await p.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(conP4(p4, del))]);
    await p.reload();
    assert.equal(await texto(p, "#totalIncentivo"), EUR.format(trunc(225 * m)), JSON.stringify(p4) + " " + del);
  }
  await cerrar(p);
});

test("Parte 4: los cuatro a la vez multiplican el resultado de las tres primeras", async () => {
  const p = await abrir(conP4({ obj: 45000, tienda: true, resenas: 45, llamadas: 85, calidad: 8, repar: 100 }, "grande"), "2026-11-20T12:00:00");
  // 225 × 1,1 × 1,05 × 1,05 × 1,05 = 286,5121875
  assert.equal(await texto(p, "#totalIncentivo"), "286,51 €");
  const chain = await texto(p, "#chain");
  for (const l of ["OBJETIVOS", "RESEÑAS", "TELÉFONO", "SAT"]) assert.match(chain.toUpperCase(), new RegExp(l));
  assert.equal(await p.locator("#p4Chips .p4c.hi").count(), 4);
  await cerrar(p);
});

test("sin datos de la Parte 4 nada cambia y la ficha lo dice", async () => {
  const p = await abrir(mesAMano("2026-11", 48000, 346, 48, 45), "2026-11-20T12:00:00");
  assert.equal(await texto(p, "#totalIncentivo"), "225,00 €");
  assert.ok(!(await p.locator("#tileP4").isHidden()));
  assert.ok(!(await p.locator("#lvlP4").isHidden()), "marca sin datos");
  assert.match(await texto(p, "#metaTxt"), /Pon tu objetivo del mes/);
  await cerrar(p);
});

test("el objetivo y los datos de la tienda se ponen desde la app y van mes a mes", async () => {
  const e = mesAMano("2026-11", 48000, 346, 48, 45);
  Object.assign(e.overrides, mesAMano("2026-10", 48000, 346, 48, 45).overrides);
  const p = await abrir(e, "2026-11-20T12:00:00");
  await p.click("#btnMeta");
  await p.fill("#metaInput", "45.000");
  await p.click('#p4Tienda [data-v="1"]');
  await p.click('#p4Del [data-v="grande"]');
  await p.fill("#p4Resenas", "45");
  assert.match(await texto(p, "#p4rRes"), /× 1,05/);
  assert.match(await texto(p, "#p4Total"), /247,50|259,87/);
  await p.click("#metaGuardar");
  // 225 × 1,1 × 1,05 = 259,875
  assert.equal(await texto(p, "#totalIncentivo"), "259,87 €");
  assert.match(await texto(p, "#metaTxt"), /Objetivo cumplido/);
  const g = await guardado(p);
  assert.deepEqual(g.overrides["2026-11"].p4, { obj: 45000, tienda: true, resenas: 45 });
  assert.equal(g.delegacion, "grande");
  // Octubre no tiene nada de esto
  await p.click("#prevM");
  assert.equal(await texto(p, "#totalIncentivo"), "225,00 €");
  await p.click("#btnMeta");
  assert.equal(await p.inputValue("#metaInput"), "");
  await p.keyboard.press("Escape");
  // Y al volver a abrir, noviembre sigue con lo suyo y se puede actualizar
  await p.reload();
  await p.click("#btnMeta");
  assert.equal(await p.inputValue("#metaInput"), "45000");
  await p.fill("#p4Resenas", "");
  await p.click("#metaGuardar");
  assert.equal(await texto(p, "#totalIncentivo"), "247,50 €");
  await cerrar(p);
});

test("con objetivo puesto: cuánto falta, el ritmo diario y lo que ganas al cumplirlo", async () => {
  const ventas = [];
  for (let i = 0; i < 40; i++)
    ventas.push({ id: "v" + i, date: "2026-11-" + String(1 + i % 17).padStart(2, "0"), ts: i, amount: 1400, score: 12, care: i < 18, seguro: i >= 24, items: [] });
  const p = await abrir({ ventas, overrides: { "2026-11": { p4: { obj: 60000, tienda: true } } } }, "2026-11-18T12:00:00");
  assert.match(await texto(p, "#metaTxt"), /te faltan 4\.000 €/);
  assert.match(await texto(p, "#proj"), /para tu objetivo, 500 €\/día/);
  const vistos = new Set();
  for (let i = 0; i < 5; i++) { vistos.add(await texto(p, "#levs")); await p.click("#levs"); await p.waitForTimeout(250); }
  assert.ok([...vistos].some(t => /4\.000 € para tu objetivo/.test(t)), [...vistos].join(" | "));
  // Una venta que lo cruza lo celebra
  await p.fill("#fAmount", String(4100 * 1.21)); await p.click("#btnSave");
  assert.match(await texto(p, "#toastMsg"), /Objetivo del mes cumplido/);
  assert.match(await texto(p, "#hP4"), /Tu objetivo ✓ · tienda ✓/);
  await cerrar(p);
});

test("en los meses con la fórmula del email la Parte 4 no existe", async () => {
  const e = mesAMano("2026-09", 55000, 346, 48, 45);
  e.overrides["2026-09"].p4 = { obj: 50000, tienda: true, resenas: 60, repar: 100 };
  e.delegacion = "grande";
  const p = await abrir(e, "2026-11-20T12:00:00");
  await p.click("#prevM"); await p.click("#prevM");
  assert.equal(await texto(p, "#totalIncentivo"), "563,83 €");
  assert.ok(await p.locator("#tileP4").isHidden());
  assert.match(await texto(p, "#metaTxt"), /Objetivo cumplido/);
  await p.click("#btnMeta");
  assert.ok(!(await p.locator("#p4Viejo").isHidden()));
  await p.keyboard.press("Escape");
  await p.click("#btnInfo");
  assert.match(await texto(p, "#infoP4"), /no tenía esta parte/);
  await cerrar(p);
});

test("Cómo se calcula enseña las tablas de la Parte 4", async () => {
  const p = await abrir({ ventas: [], overrides: {} }, "2026-11-20T12:00:00");
  await p.click("#btnInfo");
  const t = await texto(p, "#infoP4");
  assert.match(t, /hasta 30\s+hasta 20\s+hasta 10\s+× 0,95/);
  assert.match(t, /más de 40\s+más de 30\s+más de 20\s+× 1,05/);
  assert.match(t, /80 % o más, con nota 7 o más\s+× 1,05/);
  assert.match(t, /Los dos\s+× 1,1/);
  await cerrar(p);
});

test("la copia de seguridad lleva los datos de la Parte 4 y el tamaño de la delegación", async () => {
  const p = await abrir(undefined, "2026-11-20T12:00:00");
  const copia = conP4({ obj: 45000, tienda: true, resenas: 45 }, "grande");
  copia.ventas = [{ id: "a", date: "2026-11-10", ts: 1, amount: 0, score: 0, care: false, seguro: false, acc: true, items: [] }];
  await p.setInputFiles("#fileImport", { name: "c.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(copia)) });
  await p.click("#askYes");
  await p.waitForFunction(() => document.getElementById("toastMsg").textContent.includes("importada"));
  assert.equal(await texto(p, "#totalIncentivo"), "259,87 €");
  assert.equal((await guardado(p)).delegacion, "grande");
  await cerrar(p);
});

/* ===== Auditoría: meses al azar contra la fórmula escrita aparte ===== */

test("200 meses al azar, con y sin datos de la Parte 4, cuadran al céntimo con el PDF", async () => {
  let seed = 2026;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const quizas = (v, prob = 0.6) => (rnd() < prob ? v : undefined);
  // Attach con enteros, sin coma flotante: num/den >= desde %
  const multAt = (t, num, den) => den === 0 ? (num > 0 ? t[t.length - 1][1] : t[0][1])
    : t.reduce((m, [d, x]) => (num * 100 >= d * den ? x : m), t[0][1]);
  const r2 = x => Math.round(x * 100 + 1e-6) / 100;
  const p = await abrir(undefined, "2026-11-25T12:00:00");
  for (let i = 0; i < 200; i++) {
    const ventas = [];
    const n = ri(1, 80), escala = [0.4, 1, 2, 3][ri(0, 3)];
    for (let k = 0; k < n; k++) {
      const acc = rnd() < 0.12;
      const v = { id: "v" + k, date: "2026-11-" + String(ri(1, 25)).padStart(2, "0"), ts: k, amount: Math.round(rnd() * 2500 * escala * 100) / 100,
        score: ri(0, 25), care: !acc && rnd() < 0.42, seguro: !acc && rnd() < 0.36, acc, items: [] };
      if (!acc && rnd() < 0.12) v.uds = 2;
      ventas.push(v);
    }
    const fact = r2(ventas.reduce((a, v) => a + v.amount, 0)), score = ventas.reduce((a, v) => a + v.score, 0);
    const p4 = {};
    if (rnd() < 0.7) {
      Object.assign(p4, {
        obj: quizas(Math.round(fact * (0.7 + rnd() * 0.6) / 100) * 100), tienda: quizas(rnd() < 0.5),
        resenas: quizas(ri(0, 60)), llamadas: quizas(ri(50, 100)), calidad: quizas(ri(50, 100) / 10), repar: quizas(ri(80, 115))
      });
      Object.keys(p4).forEach(k => p4[k] === undefined && delete p4[k]);
    }
    const del = [undefined, "grande", "mediana", "pequena"][ri(0, 3)];
    const st = { ventas, overrides: Object.keys(p4).length ? { "2026-11": { p4 } } : {}, delegacion: del };
    await p.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(st)]);
    await p.reload();
    // Partes 1 a 3
    const nAt = ventas.reduce((a, v) => a + (v.uds != null ? v.uds : (v.acc ? 0 : 1)), 0);
    const nC = ventas.filter(v => v.care).length, nG = ventas.filter(v => v.seguro).length;
    const p1 = trunc(fact * hasta(PDF.fact, fact) / 100), p2 = trunc(p1 * hasta(PDF.score, score));
    const p3 = trunc(p2 * multAt(PDF.care, nC, nAt) * multAt(PDF.seg, nG, nAt));
    // Parte 4, según el texto del PDF
    const corte = { grande: [30, 40], mediana: [20, 30], pequena: [10, 20] }[del];
    const mRes = p4.resenas == null || !corte ? 1 : p4.resenas <= corte[0] ? 0.95 : p4.resenas <= corte[1] ? 1 : 1.05;
    const ll = p4.llamadas, q = p4.calidad;
    const mTel = (ll != null && ll < 65) || (q != null && q < 7) ? 0.95 : (ll != null && q != null ? (ll >= 80 ? 1.05 : 1) : 1);
    const mSat = p4.repar == null ? 1 : p4.repar >= 100 ? 1.05 : p4.repar >= 90 ? 1 : 0.95;
    const mObj = p4.obj == null ? 1 : [0.9, 1, 1.1][(fact >= p4.obj ? 1 : 0) + (p4.tienda === true ? 1 : 0)];
    const esperado = trunc(p3 * mObj * mRes * mTel * mSat);
    assert.equal(await texto(p, "#totalIncentivo"), EUR.format(esperado), "mes " + i + ": " + JSON.stringify({ fact, score, nAt, nC, nG, p4, del }));
  }
  await cerrar(p);
});

test("Borrar mes quita las ventas pero no el objetivo ni los datos de la tienda", async () => {
  const e = conP4({ obj: 45000, tienda: true }, "grande");
  e.ventas = [{ id: "a", date: "2026-11-10", ts: 1, amount: 100, score: 1, care: false, seguro: false, items: [] }];
  const p = await abrir(e, "2026-11-20T12:00:00");
  await p.click("#btnWipe"); await p.click("#askYes");
  const g = await guardado(p);
  assert.equal(g.ventas.length, 0);
  assert.deepEqual(g.overrides["2026-11"], { p4: { obj: 45000, tienda: true } });
  assert.match(await texto(p, "#metaTxt"), /Objetivo 45\.000 €/);
  await cerrar(p);
});
