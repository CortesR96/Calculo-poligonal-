// ═══════════════════════════════════════════════════
//  TopoField — Motor de cálculo topográfico
//  Convenios:
//   · Ángulo vertical ZC: 90° = horizontal, 0° = vertical arriba
//   · DH = DI × sin(ZC)
//   · ΔZ = DI × cos(ZC) + hi − hr
//   · Az(B→C) = Az(A→B) + 180° − β   (ceros en A, lees β a C)
//   · Azimut normalizado en [0°, 360°)
// ═══════════════════════════════════════════════════

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function toRad(d) { return d * DEG; }
function toDeg(r) { return r * RAD; }
function norm360(a) { return ((a % 360) + 360) % 360; }
function fmt(n, d = 4) { return (isNaN(n) || n === null) ? '—' : Number(n).toFixed(d); }
function fmtDeg(n) { return fmt(n, 4) + '°'; }


// ─── Conversión GMS ↔ Decimal ────────────────────
function gmsToDecimal(g, m, s) {
  g = parseFloat(g) || 0;
  m = parseFloat(m) || 0;
  s = parseFloat(s) || 0;
  return g + m / 60 + s / 3600;
}

function decimalToGMS(dec) {
  dec = ((dec % 360) + 360) % 360;
  const g = Math.floor(dec);
  const mFull = (dec - g) * 60;
  const m = Math.floor(mFull);
  const s = (mFull - m) * 60;
  return { g, m, s: Math.round(s * 10) / 10 };
}

function fmtGMS(dec) {
  const { g, m, s } = decimalToGMS(dec);
  return `${g}° ${String(m).padStart(2,'0')}' ${String(s.toFixed(1)).padStart(4,'0')}"`;
}

function readGMS(idPrefix) {
  const g = document.getElementById(idPrefix + '-g');
  const m = document.getElementById(idPrefix + '-m');
  const s = document.getElementById(idPrefix + '-s');
  if (!g) return NaN;
  return gmsToDecimal(g.value, m.value, s.value);
}

function writeGMS(idPrefix, decimal) {
  const { g, m, s } = decimalToGMS(decimal);
  const eg = document.getElementById(idPrefix + '-g');
  const em = document.getElementById(idPrefix + '-m');
  const es = document.getElementById(idPrefix + '-s');
  if (!eg) return;
  eg.value = g;
  em.value = String(m).padStart(2, '0');
  es.value = s.toFixed(1);
}

function clearGMS(idPrefix) {
  ['g','m','s'].forEach(k => {
    const el = document.getElementById(idPrefix + '-' + k);
    if (el) el.value = '';
  });
}

// ─── Fórmulas base ───────────────────────────────
function calcDH(DI, ZC_deg) {
  return DI * Math.sin(toRad(ZC_deg));
}

function calcDZ(DI, ZC_deg, hi, hr) {
  return DI * Math.cos(toRad(ZC_deg)) + hi - hr;
}

// Propagación de azimut:
// Armado en B, ceros en A, lees β a C
// Az(B→C) = Az(A→B) + 180° − β
function propagarAzimut(azPrev, beta_deg) {
  return norm360(azPrev + 180 - beta_deg);
}

function calcDeltaN(DH, Az_deg) {
  return DH * Math.cos(toRad(Az_deg));
}

function calcDeltaE(DH, Az_deg) {
  return DH * Math.sin(toRad(Az_deg));
}

// ─── Cálculo completo de poligonal ───────────────
function computePoligonal(points, azInicial, polyType, toleranciaK) {
  let az = azInicial;
  let N = 0, E = 0, Z = 0;
  const results = [];
  let totalLen = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const DH = calcDH(p.DI, p.ZC);
    const DZ = calcDZ(p.DI, p.ZC, p.hi, p.hr);

    // El azimut del primer tramo es el azimut inicial
    // Los siguientes se propagan con la fórmula
    if (i === 0) {
      az = azInicial;
    } else {
      az = propagarAzimut(results[i - 1].az, p.beta);
    }

    const dN = calcDeltaN(DH, az);
    const dE = calcDeltaE(DH, az);
    N += dN;
    E += dE;
    Z += DZ;
    totalLen += DH;

    results.push({ ...p, DH, DZ, az, dN, dE, N_acum: N, E_acum: E, Z_acum: Z });
  }

  // ── Errores de cierre ──
  const errN = N;  // para cerrada debe ser 0
  const errE = E;
  const errZ = Z;
  const errLineal = Math.sqrt(errN * errN + errE * errE);
  const perimetro = totalLen;
  const precision = (perimetro > 0 && errLineal > 0.0001)
    ? Math.round(perimetro / errLineal)
    : 999999;

  // ── Cierre angular (solo poligonal cerrada) ──
  let errAngular = null;
  let tolAngular = null;
  let cierreAngularOk = null;
  if (polyType === 'cerrada' && points.length >= 3) {
    const n = points.length;
    const sumBeta = points.reduce((acc, p) => acc + p.beta, 0);
    const teorico = (n - 2) * 180;
    errAngular = sumBeta - teorico;
    const K = toleranciaK || 30;
    tolAngular = K * Math.sqrt(n) / 3600; // convertir segundos a grados
    cierreAngularOk = Math.abs(errAngular) <= tolAngular;
  }

  // ── Calidad de precisión ──
  let calidadLineal;
  if (precision >= 5000) calidadLineal = 'excelente';
  else if (precision >= 3000) calidadLineal = 'buena';
  else if (precision >= 1000) calidadLineal = 'regular';
  else calidadLineal = 'mala';

  return {
    results,
    totalLen: perimetro,
    errN, errE, errZ, errLineal, precision,
    errAngular, tolAngular, cierreAngularOk,
    calidadLineal
  };
}

