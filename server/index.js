const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

// -------- In-memory DB --------
const mem = {
  users: new Map(),
  nextId: 1,
  queue: new Set(),
  matches: new Map(),
  userMatches: new Map(),
  history: new Map()
};

// -------- App setup --------
const app = express();
app.use(express.json());

const ORIGIN = process.env.ORIGIN || null;
if (ORIGIN) app.use(cors({ origin: ORIGIN }));

const webappDir = path.join(__dirname, '..', 'webapp');
app.use(express.static(webappDir));

// -------- Telegram auth --------
const BOT_TOKEN = process.env.BOT_TOKEN || '';
function parseInitData(initData){ const p=new URLSearchParams(initData); const o={}; for (const [k,v] of p) o[k]=v; return o; }
function checkTelegramAuth(initData){
  if (!BOT_TOKEN) return { ok:false, data:{} };
  const data = parseInitData(initData); const hash=data.hash; delete data.hash;
  const payload = Object.keys(data).sort().map(k=>`${k}=${data[k]}`).join('\n');
  const secret = crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return { ok: calc===hash, data };
}
async function requireTg(req,res,next){
  const initData = req.headers['x-telegram-hash'];
  if (!initData) return res.status(401).json({error:'Missing X-Telegram-Hash (open via Telegram bot button)'});
  const { ok, data } = checkTelegramAuth(initData);
  if (!ok) return res.status(401).json({error:'Bad auth'});
  try { req.tg_user = JSON.parse(data.user||'{}'); } catch { req.tg_user = {}; }
  next();
}

// -------- Helpers --------
function ensureUser(tg_user){
  const tg_id = tg_user.id;
  for (const u of mem.users.values()){ if (u.tg_id===tg_id) return u; }
  const u = {
    id: mem.nextId++,
    tg_id,
    username: tg_user.username||null,
    first_name: tg_user.first_name||null,
    last_name: tg_user.last_name||null,
    str: 5, agi: 5, int: 5,
    xp: 0, level: 1, sp: 0,
    elo: 1000, score: 0, banned: 0,
    coins: 0, energy: 10,
    lastDaily: 0,
    keys: 0,
    inventory: [] // [{item,qty}]
  };
  mem.users.set(u.id, u);
  return u;
}

function kFactor(level){ return level>=10 ? 24 : 32; }
function eloExpected(a,b){ return 1 / (1 + Math.pow(10,(b-a)/400)); }
function applyElo(cur, opp, lvl, score){ const k=kFactor(lvl); const e=eloExpected(cur,opp); return Math.round(k*(score-e)); }
function clamp(v,lo,hi){ return Math.max(lo, Math.min(hi,v)); }
function rnd(seed){ let x=seed>>>0; return function(){ x=(1664525*x+1013904223)>>>0; return x/0x100000000; }; }
function simRound(me, opp, actMe, actOpp, rng){
  const base=10, scale={SLAM:me.str*1.2,DASH:me.agi*1.2,MIND:me.int*1.2}, scaleOpp={SLAM:opp.str*1.2,DASH:opp.agi*1.2,MIND:opp.int*1.2};
  const critMe=clamp(0.05+me.int*0.01,0.05,0.5), dodgeOpp=clamp(0.05+opp.agi*0.01,0.05,0.5);
  const critOpp=clamp(0.05+opp.int*0.01,0.05,0.5), dodgeMe=clamp(0.05+me.agi*0.01,0.05,0.5);
  let dmgMe=base+scale[actMe], dmgOpp=base+scaleOpp[actOpp];
  const meCrit = rng()<critMe, oppDodge = rng()<dodgeOpp;
  if (oppDodge) dmgMe=0;
  if (meCrit) dmgMe*=1.7;
  const oppCrit = rng()<critOpp, meDodge = rng()<dodgeMe;
  if (meDodge) dmgOpp=0;
  if (oppCrit) dmgOpp*=1.7;
  const beats={SLAM:'DASH',DASH:'MIND',MIND:'SLAM'};
  if (beats[actMe]===actOpp) dmgMe*=1.12;
  if (beats[actOpp]===actMe) dmgOpp*=1.12;
  const stamCost={SLAM:8,DASH:6,MIND:7};
  return { dmgMe:Math.round(dmgMe), dmgOpp:Math.round(dmgOpp), meCrit, oppDodge, oppCrit, meDodge, stamCostMe:stamCost[actMe], stamCostOpp:stamCost[actOpp] };
}
function simulate(seed, youStats, oppStats, actionsMe){
  const rng=rnd(seed); const you={...youStats,hp:100,stam:30}; const opp={...oppStats,hp:100,stam:30}; const log=[];
  for (let i=0;i<3;i++){
    const aMe=(actionsMe[i]||'SLAM').toUpperCase(); const aOpp=(['SLAM','DASH','MIND'][Math.floor(rng()*3)]);
    const r=simRound(you,opp,aMe,aOpp,rng);
    if (you.stam<r.stamCostMe) r.dmgMe=Math.round(r.dmgMe*0.5);
    if (opp.stam<r.stamCostOpp) r.dmgOpp=Math.round(r.dmgOpp*0.5);
    opp.hp-=r.dmgMe; you.hp-=r.dmgOpp; you.stam-=r.stamCostMe; opp.stam-=r.stamCostOpp;
    log.push({round:i+1,aMe,aOpp,...r,youHP:you.hp,oppHP:opp.hp});
    if (you.hp<=0||opp.hp<=0) break;
  }
  let result='draw'; if (you.hp>opp.hp) result='win'; else if (opp.hp>you.hp) result='lose';
  return { result, log, you:{hp:you.hp,stam:you.stam}, opp:{hp:opp.hp,stam:opp.stam} };
}

