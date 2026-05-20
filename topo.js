// ═══════════════════════════════════════════════
//  Poligonal CR — Motor topográfico
//  Convenios:
//   AV cenital: 90°=horizontal, 0°=vertical arriba
//   DH = DI × sin(AV)
//   ΔZ = DI × cos(AV) + hi − hr
//   Az(B→C) = Az(A→B) + 180° − AH
// ═══════════════════════════════════════════════

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
function toRad(d){ return d*DEG }
function toDeg(r){ return r*RAD }
function norm360(a){ return ((a%360)+360)%360 }
function fmt(n,d=4){ return (isNaN(n)||n===null)?'—':Number(n).toFixed(d) }

// ─── GMS ────────────────────────────────────────
function gmsToDecimal(g,m,s){
  g=parseFloat(g)||0; m=parseFloat(m)||0; s=parseFloat(s)||0;
  return g+m/60+s/3600;
}
function decimalToGMS(dec){
  dec=((dec%360)+360)%360;
  const g=Math.floor(dec);
  const mFull=(dec-g)*60;
  const m=Math.floor(mFull);
  const s=Math.round((mFull-m)*60*10)/10;
  return {g,m,s};
}
function fmtGMS(dec){
  if(isNaN(dec)||dec===null) return '—';
  const {g,m,s}=decimalToGMS(dec);
  return `${g}°${String(m).padStart(2,'0')}'${String(s.toFixed(1)).padStart(4,'0')}"`;
}
function readGMS(prefix){
  const g=document.getElementById(prefix+'-g');
  const m=document.getElementById(prefix+'-m');
  const s=document.getElementById(prefix+'-s');
  if(!g) return NaN;
  return gmsToDecimal(g.value,m.value,s.value);
}
function writeGMS(prefix,decimal){
  const {g,m,s}=decimalToGMS(decimal);
  const eg=document.getElementById(prefix+'-g');
  const em=document.getElementById(prefix+'-m');
  const es=document.getElementById(prefix+'-s');
  if(!eg) return;
  eg.value=g; em.value=String(m).padStart(2,'0'); es.value=s.toFixed(1);
}
function clearGMS(prefix){
  ['g','m','s'].forEach(k=>{ const el=document.getElementById(prefix+'-'+k); if(el) el.value=''; });
}

// ─── Fórmulas base ──────────────────────────────
function calcDH(DI,AV){ return DI*Math.sin(toRad(AV)) }
function calcDZ(DI,AV,hi,hr){ return DI*Math.cos(toRad(AV))+hi-hr }
function propagarAz(azPrev,ah){ return norm360(azPrev+180-ah) }
function calcDN(DH,az){ return DH*Math.cos(toRad(az)) }
function calcDE(DH,az){ return DH*Math.sin(toRad(az)) }

// ─── Cálculo poligonal ──────────────────────────
function computePoligonal(points,azInicial,polyType,toleranciaK){
  let az=azInicial, N=0, E=0, Z=0, totalLen=0;
  const results=[];
  for(let i=0;i<points.length;i++){
    const p=points[i];
    const DH=calcDH(p.DI,p.ZC);
    const DZ=calcDZ(p.DI,p.ZC,p.hi,p.hr);
    az = i===0 ? azInicial : propagarAz(results[i-1].az, p.beta);
    const dN=calcDN(DH,az), dE=calcDE(DH,az);
    N+=dN; E+=dE; Z+=DZ; totalLen+=DH;
    results.push({...p,DH,DZ,az,dN,dE,N_acum:N,E_acum:E,Z_acum:Z});
  }
  const errN=N, errE=E, errZ=Z;
  const errLineal=Math.sqrt(errN*errN+errE*errE);
  const precision=totalLen>0&&errLineal>0.0001?Math.round(totalLen/errLineal):999999;
  let errAngular=null,tolAngular=null,cierreAngularOk=null;
  if(polyType==='cerrada'&&points.length>=3){
    const n=points.length;
    const sumBeta=points.reduce((a,p)=>a+p.beta,0);
    errAngular=sumBeta-(n-2)*180;
    tolAngular=(toleranciaK||30)*Math.sqrt(n)/3600;
    cierreAngularOk=Math.abs(errAngular)<=tolAngular;
  }
  let calidadLineal='mala';
  if(precision>=5000) calidadLineal='excelente';
  else if(precision>=3000) calidadLineal='buena';
  else if(precision>=1000) calidadLineal='regular';
  return{results,totalLen,errN,errE,errZ,errLineal,precision,errAngular,tolAngular,cierreAngularOk,calidadLineal};
}

function ajustarBowditch(computed){
  const{results,totalLen,errN,errE,errZ}=computed;
  let N=0,E=0,Z=0;
  return results.map(r=>{
    const f=r.DH/totalLen;
    const corrN=r.dN-errN*f, corrE=r.dE-errE*f, corrZ=r.DZ-errZ*f;
    N+=corrN; E+=corrE; Z+=corrZ;
    return{...r,corrN,corrE,corrZ,N_adj:N,E_adj:E,Z_adj:Z};
  });
}
function ajustarTransito(computed){
  const{results,errN,errE,errZ}=computed;
  const sN=results.reduce((a,r)=>a+Math.abs(r.dN),0);
  const sE=results.reduce((a,r)=>a+Math.abs(r.dE),0);
  const sZ=results.reduce((a,r)=>a+Math.abs(r.DZ),0);
  let N=0,E=0,Z=0;
  return results.map(r=>{
    const corrN=r.dN-(sN>0?errN*Math.abs(r.dN)/sN:0);
    const corrE=r.dE-(sE>0?errE*Math.abs(r.dE)/sE:0);
    const corrZ=r.DZ-(sZ>0?errZ*Math.abs(r.DZ)/sZ:0);
    N+=corrN; E+=corrE; Z+=corrZ;
    return{...r,corrN,corrE,corrZ,N_adj:N,E_adj:E,Z_adj:Z};
  });
}
function precisionTrasAjuste(adj,totalLen){
  const last=adj[adj.length-1];
  const e=Math.sqrt(last.N_adj*last.N_adj+last.E_adj*last.E_adj);
  return e>0.0001?Math.round(totalLen/e):999999;
}