// ─── Ajuste Bowditch (Compass) ────────────────────
// Corrección proporcional a la longitud de cada lado
function ajustarBowditch(computed) {
  const { results, totalLen, errN, errE, errZ } = computed;
  let N = 0, E = 0, Z = 0;
  return results.map(r => {
    const f = r.DH / totalLen;
    const corrN = r.dN - errN * f;
    const corrE = r.dE - errE * f;
    const corrZ = r.DZ - errZ * f;
    N += corrN;
    E += corrE;
    Z += corrZ;
    return { ...r, corrN, corrE, corrZ, N_adj: N, E_adj: E, Z_adj: Z };
  });
}

// ─── Ajuste Tránsito ──────────────────────────────
// Corrección proporcional a la proyección absoluta
function ajustarTransito(computed) {
  const { results, errN, errE, errZ } = computed;
  const sumAbsDN = results.reduce((a, r) => a + Math.abs(r.dN), 0);
  const sumAbsDE = results.reduce((a, r) => a + Math.abs(r.dE), 0);
  const sumAbsDZ = results.reduce((a, r) => a + Math.abs(r.DZ), 0);
  let N = 0, E = 0, Z = 0;
  return results.map(r => {
    const corrN = r.dN - (sumAbsDN > 0 ? errN * Math.abs(r.dN) / sumAbsDN : 0);
    const corrE = r.dE - (sumAbsDE > 0 ? errE * Math.abs(r.dE) / sumAbsDE : 0);
    const corrZ = r.DZ - (sumAbsDZ > 0 ? errZ * Math.abs(r.DZ) / sumAbsDZ : 0);
    N += corrN;
    E += corrE;
    Z += corrZ;
    return { ...r, corrN, corrE, corrZ, N_adj: N, E_adj: E, Z_adj: Z };
  });
}

// ─── Precisión tras ajuste ────────────────────────
function precisionTrasAjuste(adj, totalLen) {
  const last = adj[adj.length - 1];
  const errLin = Math.sqrt(last.N_adj * last.N_adj + last.E_adj * last.E_adj);
  return errLin > 0.0001 ? Math.round(totalLen / errLin) : 999999;
}

// ─── Amarre geodésico ─────────────────────────────
function calcularAmarre(kp1, kp2, coordsRelativas, azInicial) {
  // Azimut real entre los dos puntos conocidos
  const dN = kp2.N - kp1.N;
  const dE = kp2.E - kp1.E;
  const azReal = norm360(toDeg(Math.atan2(dE, dN)));

  // Ángulo de rotación desde azimut arbitrario al real
  const rotAngle = toRad(azReal - azInicial);
  const cosR = Math.cos(rotAngle);
  const sinR = Math.sin(rotAngle);

  // Transformar todas las coordenadas relativas
  const geoCoords = coordsRelativas.map(p => {
    // Rotación
    const N_rot = p.N * cosR - p.E * sinR;
    const E_rot = p.N * sinR + p.E * cosR;
    // Traslación desde kp1
    return {
      name: p.name,
      N: kp1.N + N_rot,
      E: kp1.E + E_rot,
      Z: kp1.Z + p.Z
    };
  });

  return { azReal, geoCoords };
}

// ─── Irradiación ─────────────────────────────────
function calcularIrradiacion(stacion, shot) {
  const { N: stN, E: stE, Z: stZ, hi: stHI, azOrientacion } = stacion;
  const DH = calcDH(shot.DI, shot.ZC);
  const DZ = calcDZ(shot.DI, shot.ZC, stHI, shot.hr);
  // Azimut al punto = orientación + ángulo limbo
  const az = norm360(azOrientacion + shot.beta);
  const N = stN + calcDeltaN(DH, az);
  const E = stE + calcDeltaE(DH, az);
  const Z = stZ + DZ;
  return { DH, DZ, az, N, E, Z };
}


// ═══════════════════════════════════════════════════
//  ESTADO DE LA APP
// ═══════════════════════════════════════════════════

const STORAGE_KEY = 'topofield_v3';

let state = {
  polyName: '',
  polyType: 'cerrada',
  azInicial: 0,
  toleranciaK: 30,
  points: [],
  computed: null,
  adjustedCoords: null,  // { method, coords: [{name,N,E,Z}] }
  geoCoords: null,
  knownPoints: null,
  irradStation: null,
  irradPoints: []
};

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { }
}

function loadState() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) state = { ...state, ...JSON.parse(s) };
  } catch (e) { }
}

// ─── Toast ────────────────────────────────────────
function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}


// ═══════════════════════════════════════════════════
//  NAVEGACIÓN
// ═══════════════════════════════════════════════════

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  document.getElementById('nav-' + id).classList.add('active');
  if (id === 'export') renderExportSummary();
  if (id === 'irradia') renderIrradList();
}


// ═══════════════════════════════════════════════════
//  MÓDULO POLIGONAL
// ═══════════════════════════════════════════════════