// -------- API --------
app.get('/healthz', (req, res)=> res.json({ok:true}));

app.post('/api/start', requireTg, (req,res)=>{
  const u = ensureUser(req.tg_user);
  if (u.banned) return res.status(403).json({error:'banned'});
  res.json({ ok:true, user_id:u.id, stats:u });
});

app.get('/api/profile', requireTg, (req,res)=>{
  const u = ensureUser(req.tg_user);
  res.json({ ok:true, user:u });
});

app.post('/api/upgrade', requireTg, (req,res)=>{
  const { stat } = req.body || {};
  const u = ensureUser(req.tg_user);
  if (!['str','agi','int'].includes(stat)) return res.status(400).json({error:'bad stat'});
  if (u.sp<=0) return res.status(400).json({error:'no points'});
  u[stat]+=1; u.sp-=1;
  res.json({ ok:true, stats:u });
});

app.post('/api/score', requireTg, (req,res)=>{
  const u = ensureUser(req.tg_user); const s = Math.max(0, Number(req.body?.score)||0);
  u.score = Math.max(u.score, s);
  res.json({ ok:true });
});

app.get('/api/leaderboard', (req,res)=>{
  const mode=(req.query.mode||'score').toLowerCase();
  const arr=[...mem.users.values()];
  if (mode==='elo') arr.sort((a,b)=>b.elo-a.elo);
  else if (mode==='coins') arr.sort((a,b)=>b.coins-a.coins);
  else arr.sort((a,b)=>b.score-a.score);
  const rows = arr.slice(0,50).map(u=>({username:u.username,first_name:u.first_name,last_name:u.last_name, elo:u.elo, score:u.score, coins:u.coins}));
  res.json({ ok:true, rows, mode });
});

// -------- Daily reward & store --------
app.post('/api/daily/claim', requireTg, (req,res)=>{
  const u=ensureUser(req.tg_user);
  const DAY=24*60*60*1000;
  const nowTs=Date.now();
  const next=u.lastDaily?u.lastDaily+DAY:0;
  if (next && nowTs<next) return res.status(429).json({ok:false,nextAt:next,retryIn:next-nowTs});
  const reward=25+Math.floor(Math.random()*11);
  u.coins+=reward; u.lastDaily=nowTs;
  res.json({ok:true,reward,coins:u.coins,nextAt:nowTs+DAY});
});
app.post('/api/store/buy-energy', requireTg, (req,res)=>{
  const u=ensureUser(req.tg_user);
  const cost=15, gain=5;
  if (u.coins < cost) return res.status(400).json({error:'not enough coins'});
  u.coins -= cost; u.energy += gain;
  res.json({ ok:true, coins:u.coins, energy:u.energy });
});
app.post('/api/store/buy-key', requireTg, (req,res)=>{
  const u=ensureUser(req.tg_user);
  const cost=20;
  if (u.coins < cost) return res.status(400).json({error:'not enough coins'});
  u.coins -= cost; u.keys += 1;
  res.json({ ok:true, keys:u.keys, coins:u.coins });
});
app.post('/api/loot/open', requireTg, (req,res)=>{
  const u=ensureUser(req.tg_user);
  if (u.keys <= 0) return res.status(400).json({error:'no keys'});
  u.keys -= 1;
  const pool = [
    { item:'⚙️ Scrap',      weight:70 },
    { item:'💊 STR Chip',   weight:10, stat:'str', bonus:1 },
    { item:'🌀 AGI Servo',  weight:10, stat:'agi', bonus:1 },
    { item:'🧠 INT Core',   weight:9,  stat:'int', bonus:1 },
    { item:'💎 Credit Pack',weight:1,  coins:50 }
  ];
  const sum = pool.reduce((a,p)=>a+p.weight,0);
  let r = Math.random()*sum, picked = pool[0];
  for (const p of pool){ r-=p.weight; if (r<=0){ picked=p; break; } }
  if (picked.coins) u.coins += picked.coins;
  if (picked.stat)  u[picked.stat] = (u[picked.stat]||0) + (picked.bonus||1);
  const ix = u.inventory.findIndex(e=>e.item===picked.item);
  if (ix>=0) u.inventory[ix].qty += 1;
  else u.inventory.push({ item:picked.item, qty:1 });
  res.json({ ok:true, gained:picked.item, coins:u.coins, keys:u.keys, inventory:u.inventory });
});
app.get('/api/inventory', requireTg, (req,res)=>{
  const u=ensureUser(req.tg_user);
  res.json({ ok:true, keys:u.keys, inventory:u.inventory, coins:u.coins, energy:u.energy });
});