// ═══════════════════════════════════════════════
//  GESTIÓN DE PROYECTOS
// ═══════════════════════════════════════════════

const SK_PROYECTOS = 'pcr_proyectos_v1';
const SK_ACTIVO    = 'pcr_activo_v1';

function proyectoVacio(nombre, tipo){
  return {
    id: Date.now().toString(36)+Math.random().toString(36).slice(2),
    nombre, tipo,
    fechaCreacion: new Date().toLocaleDateString('es-CO'),
    fechaModificacion: new Date().toLocaleDateString('es-CO'),
    // Poligonal
    azInicial:0, toleranciaK:30,
    points:[], computed:null, adjustedCoords:null,
    // Amarre
    geoCoords:null, knownPoints:null,
    // Irradiación
    irradStation:null, irradPoints:[]
  };
}

function cargarProyectos(){
  try{ return JSON.parse(localStorage.getItem(SK_PROYECTOS)||'[]'); }catch(e){ return []; }
}
function guardarProyectos(lista){
  try{ localStorage.setItem(SK_PROYECTOS, JSON.stringify(lista)); }catch(e){}
}
function cargarIdActivo(){
  return localStorage.getItem(SK_ACTIVO)||null;
}
function guardarIdActivo(id){
  if(id) localStorage.setItem(SK_ACTIVO,id);
  else localStorage.removeItem(SK_ACTIVO);
}

// Proyecto actualmente abierto en memoria
let proyecto = null;

function guardarProyectoActual(){
  if(!proyecto) return;
  proyecto.fechaModificacion = new Date().toLocaleDateString('es-CO');
  const lista = cargarProyectos();
  const idx = lista.findIndex(p=>p.id===proyecto.id);
  if(idx>=0) lista[idx]=proyecto;
  else lista.push(proyecto);
  guardarProyectos(lista);
}

// ─── Toast ──────────────────────────────────────
function showToast(msg,duration=2500){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),duration);
}

// ─── Navegación ─────────────────────────────────
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('screen-'+id).classList.add('active');
  const nb=document.getElementById('nav-'+id);
  if(nb) nb.classList.add('active');
  if(id==='export') renderExportSummary();
  if(id==='irradia') renderIrradList();
  if(id==='proyectos'){
    document.getElementById('main-nav').style.display='none';
    document.getElementById('btn-volver').style.display='none';
    renderProyectos();
  } else {
    document.getElementById('main-nav').style.display='flex';
    document.getElementById('btn-volver').style.display='inline-block';
  }
}

// ═══════════════════════════════════════════════
//  PANTALLA DE PROYECTOS
// ═══════════════════════════════════════════════

function renderProyectos(){
  const lista=cargarProyectos();
  const div=document.getElementById('proyectos-lista');
  if(lista.length===0){
    div.innerHTML=`<div class="empty-state"><div class="empty-icon">📐</div>No hay poligonales guardadas.<br>Toca <strong>+ NUEVA</strong> para empezar.</div>`;
    return;
  }
  div.innerHTML=lista.slice().reverse().map(p=>{
    const nPts=p.points?p.points.length:0;
    const prec=p.computed?'1/'+p.computed.precision.toLocaleString():'—';
    const estado=p.computed?'completada':'en_progreso';
    const estadoLabel=estado==='completada'?'✓ Completada':'⏳ En progreso';
    const estadoClass=estado==='completada'?'status-done':'status-prog';
    return `
    <div class="proj-card" onclick="abrirProyecto('${p.id}')">
      <div class="proj-card-header">
        <div>
          <div class="proj-card-name">${p.nombre}</div>
          <div class="proj-card-type">${p.tipo} · ${p.fechaModificacion}</div>
        </div>
        <button class="proj-del-btn" onclick="event.stopPropagation();eliminarProyecto('${p.id}')">🗑</button>
      </div>
      <div class="proj-card-stats">
        <div class="proj-stat"><div class="lbl">ESTACIONES</div><div class="val">${nPts}</div></div>
        <div class="proj-stat"><div class="lbl">PRECISIÓN</div><div class="val">${prec}</div></div>
        <div class="proj-stat"><div class="lbl">IRRADIA</div><div class="val">${p.irradPoints?p.irradPoints.length:0}</div></div>
      </div>
      <div class="proj-card-footer">
        <span class="proj-status ${estadoClass}">${estadoLabel}</span>
        <span class="proj-date">Mod: ${p.fechaModificacion}</span>
      </div>
    </div>`;
  }).join('');
}