function initPoly() {
  const name = document.getElementById('poly-name-input').value.trim() || 'PG-01';
  const type = document.getElementById('poly-type').value;
  const az = readGMS('az-ini');
  const k = parseInt(document.getElementById('tolerancia-k').value) || 30;

  state.polyName = name;
  state.polyType = type;
  state.azInicial = az;
  state.toleranciaK = k;
  if (state.points.length === 0) {
    state.computed = null;
    state.adjustedCoords = null;
    state.geoCoords = null;
  }

  saveState();
  updatePolyBadge();
  document.getElementById('poly-setup-card').style.display = 'none';
  document.getElementById('point-form').style.display = 'block';
  updateStationTitle();
  renderPointsList();

  if (state.computed) {
    renderResults();
  }
}

function resetSetup() {
  if (state.points.length > 0) {
    if (!confirm('¿Volver a la configuración? Los puntos ya ingresados se mantienen.')) return;
  }
  document.getElementById('poly-setup-card').style.display = 'block';
  document.getElementById('point-form').style.display = 'none';
  document.getElementById('poly-name-input').value = state.polyName || '';
  document.getElementById('poly-type').value = state.polyType || 'cerrada';
  document.getElementById('az-inicial').value = state.azInicial || 0;
  document.getElementById('tolerancia-k').value = state.toleranciaK || 30;
}

function updatePolyBadge() {
  const badge = document.getElementById('poly-badge');
  badge.textContent = state.polyName
    ? `${state.polyName} (${state.polyType})`
    : 'Sin poligonal activa';
}

function updateStationTitle() {
  const n = state.points.length;
  const title = document.getElementById('station-title');
  title.textContent = `📍 Estación ${n + 1}`;

  // Autocompletar "DE" con el último destino
  if (n > 0) {
    const last = state.points[n - 1];
    document.getElementById('pt-from').value = last.to;
  }
}

function addPoint() {
  const from = document.getElementById('pt-from').value.trim();
  const to   = document.getElementById('pt-to').value.trim();

  if (!from || !to) { showToast('⚠ Ingresa los nombres DE y punto adelante'); return; }

  // ── Lectura ATRÁS ──
  const DI_b = parseFloat(document.getElementById('pt-di-b').value);
  const ZC_b = readGMS('pt-zc-b');
  const hr_b = parseFloat(document.getElementById('pt-hr-b').value) || 1.5;

  // ── Lectura ADELANTE ──
  const DI   = parseFloat(document.getElementById('pt-di').value);
  const ZC   = readGMS('pt-zc');
  const beta = readGMS('pt-beta');
  const hi   = parseFloat(document.getElementById('pt-hi').value) || 1.5;
  const hr   = parseFloat(document.getElementById('pt-hr').value) || 1.5;

  // Validaciones adelante
  if (isNaN(DI) || DI <= 0) { showToast('⚠ DI adelante inválida'); return; }
  if (isNaN(ZC) || ZC <= 0 || ZC >= 180) { showToast('⚠ Ángulo vertical adelante inválido (0°-180°)'); return; }

  // Validar AH atrás — siempre debe ser 0°00'00"
  const ah_b_deg = readGMS('pt-zc-b'); // AH atrás no existe como campo, se asume 0
  // Verificar que no pusieron nada raro en AH atrás
  // (el campo AH atrás no existe, se omite — la lectura atrás solo tiene ZV y DI)

  // Detectar cierre: si el punto adelante = primer punto de la poligonal
  const esCierre = state.points.length >= 2 &&
    to.trim().toUpperCase() === state.points[0].from.trim().toUpperCase();

  // Verificación distancia ida vs vuelta (si hay punto anterior)
  let diffDH = null, diffDZ = null;
  if (state.points.length > 0 && !isNaN(DI_b) && DI_b > 0 && !isNaN(ZC_b) && ZC_b > 0) {
    const prev = state.points[state.points.length - 1];
    const DH_prev_fwd = calcDH(prev.DI, prev.ZC);
    const DH_back     = calcDH(DI_b, ZC_b);
    const DZ_prev_fwd = calcDZ(prev.DI, prev.ZC, prev.hi, prev.hr);
    const DZ_back     = calcDZ(DI_b, ZC_b, hi, hr_b);
    diffDH = Math.abs(DH_prev_fwd - DH_back);
    diffDZ = Math.abs(DZ_prev_fwd + DZ_back); // suma porque sentidos opuestos
  }

  state.points.push({ from, to, DI, ZC, beta, hi, hr, DI_b, ZC_b, hr_b, diffDH, diffDZ, esCierre });
  state.computed = null;
  state.adjustedCoords = null;
  saveState();

  // Limpiar campos
  document.getElementById('pt-to').value = '';
  document.getElementById('pt-di-b').value = '';
  clearGMS('pt-zc-b');
  document.getElementById('pt-hr-b').value = '1.500';
  document.getElementById('pt-di').value = '';
  clearGMS('pt-zc');
  clearGMS('pt-beta');
  document.getElementById('pt-hr').value = '1.500';

  updateStationTitle();
  renderPointsList();

  // Mostrar diferencias si las hay
  if (diffDH !== null) {
    const clrDH = diffDH > 0.05 ? '⚠' : '✓';
    const clrDZ = diffDZ > 0.05 ? '⚠' : '✓';
    showToast(`${clrDH} ΔDH=${fmt(diffDH,3)}m  ${clrDZ} ΔCota=${fmt(diffDZ,3)}m`, 4000);
  } else {
    showToast(`✓ Estación ${from}→${to} agregada`);
  }

  // Si es cierre, calcular automáticamente
  if (esCierre) {
    setTimeout(() => {
      showToast('🔒 Cierre detectado — calculando poligonal...', 2500);
      setTimeout(closePoly, 1500);
    }, 500);
  } else {
    document.getElementById('pt-to').focus();
  }
}

