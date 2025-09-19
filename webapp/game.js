const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
let score = 0;
const scoreEl = document.getElementById('score');
const saveBtn = document.getElementById('saveBtn');
const userBox = document.getElementById('userBox');
const profileBox = document.getElementById('profileBox');
const lbEl = document.getElementById('lb');
const historyEl = document.getElementById('history');
const invBox = document.getElementById('invBox');
const buyKey = document.getElementById('buyKey');
const openBox = document.getElementById('openBox');
const btnStr = document.getElementById('btnStr');
const btnAgi = document.getElementById('btnAgi');
const btnInt = document.getElementById('btnInt');

const enqueueBtn = document.getElementById('enqueueBtn');
const arenaOpp = document.getElementById('arenaOpp');
const arenaChoices = document.getElementById('arenaChoices');
const choicesBox = document.getElementById('choices');
const fightBtn = document.getElementById('fightBtn');
const battleLog = document.getElementById('battleLog');

function setScore(v){ score=v; scoreEl.textContent=String(score); }
function getInitData(){ return tg ? tg.initData : null; }
function showUser(){ if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user){ const u=tg.initDataUnsafe.user; userBox.textContent = `User: ${u.username||u.first_name||u.id}`; } else { userBox.textContent = 'Open inside Telegram for full auth'; } }
async function api(path, opts={}){
  const initData=getInitData();
  const res = await fetch(path,{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{}),...(initData?{'X-Telegram-Hash':initData}:{})}});
  if (!res.ok) throw new Error(await res.text()); return res.json();
}
async function loadLB(mode='score'){
  const r=await api('/api/leaderboard?mode='+mode,{method:'GET'}); lbEl.innerHTML='';
  (r.rows||[]).forEach(row=>{ const li=document.createElement('li'); li.textContent = `${row.username||row.first_name||'anon'}: ${mode==='elo'?row.elo:row.score}`; lbEl.appendChild(li); });
}
async function loadProfile(){ const r=await api('/api/profile',{method:'GET'}); const u=r.user; profileBox.textContent = `STR ${u.str} • AGI ${u.agi} • INT ${u.int} • LVL ${u.level} • XP ${u.xp} • SP ${u.sp} • ELO ${u.elo}`; const can=u.sp>0; btnStr.disabled=!can; btnAgi.disabled=!can; btnInt.disabled=!can; }
btnStr.onclick=()=>api('/api/upgrade',{method:'POST',body:JSON.stringify({stat:'str'})}).then(loadProfile);
btnAgi.onclick=()=>api('/api/upgrade',{method:'POST',body:JSON.stringify({stat:'agi'})}).then(loadProfile);
btnInt.onclick=()=>api('/api/upgrade',{method:'POST',body:JSON.stringify({stat:'int'})}).then(loadProfile);
saveBtn.onclick=()=>api('/api/score',{method:'POST',body:JSON.stringify({score})}).then(()=>loadLB());

const actions=['SLAM','DASH','MIND'];
let selected=['SLAM','DASH','MIND']; let curMatch=null;
function renderChoices(){ choicesBox.innerHTML=''; for (let i=0;i<3;i++){ const row=document.createElement('div'); row.style.marginBottom='6px'; actions.forEach(a=>{ const b=document.createElement('button'); b.textContent=`${i+1}) ${a}`; if (selected[i]===a) b.style.outline='2px solid rgba(255,255,255,.7)'; b.onclick=()=>{selected[i]=a; renderChoices();}; row.appendChild(b); }); choicesBox.appendChild(row);} }
enqueueBtn.onclick=async()=>{
  battleLog.textContent=''; arenaOpp.textContent='Searching…'; try{ const q=await api('/api/pvp/enqueue',{method:'POST'}); setTimeout(async()=>{ const m=await api('/api/battle/start',{method:'POST'}); if (m.ok){ curMatch=m.match_id; arenaOpp.textContent=`Opponent: ${m.opponent.name} (STR ${m.opponent.str} / AGI ${m.opponent.agi} / INT ${m.opponent.int})`; arenaChoices.style.display=''; renderChoices(); } },500);}catch(e){ arenaOpp.textContent='Error finding opponent'; }
};
fightBtn.onclick=async()=>{
  if (!curMatch) return; battleLog.textContent='Battling…'; try{ const r=await api('/api/battle/resolve',{method:'POST',body:JSON.stringify({match_id:curMatch,actions:selected})}); const lines=[]; r.log.forEach(l=>{ lines.push(`R${l.round}: You ${l.aMe} vs Opp ${l.aOpp} | dmgYou→Opp ${l.dmgMe}${l.meCrit?' CRIT':''}${l.oppDodge?' (dodged)':''} | dmgOpp→You ${l.dmgOpp}${l.oppCrit?' CRIT':''}${l.meDodge?' (dodged)':''} || HP You ${l.youHP} / Opp ${l.oppHP}`); }); lines.push(`\nRESULT: ${r.result.toUpperCase()} (+${r.reward}, XP +${r.xpGain}, ΔELO ${r.elo_delta>=0?'+':''}${r.elo_delta})`); battleLog.textContent=lines.join('\n'); await loadLB('elo'); await loadProfile(); await loadHistory(); }catch(e){ battleLog.textContent='Battle error'; }
};

async function refreshInventory(){ const r=await api('/api/inventory',{method:'GET'}); invBox.innerHTML = `Keys: ${r.keys}<br/>` + (r.inventory||[]).map(e=>`${e.item} × ${e.qty}`).join(', '); }
buyKey.onclick=()=>api('/api/store/buy-key',{method:'POST'}).then(r=>{ alert('Keys: '+r.keys+' (stub)'); refreshInventory(); });
openBox.onclick=()=>api('/api/loot/open',{method:'POST'}).then(r=>{ alert('You got: '+r.gained); refreshInventory(); }).catch(()=>alert('Open failed'));

async function loadHistory(){ const r=await api('/api/matches',{method:'GET'}); historyEl.innerHTML=''; (r.rows||[]).forEach(m=>{ const li=document.createElement('li'); const ts=new Date(m.ts).toLocaleString(); li.textContent=`${ts}: vs ${m.opp.name} — ${m.result} (ELO ${m.elo_delta>=0?'+':''}${m.elo_delta})`; historyEl.appendChild(li); }); }

document.getElementById('lbScore').onclick=()=>loadLB('score');
document.getElementById('lbElo').onclick=()=>loadLB('elo');

(async function init(){ if (tg){ tg.expand&&tg.expand(); tg.ready&&tg.ready(); try{ await api('/api/start',{method:'POST'});}catch(e){ alert('Open via Telegram'); } } showUser(); await loadLB(); await loadProfile(); await refreshInventory(); await loadHistory(); })();