function abrirNuevoProyecto(){
  document.getElementById('nuevo-nombre').value='';
  document.getElementById('nuevo-tipo').value='cerrada';
  document.getElementById('nuevo-modal').classList.add('open');
  setTimeout(()=>document.getElementById('nuevo-nombre').focus(),100);
}
function cerrarNuevoModal(){
  document.getElementById('nuevo-modal').classList.remove('open');
}
function crearProyecto(){
  const nombre=document.getElementById('nuevo-nombre').value.trim();
  const tipo=document.getElementById('nuevo-tipo').value;
  if(!nombre){ showToast('⚠ Ingresa un nombre'); return; }
  proyecto=proyectoVacio(nombre,tipo);
  guardarProyectoActual();
  guardarIdActivo(proyecto.id);
  cerrarNuevoModal();
  cargarUIProyecto();
  showScreen('poly');
}
function abrirProyecto(id){
  const lista=cargarProyectos();
  const p=lista.find(x=>x.id===id);
  if(!p){ showToast('⚠ Proyecto no encontrado'); return; }
  proyecto=p;
  guardarIdActivo(id);
  cargarUIProyecto();
  showScreen('poly');
}
function eliminarProyecto(id){
  if(!confirm('¿Eliminar esta poligonal? No se puede deshacer.')) return;
  let lista=cargarProyectos();
  lista=lista.filter(p=>p.id!==id);
  guardarProyectos(lista);
  if(proyecto&&proyecto.id===id){ proyecto=null; guardarIdActivo(null); }
  renderProyectos();
  showToast('🗑 Proyecto eliminado');
}
function eliminarProyectoActual(){
  if(!proyecto){ showToast('⚠ No hay proyecto activo'); return; }
  eliminarProyecto(proyecto.id);
  volverAProyectos();
}
function volverAProyectos(){
  proyecto=null;
  guardarIdActivo(null);
  showScreen('proyectos');
}

function cargarUIProyecto(){
  if(!proyecto) return;
  // Badge
  document.getElementById('proj-badge').textContent=proyecto.nombre+' ('+proyecto.tipo+')';
  document.getElementById('btn-volver').style.display='inline-block';
  // Setup form
  document.getElementById('poly-name-input').value=proyecto.nombre;
  document.getElementById('poly-type').value=proyecto.tipo;
  writeGMS('az-ini',proyecto.azInicial||0);
  document.getElementById('tolerancia-k').value=proyecto.toleranciaK||30;

  if(proyecto.points&&proyecto.points.length>0){
    document.getElementById('poly-setup-card').style.display='none';
    document.getElementById('point-form').style.display='block';
    updateStationTitle();
    renderPointsList();
    if(proyecto.computed) renderResults();
    if(proyecto.adjustedCoords){
      const adj=proyecto.adjustedCoords.method==='bowditch'
        ?ajustarBowditch(proyecto.computed)
        :ajustarTransito(proyecto.computed);
      renderCoordsSection(adj);
    }
  } else {
    document.getElementById('poly-setup-card').style.display='block';
    document.getElementById('point-form').style.display='none';
  }

  // Amarre
  if(proyecto.knownPoints){
    const{kp1,kp2}=proyecto.knownPoints;
    document.getElementById('kp1-name').value=kp1.name;
    document.getElementById('kp1-n').value=kp1.N;
    document.getElementById('kp1-e').value=kp1.E;
    document.getElementById('kp1-z').value=kp1.Z;
    document.getElementById('kp2-name').value=kp2.name;
    document.getElementById('kp2-n').value=kp2.N;
    document.getElementById('kp2-e').value=kp2.E;
    document.getElementById('kp2-z').value=kp2.Z;
    if(proyecto.geoCoords) renderAmarreResults();
  }

  // Irradiación
  if(proyecto.irradStation){
    const st=proyecto.irradStation;
    document.getElementById('ir-st-name').value=st.name||'';
    document.getElementById('ir-n').value=st.N;
    document.getElementById('ir-e').value=st.E;
    document.getElementById('ir-z').value=st.Z;
    document.getElementById('ir-hi').value=st.hi;
    document.getElementById('ir-vis-name').value=st.visName||'';
    document.getElementById('ir-vis-n').value=st.visN||'';
    document.getElementById('ir-vis-e').value=st.visE||'';
    const disp=document.getElementById('ir-az-display');
    disp.style.display='block';
    disp.textContent=`✓ Az ${st.name}→${st.visName}: ${fmtGMS(st.azOrientacion)}`;
    document.getElementById('ir-shot-card').style.display='block';
  }
}

// ═══════════════════════════════════════════════
//  MÓDULO POLIGONAL
// ═══════════════════════════════════════════════

function iniciarPoly(){
  if(!proyecto){ showToast('⚠ Selecciona o crea un proyecto'); return; }
  proyecto.nombre=document.getElementById('poly-name-input').value.trim()||proyecto.nombre;
  proyecto.tipo=document.getElementById('poly-type').value;
  proyecto.azInicial=readGMS('az-ini');
  proyecto.toleranciaK=parseInt(document.getElementById('tolerancia-k').value)||30;
  guardarProyectoActual();
  document.getElementById('proj-badge').textContent=proyecto.nombre+' ('+proyecto.tipo+')';
  document.getElementById('poly-setup-card').style.display='none';
  document.getElementById('point-form').style.display='block';
  updateStationTitle();
}

function resetSetup(){
  document.getElementById('poly-setup-card').style.display='block';
  document.getElementById('point-form').style.display='none';
}

function updateStationTitle(){
  if(!proyecto) return;
  const n=proyecto.points.length;
  document.getElementById('station-title').textContent=`📍 Estación ${n+1}`;
  if(n>0){
    const last=proyecto.points[n-1];
    document.getElementById('pt-from').value=last.to;
  }
}