function removePoint(i) {
  if (!confirm(`¿Eliminar estación ${state.points[i].from}→${state.points[i].to}?`)) return;
  state.points.splice(i, 1);
  state.computed = null;
  state.adjustedCoords = null;
  saveState();
  renderPointsList();
  updateStationTitle();
  document.getElementById('results-section').style.display = 'none';
}

function openEdit(i) {
  const p = state.points[i];
  document.getElementById('edit-idx').value = i;
  document.getElementById('edit-from').value = p.from;
  document.getElementById('edit-to').value = p.to;
  document.getElementById('edit-hi').value = p.hi;
  // Atrás
  document.getElementById('edit-di-b').value = p.DI_b || '';
  if (p.ZC_b) writeGMS('edit-zc-b', p.ZC_b); else clearGMS('edit-zc-b');
  document.getElementById('edit-hr-b').value = p.hr_b || 1.5;
  // Adelante
  document.getElementById('edit-di').value = p.DI;
  writeGMS('edit-zc', p.ZC);
  writeGMS('edit-beta', p.beta);
  document.getElementById('edit-hr').value = p.hr;
  document.getElementById('edit-modal').style.display = 'block';
}

function closeEdit() {
  document.getElementById('edit-modal').style.display = 'none';
}

function saveEdit() {
  const i    = parseInt(document.getElementById('edit-idx').value);
  const from = document.getElementById('edit-from').value.trim();
  const to   = document.getElementById('edit-to').value.trim();
  const hi   = parseFloat(document.getElementById('edit-hi').value) || 1.5;
  const DI_b = parseFloat(document.getElementById('edit-di-b').value);
  const ZC_b = readGMS('edit-zc-b');
  const hr_b = parseFloat(document.getElementById('edit-hr-b').value) || 1.5;
  const DI   = parseFloat(document.getElementById('edit-di').value);
  const ZC   = readGMS('edit-zc');
  const beta = readGMS('edit-beta');
  const hr   = parseFloat(document.getElementById('edit-hr').value) || 1.5;

  if (!from || !to) { showToast('⚠ Nombre DE y adelante requeridos'); return; }
  if (isNaN(DI) || DI <= 0) { showToast('⚠ DI adelante inválida'); return; }
  if (isNaN(ZC) || ZC <= 0 || ZC >= 180) { showToast('⚠ AV adelante inválido'); return; }

  // Recalcular verificación
  let diffDH = null, diffDZ = null;
  if (i > 0 && !isNaN(DI_b) && DI_b > 0 && !isNaN(ZC_b) && ZC_b > 0) {
    const prev = state.points[i - 1];
    const DH_prev_fwd = calcDH(prev.DI, prev.ZC);
    const DH_back     = calcDH(DI_b, ZC_b);
    const DZ_prev_fwd = calcDZ(prev.DI, prev.ZC, prev.hi, prev.hr);
    const DZ_back     = calcDZ(DI_b, ZC_b, hi, hr_b);
    diffDH = Math.abs(DH_prev_fwd - DH_back);
    diffDZ = Math.abs(DZ_prev_fwd + DZ_back);
  }

  const esCierre = i >= 2 && to.trim().toUpperCase() === state.points[0].from.trim().toUpperCase();
  state.points[i] = { from, to, DI, ZC, beta, hi, hr, DI_b, ZC_b, hr_b, diffDH, diffDZ, esCierre };
  state.computed = null;
  state.adjustedCoords = null;
  saveState();
  closeEdit();
  renderPointsList();
  showToast('✓ Estación actualizada');
}

function closePoly() {
  if (state.points.length < 2) {
    showToast('⚠ Necesitas al menos 2 puntos para calcular');
    return;
  }
  state.computed = computePoligonal(
    state.points,
    state.azInicial,
    state.polyType,
    state.toleranciaK
  );
  saveState();
  renderResults();
  // Scroll a resultados
  setTimeout(() => {
    document.getElementById('results-section').scrollIntoView({ behavior: 'smooth' });
  }, 100);
}