// -------- PvP --------
app.post('/api/pvp/enqueue', requireTg, (req,res)=>{
  const u=ensureUser(req.tg_user);
  if (u.energy<=0) return res.status(400).json({error:'no energy'});
  mem.queue.add(u.id);
  for (const other of mem.queue){
    if (other!==u.id){
      mem.queue.delete(other); mem.queue.delete(u.id);
      const opp = mem.users.get(other);
      const seed = Math.floor(Math.random()*1e9);
      const mId = Date.now()*1000 + Math.floor(Math.random()*1000);
      const oppJson = {name: opp.username||opp.first_name||('U'+opp.id), str: opp.str, agi: opp.agi, int: opp.int, elo: opp.elo};
      mem.matches.set(mId, { id:mId, user_id:u.id, opp:oppJson, seed, resolved:false });
      mem.userMatches.set(u.id, mId);
      return res.json({ ok:true, matched:true, match_id:mId });
    }
  }
  res.json({ ok:true, matched:false });
});

app.post('/api/battle/start', requireTg, (req,res)=>{
  const u=ensureUser(req.tg_user);
  const mId = mem.userMatches.get(u.id);
  if (!mId){
    const seed=Math.floor(Math.random()*1e9);
    const id=Date.now()*1000 + Math.floor(Math.random()*1000);
    const opp={name:'Drone', str:u.str, agi:u.agi, int:u.int, elo:1000};
    mem.matches.set(id, { id, user_id:u.id, opp, seed, resolved:false });
    mem.userMatches.set(u.id, id);
    return res.json({ ok:true, match_id:id, opponent:opp, seed });
  }
  const m = mem.matches.get(mId);
  res.json({ ok:true, match_id:m.id, opponent:m.opp, seed:m.seed });
});

app.post('/api/battle/resolve', requireTg, (req,res)=>{
  const u=ensureUser(req.tg_user);
  const { match_id, actions=[] } = req.body || {};
  const m = mem.matches.get(match_id);
  if (!m || m.user_id!==u.id) return res.status(404).json({error:'match not found'});
  if (m.resolved) return res.json({ ok:true, already:true, result:m.result });
  const sim = simulate(m.seed, {str:u.str,agi:u.agi,int:u.int}, {str:m.opp.str,agi:m.opp.agi,int:m.opp.int}, actions.map(x=>String(x||'SLAM')));
  
  // списываем энергию
  u.energy = Math.max(0, u.energy - 1);

  let reward=0,xp=0,delta=0,scoreAdd=0,coins=0;
  if (sim.result==='win'){ reward=10; xp=20; scoreAdd=10; coins=8; delta = applyElo(u.elo, m.opp.elo||1000, u.level, 1); }
  else if (sim.result==='draw'){ reward=5; xp=12; scoreAdd=5; coins=4; delta = applyElo(u.elo, m.opp.elo||1000, u.level, 0.5); }
  else { reward=3; xp=8; scoreAdd=3; coins=2; delta = applyElo(u.elo, m.opp.elo||1000, u.level, 0); }
  u.elo += delta; u.score += scoreAdd; u.xp += xp; u.coins += coins;
  while (u.xp >= 100*u.level){ u.xp -= 100*u.level; u.level++; u.sp+=2; }
  m.resolved=true; m.result=sim.result; m.elo_delta=delta; m.log=sim.log;
  const entry = { ts: Date.now(), opp: m.opp, result: sim.result, elo_delta: delta };
  if (!mem.history.has(u.id)) mem.history.set(u.id, []);
  mem.history.get(u.id).unshift(entry); mem.history.get(u.id).splice(0,30);
  mem.userMatches.delete(u.id);
  res.json({ ok:true, ...sim, reward, xpGain:xp, elo_delta:delta, new_score:u.score, level:u.level, sp:u.sp, coins:u.coins, energy:u.energy });
});

app.get('/api/matches', requireTg, (req,res)=>{
  const u=ensureUser(req.tg_user);
  res.json({ ok:true, rows: (mem.history.get(u.id)||[]) });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, ()=> console.log('AlienX Arena server on', PORT));