function addPoint(){
  if(!proyecto){ showToast('⚠ No hay proyecto activo'); return; }
  const from=document.getElementById('pt-from').value.trim();
  const to=document.getElementById('pt-to').value.trim();
  if(!from||!to){ showToast('⚠ Ingresa estación y punto adelante'); return; }

  // Atrás
  const DI_b=parseFloat(document.getElementById('pt-di-b').value);
  const ZC_b=readGMS('pt-zc-b');
  const hr_b=parseFloat(document.getElementById('pt-hr-b').value)||1.5;

  // Adelante
  const DI=parseFloat(document.getElementById('pt-di').value);
  const ZC=readGMS('pt-zc');
  const beta=readGMS('pt-beta');
  const hi=parseFloat(document.getElementById('pt-hi').value)||1.5;
  const hr=parseFloat(document.getElementById('pt-hr').value)||1.5;

  if(isNaN(DI)||DI<=0){ showToast('⚠ DI adelante inválida'); return; }
  if(isNaN(ZC)||ZC<=0||ZC>=180){ showToast('⚠ AV adelante inválido (0°-180°)'); return; }

  // Verificación ida vs vuelta
  let diffDH=null, diffDZ=null;
  if(proyecto.points.length>0&&!isNaN(DI_b)&&DI_b>0&&!isNaN(ZC_b)&&ZC_b>0){
    const prev=proyecto.points[proyecto.points.length-1];
    const DH_fwd=calcDH(prev.DI,prev.ZC);
    const DH_bck=calcDH(DI_b,ZC_b);
    const DZ_fwd=calcDZ(prev.DI,prev.ZC,prev.hi,prev.hr);
    const DZ_bck=calcDZ(DI_b,ZC_b,hi,hr_b);
    diffDH=Math.abs(DH_fwd-DH_bck);
    diffDZ=Math.abs(DZ_fwd+DZ_bck);
  }

  const esCierre=proyecto.points.length>=2&&
    to.trim().toUpperCase()===proyecto.points[0].from.trim().toUpperCase();

  proyecto.points.push({from,to,DI,ZC,beta,hi,hr,DI_b,ZC_b,hr_b,diffDH,diffDZ,esCierre});
  proyecto.computed=null;
  proyecto.adjustedCoords=null;
  guardarProyectoActual();

  // Limpiar
  document.getElementById('pt-to').value='';
  document.getElementById('pt-di-b').value='';
  clearGMS('pt-zc-b');
  document.getElementById('pt-hr-b').value='1.500';
  document.getElementById('pt-di').value='';
  clearGMS('pt-zc');
  clearGMS('pt-beta');
  document.getElementById('pt-hr').value='1.500';

  updateStationTitle();
  renderPointsList();

  if(diffDH!==null){
    const okDH=diffDH<=0.05, okDZ=diffDZ<=0.05;
    showToast(`${okDH?'✓':'⚠'} ΔDH=${fmt(diffDH,3)}m  ${okDZ?'✓':'⚠'} ΔCota=${fmt(diffDZ,3)}m`,4000);
  } else {
    showToast(`✓ Estación ${from}→${to} agregada`);
  }

  if(esCierre){
    setTimeout(()=>{ showToast('🔒 Cierre detectado — calculando...',2500); setTimeout(closePoly,1500); },500);
  }
}

function removePoint(i){
  if(!confirm(`¿Eliminar estación ${proyecto.points[i].from}→${proyecto.points[i].to}?`)) return;
  proyecto.points.splice(i,1);
  proyecto.computed=null;
  proyecto.adjustedCoords=null;
  guardarProyectoActual();
  renderPointsList();
  updateStationTitle();
  document.getElementById('results-section').style.display='none';
}

function openEdit(i){
  const p=proyecto.points[i];
  document.getElementById('edit-idx').value=i;
  document.getElementById('edit-from').value=p.from;
  document.getElementById('edit-to').value=p.to;
  document.getElementById('edit-hi').value=p.hi;
  document.getElementById('edit-di-b').value=p.DI_b||'';
  if(p.ZC_b) writeGMS('edit-zc-b',p.ZC_b); else clearGMS('edit-zc-b');
  document.getElementById('edit-hr-b').value=p.hr_b||1.5;
  document.getElementById('edit-di').value=p.DI;
  writeGMS('edit-zc',p.ZC);
  writeGMS('edit-beta',p.beta);
  document.getElementById('edit-hr').value=p.hr;
  document.getElementById('edit-modal').classList.add('open');
}
function closeEdit(){
  document.getElementById('edit-modal').classList.remove('open');
}
function saveEdit(){
  const i=parseInt(document.getElementById('edit-idx').value);
  const from=document.getElementById('edit-from').value.trim();
  const to=document.getElementById('edit-to').value.trim();
  const hi=parseFloat(document.getElementById('edit-hi').value)||1.5;
  const DI_b=parseFloat(document.getElementById('edit-di-b').value);
  const ZC_b=readGMS('edit-zc-b');
  const hr_b=parseFloat(document.getElementById('edit-hr-b').value)||1.5;
  const DI=parseFloat(document.getElementById('edit-di').value);
  const ZC=readGMS('edit-zc');
  const beta=readGMS('edit-beta');
  const hr=parseFloat(document.getElementById('edit-hr').value)||1.5;
  if(!from||!to){ showToast('⚠ Nombres requeridos'); return; }
  if(isNaN(DI)||DI<=0){ showToast('⚠ DI adelante inválida'); return; }
  if(isNaN(ZC)||ZC<=0||ZC>=180){ showToast('⚠ AV adelante inválido'); return; }
  let diffDH=null, diffDZ=null;
  if(i>0&&!isNaN(DI_b)&&DI_b>0&&!isNaN(ZC_b)&&ZC_b>0){
    const prev=proyecto.points[i-1];
    diffDH=Math.abs(calcDH(prev.DI,prev.ZC)-calcDH(DI_b,ZC_b));
    diffDZ=Math.abs(calcDZ(prev.DI,prev.ZC,prev.hi,prev.hr)+calcDZ(DI_b,ZC_b,hi,hr_b));
  }
  const esCierre=i>=2&&to.trim().toUpperCase()===proyecto.points[0].from.trim().toUpperCase();
  proyecto.points[i]={from,to,DI,ZC,beta,hi,hr,DI_b,ZC_b,hr_b,diffDH,diffDZ,esCierre};
  proyecto.computed=null; proyecto.adjustedCoords=null;
  guardarProyectoActual();
  closeEdit();
  renderPointsList();
  showToast('✓ Estación actualizada');
}