function renderPointsList() {
  const section = document.getElementById('points-section');
  const list = document.getElementById('points-list');
  if (state.points.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  list.innerHTML = state.points.map((p, i) => {
    // Semáforo de verificación
    let verif = '';
    if (p.diffDH !== null && p.diffDH !== undefined) {
      const okDH = p.diffDH <= 0.05;
      const okDZ = p.diffDZ <= 0.05;
      verif = `<div class="pt-sub" style="color:${okDH && okDZ ? 'var(--success)' : 'var(--warn)'}">
        ${okDH ? '✓' : '⚠'} ΔDH=${fmt(p.diffDH,3)}m &nbsp;|&nbsp; ${okDZ ? '✓' : '⚠'} ΔCota=${fmt(p.diffDZ,3)}m
      </div>`;
    }
    const cierreTag = p.esCierre ? `<span style="font-size:9px;color:var(--success);margin-left:6px">🔒CIERRE</span>` : '';
    return `
    <div class="pt-item">
      <div class="pt-num">${i + 1}</div>
      <div style="flex:1; min-width:0">
        <div class="pt-name">${p.from} → ${p.to}${cierreTag}</div>
        <div class="pt-sub">
          🎯 DI=${fmt(p.DI,3)}m &nbsp;|&nbsp; AV=${fmtGMS(p.ZC)} &nbsp;|&nbsp; AH=${fmtGMS(p.beta)}<br>
          hi=${fmt(p.hi,3)}m &nbsp;|&nbsp; hr=${fmt(p.hr,3)}m
        </div>
        ${p.DI_b ? `<div class="pt-sub" style="color:var(--text3)">📡 DI_atrás=${fmt(p.DI_b,3)}m &nbsp;|&nbsp; AV=${fmtGMS(p.ZC_b)}</div>` : ''}
        ${verif}
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
        <button class="del-btn" style="color:var(--accent);font-size:13px" onclick="openEdit(${i})" title="Editar">✏</button>
        <button class="del-btn" onclick="removePoint(${i})" title="Eliminar">✕</button>
      </div>
    </div>`;
  }).join('');
}

function renderResults() {
  const section = document.getElementById('results-section');
  const content = document.getElementById('results-content');
  if (!state.computed) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  const c = state.computed;
  const prec = c.precision;

  let precClass = 'prec-bad';
  let precIcon = '✗';
  if (prec >= 5000) { precClass = 'prec-good'; precIcon = '✓'; }
  else if (prec >= 3000) { precClass = 'prec-good'; precIcon = '✓'; }
  else if (prec >= 1000) { precClass = 'prec-warn'; precIcon = '~'; }

  const precLabel = prec >= 999990 ? '∞ (perfecto)' : `1 / ${prec.toLocaleString()}`;
  const calidadLabel = { excelente: 'EXCELENTE', buena: 'BUENA', regular: 'REGULAR', mala: 'INSUFICIENTE' }[c.calidadLineal] || '';

  content.innerHTML = `
    <div class="tc" style="margin-bottom:14px">
      <div class="prec-badge ${precClass}">${precIcon} Precisión ${precLabel} — ${calidadLabel}</div>
    </div>

    <div class="stat-row">
      <span class="stat-label">Perímetro total</span>
      <span class="stat-val">${fmt(c.totalLen, 3)} m</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Error cierre N</span>
      <span class="stat-val">${fmt(c.errN, 4)} m</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Error cierre E</span>
      <span class="stat-val">${fmt(c.errE, 4)} m</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Error lineal total</span>
      <span class="stat-val">${fmt(c.errLineal, 4)} m</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Error altimétrico (ΔZ)</span>
      <span class="stat-val">${fmt(c.errZ, 4)} m</span>
    </div>
    ${c.errAngular !== null ? `
    <div class="stat-row">
      <span class="stat-label">Error angular</span>
      <span class="stat-val" style="color:${c.cierreAngularOk ? 'var(--success)' : 'var(--danger)'}">
        ${fmtDeg(c.errAngular)} ${c.cierreAngularOk ? '✓' : '✗'}
      </span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Tolerancia angular (K√n)</span>
      <span class="stat-val">${fmtDeg(c.tolAngular)}</span>
    </div>
    ` : ''}

    <div class="sep"></div>
    <div class="card-title" style="font-size:9px; color:var(--text3); margin-bottom:8px">TABLA DE AZIMUTES Y DISTANCIAS</div>
    <div style="overflow-x:auto">
      <table class="tbl">
        <thead>
          <tr>
            <th>Tramo</th>
            <th>Az (°)</th>
            <th>DH (m)</th>
            <th>ΔN (m)</th>
            <th>ΔE (m)</th>
            <th>ΔZ (m)</th>
          </tr>
        </thead>
        <tbody>
          ${c.results.map(r => `
            <tr>
              <td>${r.from}→${r.to}</td>
              <td class="num">${fmtGMS(r.az)}</td>
              <td class="num">${fmt(r.DH, 3)}</td>
              <td class="num">${fmt(r.dN, 3)}</td>
              <td class="num">${fmt(r.dE, 3)}</td>
              <td class="num">${fmt(r.DZ, 3)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Sección ajuste
  const adjSection = document.getElementById('adjustment-section');
  const adjContent = document.getElementById('adjustment-content');

  if (c.calidadLineal === 'mala' || c.calidadLineal === 'regular') {
    adjSection.style.display = 'block';
    const bow = ajustarBowditch(c);
    const tra = ajustarTransito(c);
    const precBow = precisionTrasAjuste(bow, c.totalLen);
    const precTra = precisionTrasAjuste(tra, c.totalLen);

    adjContent.innerHTML = `
      <div class="alert alert-warn">
        Precisión insuficiente. Aplica un método de ajuste para compensar el error de cierre.
      </div>
      <div class="stat-row">
        <span class="stat-label">Bowditch (proporcional a longitud)</span>
        <span class="stat-val">1/${precBow > 99999 ? '∞' : precBow.toLocaleString()}</span>
      </div>
      <div class="stat-row" style="margin-bottom:12px">
        <span class="stat-label">Tránsito (proporcional a proyección)</span>
        <span class="stat-val">1/${precTra > 99999 ? '∞' : precTra.toLocaleString()}</span>
      </div>
      <div class="row-btns">
        <button class="btn btn-success btn-sm" onclick="applyAdjustment('bowditch')">APLICAR BOWDITCH</button>
        <button class="btn btn-warn btn-sm" onclick="applyAdjustment('transito')">APLICAR TRÁNSITO</button>
      </div>
    `;
  } else {
    adjSection.style.display = 'none';
    // Precisión buena: mostrar coordenadas ajustadas con Bowditch automáticamente
    const bow = ajustarBowditch(c);
    applyAdjustmentData('bowditch', bow);
  }
}

function applyAdjustment(method) {
  if (!state.computed) return;
  const adj = method === 'bowditch'
    ? ajustarBowditch(state.computed)
    : ajustarTransito(state.computed);
  applyAdjustmentData(method, adj);
  showToast(`✓ Ajuste ${method === 'bowditch' ? 'Bowditch' : 'Tránsito'} aplicado`);
}

function applyAdjustmentData(method, adj) {
  state.adjustedCoords = {
    method,
    coords: adj.map(r => ({ name: r.to, N: r.N_adj, E: r.E_adj, Z: r.Z_adj }))
  };
  saveState();
  renderCoordsSection(adj);
}

function renderCoordsSection(adj) {
  const section = document.getElementById('coords-section');
  const content = document.getElementById('coords-content');
  section.style.display = 'block';
  content.innerHTML = adj.map(r => `
    <div class="coord-box">
      <div class="coord-name">
        <span>${r.to}</span>
        <span style="font-size:9px; color:var(--text3); font-weight:400">${r.from}→${r.to}</span>
      </div>
      <div class="coord-vals">
        <div class="coord-val"><div class="lbl">N (m)</div><div class="num">${fmt(r.N_adj, 3)}</div></div>
        <div class="coord-val"><div class="lbl">E (m)</div><div class="num">${fmt(r.E_adj, 3)}</div></div>
        <div class="coord-val"><div class="lbl">Z (m)</div><div class="num">${fmt(r.Z_adj, 3)}</div></div>
      </div>
    </div>
  `).join('');
}


// ═══════════════════════════════════════════════════
//  MÓDULO AMARRE GEODÉSICO
// ═══════════════════════════════════════════════════

function calcAmarre() {
  const kp1 = {
    name: document.getElementById('kp1-name').value.trim() || 'P1',
    N: parseFloat(document.getElementById('kp1-n').value),
    E: parseFloat(document.getElementById('kp1-e').value),
    Z: parseFloat(document.getElementById('kp1-z').value)
  };
  const kp2 = {
    name: document.getElementById('kp2-name').value.trim() || 'P2',
    N: parseFloat(document.getElementById('kp2-n').value),
    E: parseFloat(document.getElementById('kp2-e').value),
    Z: parseFloat(document.getElementById('kp2-z').value)
  };

  if ([kp1.N, kp1.E, kp1.Z, kp2.N, kp2.E, kp2.Z].some(isNaN)) {
    showToast('⚠ Completa todas las coordenadas de los dos puntos');
    return;
  }
  if (!state.adjustedCoords || state.adjustedCoords.coords.length === 0) {
    showToast('⚠ Primero calcula y ajusta la poligonal');
    return;
  }

  const { azReal, geoCoords } = calcularAmarre(kp1, kp2, state.adjustedCoords.coords, state.azInicial);

  state.knownPoints = { kp1, kp2 };
  state.geoCoords = geoCoords;
  saveState();

  const res = document.getElementById('amarre-results');
  res.innerHTML = `
    <div class="card">
      <div class="card-title">📡 Resultado del amarre</div>
      <div class="stat-row">
        <span class="stat-label">Az real ${kp1.name} → ${kp2.name}</span>
        <span class="stat-val">${fmtDeg(azReal)}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Distancia entre puntos conocidos</span>
        <span class="stat-val">${fmt(Math.sqrt(Math.pow(kp2.N - kp1.N, 2) + Math.pow(kp2.E - kp1.E, 2)), 3)} m</span>
      </div>
      <div class="sep"></div>
      <div class="card-title" style="color:var(--accent2); font-size:9px">COORDENADAS ABSOLUTAS DE LA POLIGONAL</div>
      ${geoCoords.map(p => `
        <div class="coord-box">
          <div class="coord-name">${p.name}</div>
          <div class="coord-vals">
            <div class="coord-val"><div class="lbl">N (m)</div><div class="num">${fmt(p.N, 3)}</div></div>
            <div class="coord-val"><div class="lbl">E (m)</div><div class="num">${fmt(p.E, 3)}</div></div>
            <div class="coord-val"><div class="lbl">Z (m)</div><div class="num">${fmt(p.Z, 3)}</div></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  showToast('✓ Amarre calculado');
}


// ═══════════════════════════════════════════════════
//  MÓDULO IRRADIACIÓN
// ═══════════════════════════════════════════════════

function saveStation() {
  const stName = document.getElementById('ir-st-name').value.trim() || 'ST';
  const N  = parseFloat(document.getElementById('ir-n').value);
  const E  = parseFloat(document.getElementById('ir-e').value);
  const Z  = parseFloat(document.getElementById('ir-z').value);
  const hi = parseFloat(document.getElementById('ir-hi').value) || 1.5;

  const visName = document.getElementById('ir-vis-name').value.trim() || 'VIS';
  const visN = parseFloat(document.getElementById('ir-vis-n').value);
  const visE = parseFloat(document.getElementById('ir-vis-e').value);

  if ([N, E, Z].some(isNaN)) { showToast('⚠ Ingresa las coordenadas de la estación'); return; }
  if (isNaN(visN) || isNaN(visE)) { showToast('⚠ Ingresa N y E del punto visado'); return; }

  // Azimut real estación → visado (orientación automática)
  const dN = visN - N;
  const dE = visE - E;
  const azOrientacion = norm360(toDeg(Math.atan2(dE, dN)));

  state.irradStation = { name: stName, N, E, Z, hi, azOrientacion, visName, visN, visE };
  saveState();

  // Mostrar azimut calculado
  const disp = document.getElementById('ir-az-display');
  disp.style.display = 'block';
  disp.textContent = `✓ Orientación ${stName} → ${visName}: Az = ${fmt(azOrientacion, 4)}°`;

  // Mostrar formulario de shots
  document.getElementById('ir-shot-card').style.display = 'block';
  showToast('✓ Estación guardada — azimut calculado');
  document.getElementById('ir-pname').focus();
}

function addIrradPoint() {
  if (!state.irradStation) {
    showToast('⚠ Guarda primero la estación y el punto visado');
    return;
  }

  const pname = document.getElementById('ir-pname').value.trim() || ('PT-' + (state.irradPoints.length + 1));
  const desc = document.getElementById('ir-desc').value.trim();
  const DI = parseFloat(document.getElementById('ir-di').value);
  const ZC = readGMS('ir-zc');
  const beta = readGMS('ir-beta');
  const hr = parseFloat(document.getElementById('ir-hr').value) || 1.5;

  if (isNaN(DI) || DI <= 0) { showToast('⚠ Distancia inclinada inválida'); return; }
  if (isNaN(ZC) || ZC <= 0 || ZC >= 180) { showToast('⚠ Ángulo vertical inválido'); return; }

  const result = calcularIrradiacion(state.irradStation, { DI, ZC, beta, hr });
  state.irradPoints.push({ name: pname, desc, DI, ZC, beta, hr, ...result });
  saveState();

  document.getElementById('ir-pname').value = '';
  document.getElementById('ir-desc').value = '';
  document.getElementById('ir-di').value = '';
  clearGMS('ir-zc');
  clearGMS('ir-beta');

  renderIrradList();
  showToast(`✓ ${pname} calculado y guardado`);
  document.getElementById('ir-pname').focus();
}

function removeIrrad(i) {
  state.irradPoints.splice(i, 1);
  saveState();
  renderIrradList();
}

function renderIrradList() {
  const div = document.getElementById('irrad-list');
  if (!state.irradPoints || state.irradPoints.length === 0) {
    div.innerHTML = '';
    return;
  }
  div.innerHTML = `
    <div class="section-title">PUNTOS CALCULADOS (${state.irradPoints.length})</div>
    <div class="card" style="padding:8px 14px">
      ${state.irradPoints.map((p, i) => `
        <div class="coord-box" style="margin-bottom:6px">
          <div class="coord-name">
            <span>${p.name} <span style="font-size:9px; color:var(--text3); font-weight:400">${p.desc || ''}</span></span>
            <button class="del-btn" onclick="removeIrrad(${i})" title="Eliminar">✕</button>
          </div>
          <div class="coord-vals">
            <div class="coord-val"><div class="lbl">N (m)</div><div class="num">${fmt(p.N, 3)}</div></div>
            <div class="coord-val"><div class="lbl">E (m)</div><div class="num">${fmt(p.E, 3)}</div></div>
            <div class="coord-val"><div class="lbl">Z (m)</div><div class="num">${fmt(p.Z, 3)}</div></div>
          </div>
          <div style="font-size:9px; color:var(--text3); margin-top:5px">
            Az=${fmtGMS(p.az)} &nbsp;|&nbsp; DH=${fmt(p.DH, 3)}m
          </div>
        </div>
      `).join('')}
    </div>
  `;
}


// ═══════════════════════════════════════════════════
//  EXPORTAR
// ═══════════════════════════════════════════════════

function renderExportSummary() {
  const div = document.getElementById('export-summary');
  const c = state.computed;
  div.innerHTML = `
    <div class="stat-row"><span class="stat-label">Poligonal</span><span class="stat-val">${state.polyName || '—'} (${state.polyType})</span></div>
    <div class="stat-row"><span class="stat-label">Puntos ingresados</span><span class="stat-val">${state.points.length}</span></div>
    <div class="stat-row"><span class="stat-label">Precisión</span><span class="stat-val">${c ? '1/' + c.precision.toLocaleString() : '—'}</span></div>
    <div class="stat-row"><span class="stat-label">Ajuste aplicado</span><span class="stat-val">${state.adjustedCoords ? state.adjustedCoords.method : '—'}</span></div>
    <div class="stat-row"><span class="stat-label">Amarre geodésico</span><span class="stat-val">${state.knownPoints ? '✓ Aplicado' : 'No'}</span></div>
    <div class="stat-row"><span class="stat-label">Puntos de detalle</span><span class="stat-val">${state.irradPoints.length}</span></div>
  `;
}

function downloadCSV(content, filename) {
  const BOM = '\uFEFF'; // Para compatibilidad con Excel (caracteres especiales)
  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCSV(type) {
  const prefix = state.polyName || 'topofield';
  let csv = '';

  if (type === 'observaciones' || type === 'todo') {
    if (!state.computed) { showToast('⚠ No hay poligonal calculada'); if (type !== 'todo') return; }
    else {
      csv += type === 'todo' ? `OBSERVACIONES POLIGONAL - ${prefix}\n` : '';
      csv += 'Punto_DE,Punto_A,DI_m,ZC_deg,Beta_deg,hi_m,hr_m,DH_m,DZ_m,Az_deg,dN_m,dE_m,N_acum_m,E_acum_m,Z_acum_m\n';
      csv += state.computed.results.map(r =>
        `${r.from},${r.to},${fmt(r.DI,4)},${fmt(r.ZC,4)},${fmt(r.beta,4)},${fmt(r.hi,4)},${fmt(r.hr,4)},${fmt(r.DH,4)},${fmt(r.DZ,4)},${fmt(r.az,4)},${fmt(r.dN,4)},${fmt(r.dE,4)},${fmt(r.N_acum,4)},${fmt(r.E_acum,4)},${fmt(r.Z_acum,4)}`
      ).join('\n');
      if (type !== 'todo') { downloadCSV(csv, `${prefix}_observaciones.csv`); showToast('✓ CSV exportado'); return; }
      csv += '\n\n';
    }
  }

  if (type === 'coordenadas' || type === 'todo') {
    const coords = state.geoCoords || (state.adjustedCoords ? state.adjustedCoords.coords : null);
    if (!coords) { showToast('⚠ No hay coordenadas calculadas'); if (type !== 'todo') return; }
    else {
      csv += type === 'todo' ? `COORDENADAS - ${prefix}\n` : '';
      csv += 'Punto,N_m,E_m,Z_m,Tipo\n';
      csv += coords.map(p => {
        const tipo = state.geoCoords ? 'absoluta' : 'relativa';
        return `${p.name},${fmt(p.N,4)},${fmt(p.E,4)},${fmt(p.Z,4)},${tipo}`;
      }).join('\n');
      if (type !== 'todo') { downloadCSV(csv, `${prefix}_coordenadas.csv`); showToast('✓ CSV exportado'); return; }
      csv += '\n\n';
    }
  }

  if (type === 'irradiacion' || type === 'todo') {
    if (!state.irradPoints || state.irradPoints.length === 0) {
      showToast('⚠ No hay puntos de irradiación');
      if (type !== 'todo') return;
    } else {
      csv += type === 'todo' ? `IRRADIACIÓN - ${prefix}\n` : '';
      csv += 'Nombre,Descripcion,N_m,E_m,Z_m,Az_deg,DH_m,DI_m,ZC_deg,Beta_deg,hr_m\n';
      csv += state.irradPoints.map(p =>
        `${p.name},${p.desc || ''},${fmt(p.N,4)},${fmt(p.E,4)},${fmt(p.Z,4)},${fmt(p.az,4)},${fmt(p.DH,4)},${fmt(p.DI,4)},${fmt(p.ZC,4)},${fmt(p.beta,4)},${fmt(p.hr,4)}`
      ).join('\n');
      if (type !== 'todo') { downloadCSV(csv, `${prefix}_irradiacion.csv`); showToast('✓ CSV exportado'); return; }
    }
  }

  if (type === 'todo' && csv) {
    downloadCSV(csv, `${prefix}_completo.csv`);
    showToast('✓ Archivo completo exportado');
  }
}

function exportJSON() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.polyName || 'topofield'}_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('✓ Backup JSON guardado');
}

function clearAllData() {
  if (!confirm('¿Seguro que deseas borrar TODOS los datos? Esta acción no se puede deshacer.')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = {
    polyName: '', polyType: 'cerrada', azInicial: 0, toleranciaK: 30,
    points: [], computed: null, adjustedCoords: null, geoCoords: null,
    knownPoints: null, irradStation: null, irradPoints: []
  };
  showToast('🗑 Datos borrados');
  setTimeout(() => location.reload(), 1000);
}


// ═══════════════════════════════════════════════════
//  INICIALIZACIÓN
// ═══════════════════════════════════════════════════

loadState();
updatePolyBadge();

// Restaurar UI si hay datos guardados
if (state.polyName) {
  document.getElementById('poly-name-input').value = state.polyName;
  document.getElementById('poly-type').value = state.polyType;
  writeGMS('az-ini', state.azInicial || 0);
  document.getElementById('tolerancia-k').value = state.toleranciaK;

  document.getElementById('poly-setup-card').style.display = 'none';
  document.getElementById('point-form').style.display = 'block';
  updateStationTitle();
  renderPointsList();

  if (state.computed) {
    renderResults();
    if (state.adjustedCoords) {
      const adj = state.adjustedCoords.method === 'bowditch'
        ? ajustarBowditch(state.computed)
        : ajustarTransito(state.computed);
      renderCoordsSection(adj);
    }
  }
}

if (state.irradStation) {
  const st = state.irradStation;
  document.getElementById('ir-st-name').value = st.name || '';
  document.getElementById('ir-n').value = st.N;
  document.getElementById('ir-e').value = st.E;
  document.getElementById('ir-z').value = st.Z;
  document.getElementById('ir-hi').value = st.hi;
  document.getElementById('ir-vis-name').value = st.visName || '';
  document.getElementById('ir-vis-n').value = st.visN || '';
  document.getElementById('ir-vis-e').value = st.visE || '';
  const disp = document.getElementById('ir-az-display');
  if (disp) {
    disp.style.display = 'block';
    disp.textContent = '✓ Orientación ' + st.name + ' → ' + st.visName + ': Az = ' + st.azOrientacion.toFixed(4) + '°';
  }
  const shotCard = document.getElementById('ir-shot-card');
  if (shotCard) shotCard.style.display = 'block';
}

if (state.knownPoints) {
  const { kp1, kp2 } = state.knownPoints;
  document.getElementById('kp1-name').value = kp1.name;
  document.getElementById('kp1-n').value = kp1.N;
  document.getElementById('kp1-e').value = kp1.E;
  document.getElementById('kp1-z').value = kp1.Z;
  document.getElementById('kp2-name').value = kp2.name;
  document.getElementById('kp2-n').value = kp2.N;
  document.getElementById('kp2-e').value = kp2.E;
  document.getElementById('kp2-z').value = kp2.Z;
}

renderIrradList();