function renderPointsList(){
  const section=document.getElementById('points-section');
  const list=document.getElementById('points-list');
  if(!proyecto||proyecto.points.length===0){ section.style.display='none'; return; }
  section.style.display='block';
  list.innerHTML=proyecto.points.map((p,i)=>{
    let verif='';
    if(p.diffDH!==null&&p.diffDH!==undefined){
      const okDH=p.diffDH<=0.05, okDZ=p.diffDZ<=0.05;
      verif=`<div class="pt-sub" style="color:${okDH&&okDZ?'var(--success)':'var(--warn)'}">
        ${okDH?'✓':'⚠'} ΔDH=${fmt(p.diffDH,3)}m &nbsp;|&nbsp; ${okDZ?'✓':'⚠'} ΔCota=${fmt(p.diffDZ,3)}m
      </div>`;
    }
    const cierreTag=p.esCierre?`<span style="font-size:9px;color:var(--success);margin-left:6px">🔒CIERRE</span>`:'';
    return `<div class="pt-item">
      <div class="pt-num">${i+1}</div>
      <div style="flex:1;min-width:0">
        <div class="pt-name">${p.from} → ${p.to}${cierreTag}</div>
        <div class="pt-sub">🎯 DI=${fmt(p.DI,3)}m | AV=${fmtGMS(p.ZC)} | AH=${fmtGMS(p.beta)}<br>
        hi=${fmt(p.hi,3)}m | hr=${fmt(p.hr,3)}m</div>
        ${p.DI_b?`<div class="pt-sub" style="color:var(--text3)">📡 DI_atrás=${fmt(p.DI_b,3)}m | AV=${fmtGMS(p.ZC_b)}</div>`:''}
        ${verif}
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
        <button class="del-btn" style="color:var(--accent);font-size:13px" onclick="openEdit(${i})">✏</button>
        <button class="del-btn" onclick="removePoint(${i})">✕</button>
      </div>
    </div>`;
  }).join('');
}

function closePoly(){
  if(!proyecto||proyecto.points.length<2){ showToast('⚠ Mínimo 2 estaciones'); return; }
  proyecto.computed=computePoligonal(proyecto.points,proyecto.azInicial,proyecto.tipo,proyecto.toleranciaK);
  guardarProyectoActual();
  renderResults();
  setTimeout(()=>document.getElementById('results-section').scrollIntoView({behavior:'smooth'}),100);
}

function renderResults(){
  const section=document.getElementById('results-section');
  const content=document.getElementById('results-content');
  if(!proyecto||!proyecto.computed){ section.style.display='none'; return; }
  section.style.display='block';
  const c=proyecto.computed;
  const prec=c.precision;
  let precClass='prec-bad',precIcon='✗';
  if(prec>=5000||prec>=3000){ precClass='prec-good'; precIcon='✓'; }
  else if(prec>=1000){ precClass='prec-warn'; precIcon='~'; }
  const calidadLabel={excelente:'EXCELENTE',buena:'BUENA',regular:'REGULAR',mala:'INSUFICIENTE'}[c.calidadLineal]||'';
  const precLabel=prec>=999990?'∞ (perfecto)':`1 / ${prec.toLocaleString()}`;

  content.innerHTML=`
    <div class="tc" style="margin-bottom:14px">
      <div class="prec-badge ${precClass}">${precIcon} Precisión ${precLabel} — ${calidadLabel}</div>
    </div>
    <div class="stat-row"><span class="stat-label">Perímetro total</span><span class="stat-val">${fmt(c.totalLen,3)} m</span></div>
    <div class="stat-row"><span class="stat-label">Error cierre N</span><span class="stat-val">${fmt(c.errN,4)} m</span></div>
    <div class="stat-row"><span class="stat-label">Error cierre E</span><span class="stat-val">${fmt(c.errE,4)} m</span></div>
    <div class="stat-row"><span class="stat-label">Error lineal total</span><span class="stat-val">${fmt(c.errLineal,4)} m</span></div>
    <div class="stat-row"><span class="stat-label">Error altimétrico (ΔZ)</span><span class="stat-val">${fmt(c.errZ,4)} m</span></div>
    ${c.errAngular!==null?`
    <div class="stat-row"><span class="stat-label">Error angular</span>
      <span class="stat-val" style="color:${c.cierreAngularOk?'var(--success)':'var(--danger)'}">
        ${fmtGMS(c.errAngular)} ${c.cierreAngularOk?'✓':'✗'}
      </span></div>
    <div class="stat-row"><span class="stat-label">Tolerancia K√n</span><span class="stat-val">${fmtGMS(c.tolAngular)}</span></div>`:''}
    <div class="sep"></div>
    <div style="font-size:9px;color:var(--text3);margin-bottom:8px;letter-spacing:1px">TABLA DE AZIMUTES Y DISTANCIAS</div>
    <div style="overflow-x:auto">
      <table class="tbl">
        <thead><tr><th>Tramo</th><th>Az</th><th>DH(m)</th><th>ΔN(m)</th><th>ΔE(m)</th><th>ΔZ(m)</th></tr></thead>
        <tbody>${c.results.map(r=>`<tr>
          <td>${r.from}→${r.to}</td>
          <td class="num">${fmtGMS(r.az)}</td>
          <td class="num">${fmt(r.DH,3)}</td>
          <td class="num">${fmt(r.dN,3)}</td>
          <td class="num">${fmt(r.dE,3)}</td>
          <td class="num">${fmt(r.DZ,3)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;

  const adjSection=document.getElementById('adjustment-section');
  const adjContent=document.getElementById('adjustment-content');
  // Siempre mostrar opciones de ajuste
  adjSection.style.display='block';
  const bow=ajustarBowditch(c), tra=ajustarTransito(c);
  const pB=precisionTrasAjuste(bow,c.totalLen), pT=precisionTrasAjuste(tra,c.totalLen);
  const alertClass=c.calidadLineal==='mala'||c.calidadLineal==='regular'?'alert-warn':'alert-info';
  const alertMsg=c.calidadLineal==='mala'||c.calidadLineal==='regular'
    ?'Precisión insuficiente. Aplica un ajuste para compensar el error de cierre.'
    :'Precisión aceptable. Puedes aplicar un ajuste para mayor exactitud.';
  adjContent.innerHTML=`
    <div class="alert ${alertClass}">${alertMsg}</div>
    <div class="stat-row"><span class="stat-label">Bowditch (proporcional a longitud)</span><span class="stat-val">1/${pB>99999?'∞':pB.toLocaleString()}</span></div>
    <div class="stat-row" style="margin-bottom:12px"><span class="stat-label">Tránsito (proporcional a proyección)</span><span class="stat-val">1/${pT>99999?'∞':pT.toLocaleString()}</span></div>
    <div class="row-btns">
      <button class="btn btn-success btn-sm" onclick="applyAdjustment('bowditch')">APLICAR BOWDITCH</button>
      <button class="btn btn-warn btn-sm" onclick="applyAdjustment('transito')">APLICAR TRÁNSITO</button>
    </div>`;
  // Si no hay ajuste previo, aplicar Bowditch por defecto
  if(!proyecto.adjustedCoords) applyAdjustmentData('bowditch',bow);
}

function applyAdjustment(method){
  if(!proyecto||!proyecto.computed) return;
  const adj=method==='bowditch'?ajustarBowditch(proyecto.computed):ajustarTransito(proyecto.computed);
  applyAdjustmentData(method,adj);
  showToast(`✓ Ajuste ${method==='bowditch'?'Bowditch':'Tránsito'} aplicado`);
}
function applyAdjustmentData(method,adj){
  proyecto.adjustedCoords={method,coords:adj.map(r=>({name:r.to,N:r.N_adj,E:r.E_adj,Z:r.Z_adj}))};
  guardarProyectoActual();
  renderCoordsSection(adj);
}
function renderCoordsSection(adj){
  const section=document.getElementById('coords-section');
  const content=document.getElementById('coords-content');
  section.style.display='block';
  content.innerHTML=adj.map(r=>`
    <div class="coord-box">
      <div class="coord-name"><span>${r.to}</span><span style="font-size:9px;color:var(--text3);font-weight:400">${r.from}→${r.to}</span></div>
      <div class="coord-vals">
        <div class="coord-val"><div class="lbl">N (m)</div><div class="num">${fmt(r.N_adj,3)}</div></div>
        <div class="coord-val"><div class="lbl">E (m)</div><div class="num">${fmt(r.E_adj,3)}</div></div>
        <div class="coord-val"><div class="lbl">Z (m)</div><div class="num">${fmt(r.Z_adj,3)}</div></div>
      </div>
    </div>`).join('');
}

// ═══════════════════════════════════════════════
//  AMARRE GEODÉSICO
// ═══════════════════════════════════════════════

function calcAmarre(){
  if(!proyecto){ showToast('⚠ No hay proyecto activo'); return; }
  const kp1={name:document.getElementById('kp1-name').value.trim()||'P1',
    N:parseFloat(document.getElementById('kp1-n').value),
    E:parseFloat(document.getElementById('kp1-e').value),
    Z:parseFloat(document.getElementById('kp1-z').value)};
  const kp2={name:document.getElementById('kp2-name').value.trim()||'P2',
    N:parseFloat(document.getElementById('kp2-n').value),
    E:parseFloat(document.getElementById('kp2-e').value),
    Z:parseFloat(document.getElementById('kp2-z').value)};
  if([kp1.N,kp1.E,kp1.Z,kp2.N,kp2.E,kp2.Z].some(isNaN)){ showToast('⚠ Completa todas las coordenadas'); return; }
  if(!proyecto.adjustedCoords||!proyecto.adjustedCoords.coords.length){ showToast('⚠ Primero calcula y ajusta la poligonal'); return; }
  const dN=kp2.N-kp1.N, dE=kp2.E-kp1.E;
  const azReal=norm360(toDeg(Math.atan2(dE,dN)));
  const rotAngle=toRad(azReal-(proyecto.azInicial||0));
  const cosR=Math.cos(rotAngle), sinR=Math.sin(rotAngle);
  const geoCoords=proyecto.adjustedCoords.coords.map(p=>({
    name:p.name,
    N:kp1.N+(p.N*cosR-p.E*sinR),
    E:kp1.E+(p.N*sinR+p.E*cosR),
    Z:kp1.Z+p.Z
  }));
  proyecto.knownPoints={kp1,kp2};
  proyecto.geoCoords=geoCoords;
  guardarProyectoActual();
  renderAmarreResults();
  showToast('✓ Amarre calculado');
}

function renderAmarreResults(){
  if(!proyecto||!proyecto.geoCoords) return;
  const{kp1,kp2}=proyecto.knownPoints;
  const dN=kp2.N-kp1.N, dE=kp2.E-kp1.E;
  const azReal=norm360(toDeg(Math.atan2(dE,dN)));
  const dist=Math.sqrt(dN*dN+dE*dE);
  document.getElementById('amarre-results').innerHTML=`
    <div class="card">
      <div class="card-title">📡 Resultado del amarre</div>
      <div class="stat-row"><span class="stat-label">Az real ${kp1.name}→${kp2.name}</span><span class="stat-val">${fmtGMS(azReal)}</span></div>
      <div class="stat-row"><span class="stat-label">Distancia entre puntos</span><span class="stat-val">${fmt(dist,3)} m</span></div>
      <div class="sep"></div>
      <div style="font-size:9px;color:var(--text3);margin-bottom:8px;letter-spacing:1px">COORDENADAS ABSOLUTAS</div>
      ${proyecto.geoCoords.map(p=>`
        <div class="coord-box">
          <div class="coord-name">${p.name}</div>
          <div class="coord-vals">
            <div class="coord-val"><div class="lbl">N (m)</div><div class="num">${fmt(p.N,3)}</div></div>
            <div class="coord-val"><div class="lbl">E (m)</div><div class="num">${fmt(p.E,3)}</div></div>
            <div class="coord-val"><div class="lbl">Z (m)</div><div class="num">${fmt(p.Z,3)}</div></div>
          </div>
        </div>`).join('')}
    </div>`;
}

// ═══════════════════════════════════════════════
//  IRRADIACIÓN
// ═══════════════════════════════════════════════

function saveStation(){
  if(!proyecto){ showToast('⚠ No hay proyecto activo'); return; }
  const name=document.getElementById('ir-st-name').value.trim()||'ST';
  const N=parseFloat(document.getElementById('ir-n').value);
  const E=parseFloat(document.getElementById('ir-e').value);
  const Z=parseFloat(document.getElementById('ir-z').value);
  const hi=parseFloat(document.getElementById('ir-hi').value)||1.5;
  const visName=document.getElementById('ir-vis-name').value.trim()||'VIS';
  const visN=parseFloat(document.getElementById('ir-vis-n').value);
  const visE=parseFloat(document.getElementById('ir-vis-e').value);
  if([N,E,Z].some(isNaN)){ showToast('⚠ Ingresa coordenadas de la estación'); return; }
  if(isNaN(visN)||isNaN(visE)){ showToast('⚠ Ingresa N y E del punto visado'); return; }
  const azOrientacion=norm360(toDeg(Math.atan2(visE-E,visN-N)));
  proyecto.irradStation={name,N,E,Z,hi,azOrientacion,visName,visN,visE};
  guardarProyectoActual();
  const disp=document.getElementById('ir-az-display');
  disp.style.display='block';
  disp.textContent=`✓ Az ${name}→${visName}: ${fmtGMS(azOrientacion)}`;
  document.getElementById('ir-shot-card').style.display='block';
  showToast('✓ Estación guardada');
}

function addIrradPoint(){
  if(!proyecto||!proyecto.irradStation){ showToast('⚠ Guarda primero la estación'); return; }
  const st=proyecto.irradStation;
  const pname=document.getElementById('ir-pname').value.trim()||('PT-'+(proyecto.irradPoints.length+1));
  const desc=document.getElementById('ir-desc').value.trim();
  const DI=parseFloat(document.getElementById('ir-di').value);
  const ZC=readGMS('ir-zc');
  const beta=readGMS('ir-beta');
  const hr=parseFloat(document.getElementById('ir-hr').value)||1.5;
  if(isNaN(DI)||DI<=0){ showToast('⚠ DI inválida'); return; }
  if(isNaN(ZC)||ZC<=0||ZC>=180){ showToast('⚠ AV inválido'); return; }
  const DH=calcDH(DI,ZC);
  const DZ=calcDZ(DI,ZC,st.hi,hr);
  const az=norm360(st.azOrientacion+beta);
  const N=st.N+calcDN(DH,az);
  const E=st.E+calcDE(DH,az);
  const Z=st.Z+DZ;
  proyecto.irradPoints.push({name:pname,desc,DI,ZC,beta,hr,DH,az,N,E,Z});
  guardarProyectoActual();
  document.getElementById('ir-pname').value='';
  document.getElementById('ir-desc').value='';
  document.getElementById('ir-di').value='';
  clearGMS('ir-zc');
  clearGMS('ir-beta');
  renderIrradList();
  showToast(`✓ ${pname} calculado`);
  document.getElementById('ir-pname').focus();
}
function removeIrrad(i){
  proyecto.irradPoints.splice(i,1);
  guardarProyectoActual();
  renderIrradList();
}
function renderIrradList(){
  const div=document.getElementById('irrad-list');
  if(!proyecto||!proyecto.irradPoints||proyecto.irradPoints.length===0){ div.innerHTML=''; return; }
  div.innerHTML=`
    <div style="font-size:9px;color:var(--text3);letter-spacing:1px;text-transform:uppercase;margin:14px 0 8px">PUNTOS CALCULADOS (${proyecto.irradPoints.length})</div>
    <div class="card" style="padding:8px 14px">
      ${proyecto.irradPoints.map((p,i)=>`
        <div class="coord-box" style="margin-bottom:6px">
          <div class="coord-name">
            <span>${p.name} <span style="font-size:9px;color:var(--text3);font-weight:400">${p.desc||''}</span></span>
            <button class="del-btn" onclick="removeIrrad(${i})">✕</button>
          </div>
          <div class="coord-vals">
            <div class="coord-val"><div class="lbl">N (m)</div><div class="num">${fmt(p.N,3)}</div></div>
            <div class="coord-val"><div class="lbl">E (m)</div><div class="num">${fmt(p.E,3)}</div></div>
            <div class="coord-val"><div class="lbl">Z (m)</div><div class="num">${fmt(p.Z,3)}</div></div>
          </div>
          <div style="font-size:9px;color:var(--text3);margin-top:5px">Az=${fmtGMS(p.az)} | DH=${fmt(p.DH,3)}m</div>
        </div>`).join('')}
    </div>`;
}

// ═══════════════════════════════════════════════
//  EXPORTAR
// ═══════════════════════════════════════════════

function renderExportSummary(){
  if(!proyecto){ document.getElementById('export-summary').innerHTML='<div style="color:var(--text3);font-size:11px">Sin proyecto activo</div>'; return; }
  const c=proyecto.computed;
  document.getElementById('export-summary').innerHTML=`
    <div class="stat-row"><span class="stat-label">Proyecto</span><span class="stat-val">${proyecto.nombre} (${proyecto.tipo})</span></div>
    <div class="stat-row"><span class="stat-label">Estaciones</span><span class="stat-val">${proyecto.points.length}</span></div>
    <div class="stat-row"><span class="stat-label">Precisión</span><span class="stat-val">${c?'1/'+c.precision.toLocaleString():'—'}</span></div>
    <div class="stat-row"><span class="stat-label">Ajuste</span><span class="stat-val">${proyecto.adjustedCoords?proyecto.adjustedCoords.method:'—'}</span></div>
    <div class="stat-row"><span class="stat-label">Amarre</span><span class="stat-val">${proyecto.knownPoints?'✓ Aplicado':'No'}</span></div>
    <div class="stat-row"><span class="stat-label">Puntos de detalle</span><span class="stat-val">${proyecto.irradPoints?proyecto.irradPoints.length:0}</span></div>`;
}

function downloadCSV(content,filename){
  const blob=new Blob(['\uFEFF'+content],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
}

function exportCSV(type){
  if(!proyecto){ showToast('⚠ No hay proyecto activo'); return; }
  const prefix=proyecto.nombre||'poligonal';
  let csv='';
  if((type==='observaciones'||type==='todo')&&proyecto.computed){
    csv+=type==='todo'?`OBSERVACIONES - ${prefix}\n`:'';
    csv+='Tramo,DI_m,AV_deg,AH_deg,hi_m,hr_m,DH_m,DZ_m,Az_deg,dN_m,dE_m\n';
    csv+=proyecto.computed.results.map(r=>
      `${r.from}→${r.to},${fmt(r.DI,4)},${fmtGMS(r.ZC)},${fmtGMS(r.beta)},${fmt(r.hi,4)},${fmt(r.hr,4)},${fmt(r.DH,4)},${fmt(r.DZ,4)},${fmtGMS(r.az)},${fmt(r.dN,4)},${fmt(r.dE,4)}`
    ).join('\n');
    if(type!=='todo'){ downloadCSV(csv,`${prefix}_observaciones.csv`); showToast('✓ Exportado'); return; }
    csv+='\n\n';
  }
  if((type==='coordenadas'||type==='todo')&&(proyecto.geoCoords||proyecto.adjustedCoords)){
    const coords=proyecto.geoCoords||(proyecto.adjustedCoords?proyecto.adjustedCoords.coords:null);
    if(coords){
      csv+=type==='todo'?`COORDENADAS - ${prefix}\n`:'';
      csv+='Punto,N_m,E_m,Z_m,Tipo\n';
      csv+=coords.map(p=>`${p.name},${fmt(p.N,4)},${fmt(p.E,4)},${fmt(p.Z,4)},${proyecto.geoCoords?'absoluta':'relativa'}`).join('\n');
      if(type!=='todo'){ downloadCSV(csv,`${prefix}_coordenadas.csv`); showToast('✓ Exportado'); return; }
      csv+='\n\n';
    }
  }
  if((type==='irradiacion'||type==='todo')&&proyecto.irradPoints&&proyecto.irradPoints.length>0){
    csv+=type==='todo'?`IRRADIACIÓN - ${prefix}\n`:'';
    csv+='Nombre,Descripcion,N_m,E_m,Z_m,Az,DH_m\n';
    csv+=proyecto.irradPoints.map(p=>`${p.name},${p.desc||''},${fmt(p.N,4)},${fmt(p.E,4)},${fmt(p.Z,4)},${fmtGMS(p.az)},${fmt(p.DH,4)}`).join('\n');
    if(type!=='todo'){ downloadCSV(csv,`${prefix}_irradiacion.csv`); showToast('✓ Exportado'); return; }
  }
  if(type==='todo'&&csv){ downloadCSV(csv,`${prefix}_completo.csv`); showToast('✓ Archivo completo exportado'); }
  else if(type==='todo') showToast('⚠ No hay datos para exportar');
}

function exportJSON(){
  if(!proyecto){ showToast('⚠ No hay proyecto activo'); return; }
  const blob=new Blob([JSON.stringify(proyecto,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=`${proyecto.nombre}_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
  showToast('✓ Backup guardado');
}

// ═══════════════════════════════════════════════
//  INICIALIZACIÓN
// ═══════════════════════════════════════════════

(function init(){
  // Migrar datos viejos si existen
  const viejoKey='topofield_v3';
  const viejo=localStorage.getItem(viejoKey);
  if(viejo){
    try{
      const d=JSON.parse(viejo);
      if(d.polyName&&d.points&&d.points.length>0){
        const migrado=proyectoVacio(d.polyName||'Migrado',d.polyType||'cerrada');
        migrado.azInicial=d.azInicial||0;
        migrado.toleranciaK=d.toleranciaK||30;
        migrado.points=d.points||[];
        migrado.computed=d.computed||null;
        migrado.adjustedCoords=d.adjustedCoords||null;
        migrado.geoCoords=d.geoCoords||null;
        migrado.knownPoints=d.knownPoints||null;
        migrado.irradStation=d.irradStation||null;
        migrado.irradPoints=d.irradPoints||[];
        const lista=cargarProyectos();
        lista.push(migrado);
        guardarProyectos(lista);
        localStorage.removeItem(viejoKey);
      }
    }catch(e){}
  }

  // Intentar cargar el último proyecto activo
  const idActivo=cargarIdActivo();
  if(idActivo){
    const lista=cargarProyectos();
    const p=lista.find(x=>x.id===idActivo);
    if(p){
      proyecto=p;
      cargarUIProyecto();
      showScreen('poly');
      return;
    }
  }
  // Si no hay activo, mostrar lista de proyectos
  showScreen('proyectos');
})();
