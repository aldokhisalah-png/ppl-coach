// ===================== LOGIC START (pure rules, no DOM) =====================
const ROTATION = ['push','pull','legs','rest'];
const DAY_NAMES = {push:'Push', pull:'Pull', legs:'Legs', rest:'Rest'};
const CATS = {
  compound:  {label:'Compound',  between:180, after:210},
  moderate:  {label:'Moderate',  between:120, after:150},
  isolation: {label:'Isolation', between:90,  after:90}
};
// Number of working sets picks the back-off system. Category picks rest. They are independent.
const BACKOFF = {3:[1, 0.85, 0.75], 4:[1, 0.92, 0.85, 0.80]};
const WARMUP_PCT = 0.5;
const DEFAULT_INC = 2.5;

function ex(id, name, cat, sets, lo, hi){ return {id, name, cat, sets, lo, hi}; }
const PROGRAM = {
  push: [
    ex('incline-db-press','Incline Dumbbell Press','compound',4,6,10),
    ex('flat-machine-press','Flat Machine Chest Press','moderate',3,8,12),
    ex('cable-chest-fly','Cable Chest Fly','moderate',3,12,15),
    ex('machine-shoulder-press','Machine Shoulder Press','moderate',3,8,12),
    ex('cable-lateral-raise','Cable Lateral Raise','isolation',4,15,20),
    ex('oh-cable-tri-ext','Overhead Cable Triceps Extension','isolation',3,10,15),
    ex('seated-cable-pushdown','Seated Cable Triceps Pushdown','isolation',3,12,15)
  ],
  pull: [
    ex('lat-pulldown','Lat Pulldown','compound',4,6,10),
    ex('chest-supported-row','Chest-Supported Row','compound',4,8,12),
    ex('sa-cable-pulldown','Single-Arm Cable Pulldown','isolation',3,12,15),
    ex('sa-rear-delt-fly','Single-Arm Cable Rear-Delt Fly','isolation',4,15,20),
    ex('btb-cable-curl','Behind-the-Back Cable Curl','isolation',3,10,12),
    ex('cable-hammer-curl','Cable Hammer Curl','isolation',3,12,15)
  ],
  legs: [
    ex('hack-squat','Hack Squat','compound',4,8,12),
    ex('rdl','Romanian Deadlift','compound',4,8,12),
    ex('leg-press','Leg Press','compound',3,8,12),
    ex('leg-extension','Leg Extension','isolation',3,12,15),
    ex('seated-leg-curl','Seated Leg Curl','isolation',4,10,15),
    ex('standing-calf-raise','Standing Calf Raise','isolation',4,10,15),
    ex('abs','Abs','isolation',3,10,15)
  ]
};
const ALL_EX = Object.values(PROGRAM).flat();
const EX_BY_ID = Object.fromEntries(ALL_EX.map(e => [e.id, e]));

function nextDay(lastCompleted){
  if (!lastCompleted) return 'push';
  return ROTATION[(ROTATION.indexOf(lastCompleted) + 1) % ROTATION.length];
}
function fmt(n){ return String(+(+n).toFixed(2)); }
function fmt2(n){ return (+n).toFixed(2); }
function fmtTime(sec){ const m = Math.floor(sec/60), s = sec % 60; return m + ':' + String(s).padStart(2,'0'); }
// Round to the nearest available increment (exact halves round up).
function roundTo(x, inc){ return +(Math.round(x/inc + 1e-9) * inc).toFixed(3); }
function pctLabel(p){ return Math.round(p*100) + '%'; }

// Progressive overload: Set 1 only, from the ACTUAL logged Set 1 of the previous session.
// prevPrev (optional) = the Set 1 before that. It is only used for the missed-attempt rollback:
// if last time was a heavier attempt (prev.w > prevPrev.w) and reps fell below the range minimum,
// go back to the weight before the attempt.
function planSet1(prev, e, inc, prevPrev){
  if (!prev) return {kind:'first', weight:null,
    reason:'No previous Set 1 is available. Enter your starting top-set weight.'};
  const range = `${e.lo}–${e.hi}`;
  if (prev.r >= e.hi){
    const w = +(prev.w + inc).toFixed(3);
    const where = prev.r === e.hi ? `the top of your ${range} range` : `above the top of your ${range} range`;
    return {kind:'increase', weight:w,
      reason:`Increase: last Set 1 was ${fmt(prev.w)} kg × ${prev.r}. ${prev.r} reps is ${where}, so add your ${fmt(inc)} kg increment: ${fmt(prev.w)} + ${fmt(inc)} = ${fmt(w)} kg.`};
  }
  if (prev.r < e.lo && prevPrev && prev.w > prevPrev.w){
    return {kind:'rollback', weight:prevPrev.w,
      reason:`Return to ${fmt(prevPrev.w)} kg: last time's new weight (${fmt(prev.w)} kg × ${prev.r}) fell below your ${e.lo}-rep minimum, so Set 1 goes back to the weight before that attempt.`};
  }
  return {kind:'same', weight:prev.w,
    reason:`Same weight: last Set 1 was ${fmt(prev.w)} kg × ${prev.r}. The top of your ${range} range is ${e.hi}, so ${fmt(prev.w)} kg stays.`};
}

// Warm-up: 50% of TODAY'S planned Set 1, rounded to the exercise increment.
function warmup(set1, inc){
  const raw = set1 * WARMUP_PCT;
  const w = roundTo(raw, inc);
  const rounded = Math.abs(raw - w) > 1e-9;
  return {weight:w, raw,
    calc:`${fmt(set1)} × 0.50 = ${fmt2(raw)}${rounded ? ' → ' + fmt(w) : ''} kg`,
    reason:`Warm up with ${fmt(w)} kg: the warm-up rule is 50% of today's ${fmt(set1)} kg Set 1${rounded ? ` (${fmt2(raw)} kg, rounded to your ${fmt(inc)} kg increment)` : ''}.`};
}

// Back-off: fixed % of the CURRENT workout's Set 1. baseKind = 'planned' | 'actual'.
function backoff(base, e, inc, idx, baseKind){
  const pct = BACKOFF[e.sets][idx];
  const raw = base * pct;
  const w = roundTo(raw, inc);
  const rounded = Math.abs(raw - w) > 1e-9;
  const which = baseKind === 'actual' ? `the ${fmt(base)} kg you actually lifted on Set 1 today` : `today's ${fmt(base)} kg Set 1`;
  return {weight:w, pct, raw,
    calc:`${fmt(base)} × ${pct.toFixed(2)} = ${fmt2(raw)}${rounded ? ' → ' + fmt(w) : ''} kg`,
    reason:`Set ${idx+1} is ${fmt(w)} kg: the ${e.sets}-set system uses ${pctLabel(pct)} of ${which}${rounded ? `. ${pctLabel(pct)} = ${fmt2(raw)} kg, rounded to your ${fmt(inc)} kg increment` : ''}.`};
}

// Rest: category decides. isLastSet = rest before the next exercise.
function restFor(e, isLastSet){
  const c = CATS[e.cat];
  if (!isLastSet){
    return {sec:c.between, reason:`${fmtTime(c.between)} because ${e.name} is a ${c.label.toLowerCase()} exercise. Rule: ${fmtTime(c.between)} between working sets.`};
  }
  return {sec:c.after, reason:`${fmtTime(c.after)} before the next exercise because you just finished ${e.name}, a ${c.label.toLowerCase()} exercise.`};
}

// Previous Set 1 = most recent saved session that has a logged Set 1 for this exercise.
function findPrevSet1(history, exId){
  const sorted = [...history].sort((a,b) => b.id - a.id);
  for (const s of sorted){
    const en = s.entries && s.entries[exId];
    const s1 = en && en.sets && en.sets[0];
    if (s1 && s1.w != null && s1.r != null) return {w:+s1.w, r:+s1.r, date:s.date};
  }
  return null;
}

// ---------- Dashboard rules ----------
// Local calendar date key (YYYY-MM-DD) for an ISO timestamp or Date.
function dateKey(d){ const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; }
function daysInMonth(y, m){ return new Date(y, m+1, 0).getDate(); } // m is 0-based
// Epley estimated 1RM from ACTUAL Set 1 only.
function epley(w, r){ return w * (1 + r/30); }
// Set 1 series for one exercise, oldest first.
function set1Series(history, exId){
  return [...history].sort((a,b) => a.id - b.id).map(s => {
    const s1 = s.entries && s.entries[exId] && s.entries[exId].sets && s.entries[exId].sets[0];
    return s1 && s1.w != null && s1.r != null ? {date:s.date, w:+s1.w, r:+s1.r, e1rm:epley(+s1.w, +s1.r)} : null;
  }).filter(Boolean);
}
// Body weight for a workout date: the most recent entry ON or BEFORE that date. None → null.
function bodyWeightFor(entries, workoutDateKey){
  if (!entries || !entries.length) return null;
  let best = null;
  for (const e of entries){
    if (e.date <= workoutDateKey && (!best || e.date > best.date || (e.date === best.date && (e.updatedAt||0) > (best.updatedAt||0)))) best = e;
  }
  return best;
}

// =====================================================================
// STRENGTH PERCENTILE — mapping layer, reference data, conversion, service
// Rule: a percentile is shown ONLY when a real reference dataset is present.
// Comparison group: male lifters at a similar body weight (never "all men").
// =====================================================================

// How the APP logs each exercise (what the user types and sees). Never changed by comparisons.
//   one_dumbbell   — weight of ONE dumbbell (two 35 kg dumbbells → 35)
//   stack          — displayed cable/selectorized stack weight
//   one_side_stack — unilateral cable: stack weight used on ONE side
//   total_external — barbell / plate-loaded: total external load
//   unspecified    — no fixed load convention (e.g. generic "Abs")
//
// Support tiers:
//   standard     — direct reference match; plain percentile label
//   approximate  — reference exists but machine/cable resistance differs between gyms
//   unavailable  — no reliable match; never substituted with another exercise
const EXERCISE_STANDARDS_MAP = {
  'incline-db-press':       {name:'Incline Dumbbell Press',          reference:'Incline Dumbbell Bench Press', support:'standard',    logging:'one_dumbbell'},
  'flat-machine-press':     {name:'Flat Machine Chest Press',        reference:'Machine Chest Press',          support:'approximate', logging:'stack', notes:'Machine geometry and calibration vary.'},
  'cable-chest-fly':        {name:'Cable Chest Fly',                 reference:'Cable Fly',                    support:'approximate', logging:'one_side_stack', notes:'Cable pulley ratios vary between gyms.'},
  'machine-shoulder-press': {name:'Machine Shoulder Press',          reference:'Machine Shoulder Press',       support:'approximate', logging:'stack'},
  'cable-lateral-raise':    {name:'Cable Lateral Raise',             reference:'Cable Lateral Raise',          support:'approximate', logging:'one_side_stack', notes:'Cable pulley ratios vary between gyms.'},
  'oh-cable-tri-ext':       {name:'Overhead Cable Triceps Extension', reference:'Cable Overhead Triceps Extension', support:'approximate', logging:'stack', notes:'Cable pulley ratios vary between gyms.'},
  'seated-cable-pushdown':  {name:'Seated Cable Triceps Pushdown',   reference:'Tricep Pushdown',              support:'approximate', logging:'stack', notes:'Seated vs standing pushdown may differ from the reference.'},
  'lat-pulldown':           {name:'Lat Pulldown',                    reference:'Lat Pulldown',                 support:'approximate', logging:'stack'},
  'chest-supported-row':    {name:'Chest-Supported Row',             reference:'Chest Supported Row',          support:'approximate', logging:'total_external', notes:'Machine/plate-loaded geometry varies.'},
  'sa-cable-pulldown':      {name:'Single-Arm Cable Pulldown',       reference:'Single Arm Lat Pulldown',      support:'approximate', logging:'one_side_stack'},
  'sa-rear-delt-fly':       {name:'Single-Arm Cable Rear-Delt Fly',  reference:null, support:'unavailable', logging:'one_side_stack', notes:'Custom cable variation; no trustworthy standard.'},
  'btb-cable-curl':         {name:'Behind-the-Back Cable Curl',      reference:null, support:'unavailable', logging:'one_side_stack', notes:'No exact standard for this variation.'},
  'cable-hammer-curl':      {name:'Cable Hammer Curl',               reference:'Cable Hammer Curl',            support:'approximate', logging:'stack'},
  'hack-squat':             {name:'Hack Squat',                      reference:'Hack Squat',                   support:'approximate', logging:'total_external', notes:'Sled weight and angle vary by machine.'},
  'rdl':                    {name:'Romanian Deadlift',               reference:'Romanian Deadlift',            support:'standard',    logging:'total_external'},
  'leg-press':              {name:'Leg Press',                       reference:'Leg Press',                    support:'approximate', logging:'total_external', notes:'Sled weight and angle vary by machine.'},
  'leg-extension':          {name:'Leg Extension',                   reference:'Leg Extension',                support:'approximate', logging:'stack'},
  'seated-leg-curl':        {name:'Seated Leg Curl',                 reference:'Seated Leg Curl',              support:'approximate', logging:'stack'},
  'standing-calf-raise':    {name:'Standing Calf Raise',             reference:'Machine Calf Raise',           support:'approximate', logging:'stack'},
  'abs':                    {name:'Abs',                             reference:null, support:'unavailable', logging:'unspecified', notes:'Generic entry; pick a specific exercise (e.g. Cable Crunch) to map it.'}
};

// Real strength-standard datasets, keyed by reference exercise name. EMPTY ON PURPOSE.
// Nothing here is invented. Add a dataset only from a real, citable source.
// Shape:
//   REFERENCE_DATA['Romanian Deadlift'] = {
//     source: 'Name + URL + date retrieved',
//     sex: 'male',
//     population: 'male lifters',          // who was measured
//     metric: 'e1rm',                       // the dataset's thresholds are 1RM / e1RM in kg
//     loadConvention: 'total_external',     // how the DATASET counts load (see conversions below)
//     rows: [                               // one row per body weight, ascending
//       { bodyWeightKg: 70, thresholds: { 5: kg, 20: kg, 50: kg, 80: kg, 95: kg } },
//       { bodyWeightKg: 80, thresholds: { ... } }
//     ]
//   };
const REFERENCE_DATA = {};

// Converts the app's logged load to the dataset's convention. ONLY the pairs listed here are
// allowed; any other combination returns null and the percentile shows as unavailable.
// The user's logged and displayed numbers are never changed — this is internal only.
const LOAD_CONVERSIONS = {
  // same convention → no change
  'one_dumbbell>one_dumbbell': kg => kg,
  'stack>stack': kg => kg,
  'one_side_stack>one_side_stack': kg => kg,
  'total_external>total_external': kg => kg,
  // app logs ONE dumbbell; dataset uses combined weight of both dumbbells → ×2 (35 kg → 70 kg)
  'one_dumbbell>combined_dumbbells': kg => kg * 2
};
function toComparisonLoad(kg, appConvention, refConvention){
  const f = LOAD_CONVERSIONS[`${appConvention}>${refConvention}`];
  return f ? f(kg) : null;
}

function ordinal(n){ const v = n % 100; return n + (v >= 11 && v <= 13 ? 'th' : ({1:'st',2:'nd',3:'rd'}[n % 10] || 'th')); }
function lerp(a, b, t){ return a + (b - a) * t; }

// The one service the UI calls. Returns a status; the UI only formats it.
//   {status:'unavailable', reason}
//   {status:'needs_bodyweight'}
//   {status:'ok', percentile, bound:null|'below'|'above', approximate, note}
function getStrengthPercentile({exercise, sex = 'male', bodyWeightKg, estimated1RM}){
  const map = exercise && EXERCISE_STANDARDS_MAP[exercise.id];
  if (!map || map.support === 'unavailable' || !map.reference) return {status:'unavailable', reason: map && map.notes || 'No reliable reference exercise.'};
  if (bodyWeightKg == null) return {status:'needs_bodyweight'};
  const ref = REFERENCE_DATA[map.reference];
  if (!ref || !Array.isArray(ref.rows) || !ref.rows.length) return {status:'unavailable', reason:'No reference dataset loaded.'};
  if (ref.sex !== sex) return {status:'unavailable', reason:'Reference data is for a different group.'};
  if (ref.metric !== 'e1rm' && ref.metric !== '1rm') return {status:'unavailable', reason:'Unsupported reference metric.'};
  if (estimated1RM == null) return {status:'unavailable', reason:'No Set 1 logged.'};
  const load = toComparisonLoad(estimated1RM, map.logging, ref.loadConvention);
  if (load == null) return {status:'unavailable', reason:'Load convention cannot be converted.'};

  // Body weight must fall inside the table — no extrapolation.
  const rows = [...ref.rows].sort((a,b) => a.bodyWeightKg - b.bodyWeightKg);
  if (bodyWeightKg < rows[0].bodyWeightKg || bodyWeightKg > rows[rows.length-1].bodyWeightKg) return {status:'unavailable', reason:'Body weight is outside the reference table.'};
  let lo = rows[0], hi = rows[rows.length-1];
  for (let i = 0; i < rows.length - 1; i++){ if (bodyWeightKg >= rows[i].bodyWeightKg && bodyWeightKg <= rows[i+1].bodyWeightKg){ lo = rows[i]; hi = rows[i+1]; break; } }
  const t = hi.bodyWeightKg === lo.bodyWeightKg ? 0 : (bodyWeightKg - lo.bodyWeightKg) / (hi.bodyWeightKg - lo.bodyWeightKg);
  const pcts = Object.keys(lo.thresholds).map(Number).filter(p => hi.thresholds[p] != null).sort((a,b) => a - b);
  if (pcts.length < 2) return {status:'unavailable', reason:'Reference table too sparse.'};
  const thr = pcts.map(p => ({p, kg: lerp(lo.thresholds[p], hi.thresholds[p], t)}));

  const approximate = map.support === 'approximate';
  const note = approximate ? 'Machine resistance varies by equipment.' : null;
  if (load < thr[0].kg) return {status:'ok', percentile:thr[0].p, bound:'below', approximate, note};
  if (load >= thr[thr.length-1].kg) return {status:'ok', percentile:thr[thr.length-1].p, bound:'above', approximate, note};
  for (let i = 0; i < thr.length - 1; i++){
    const a = thr[i], b = thr[i+1];
    if (load >= a.kg && load < b.kg){
      const pct = Math.round(lerp(a.p, b.p, (load - a.kg) / (b.kg - a.kg)));
      return {status:'ok', percentile:pct, bound:null, approximate, note};
    }
  }
  return {status:'unavailable', reason:'Could not place the lift in the reference table.'};
}

// Plain-language label for the card. Kept next to the service so wording stays consistent.
function percentileLabel(r){
  if (r.status === 'needs_bodyweight') return {text:'Add body weight in Settings', note:null};
  if (r.status !== 'ok') return {text:'Percentile unavailable', note:null};
  const group = 'among male lifters at your bodyweight';
  const core = r.bound === 'below' ? `Below the ${ordinal(r.percentile)} percentile ${group}`
             : r.bound === 'above' ? `Above the ${ordinal(r.percentile)} percentile ${group}`
             : `${ordinal(r.percentile)} percentile ${group}`;
  return {text: r.approximate ? `Approx. ${core.charAt(0).toLowerCase() + core.slice(1)}` : core, note:r.note};
}

// =====================================================================
// PROGRESS ENGINE — comparisons, progression status, records, summaries.
// Pure functions over saved history. The UI only formats what these return.
// =====================================================================

// All logged Set 1 results for an exercise, NEWEST first.
function set1History(history, exId){
  return [...history].sort((a,b) => b.id - a.id).map(s => {
    const s1 = s.entries && s.entries[exId] && s.entries[exId].sets && s.entries[exId].sets[0];
    return s1 && s1.w != null && s1.r != null ? {w:+s1.w, r:+s1.r, date:s.date, id:s.id} : null;
  }).filter(Boolean);
}
// The most recent saved entry (all sets) for an exercise.
function prevEntry(history, exId){
  const s = [...history].sort((a,b) => b.id - a.id).find(x => { const en = x.entries && x.entries[exId]; return en && en.sets && en.sets.some(Boolean); });
  return s ? s.entries[exId] : null;
}
// Next session's Set 1 plan from history (same rule the workout uses).
function planFromHistory(history, e, inc){
  const h = set1History(history, e.id);
  return planSet1(h[0] || null, e, inc, h[1] || null);
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : (w === w.toUpperCase() ? 'S' : 's')}`;

// setComparison: today's set vs the SAME set number last time.
function compareSet(prev, cur){
  if (!prev || prev.w == null || prev.r == null) return {kind:'first', dw:0, dr:0, text:'FIRST TIME LOGGED'};
  const dw = +(cur.w - prev.w).toFixed(3), dr = cur.r - prev.r;
  if (dw > 0) return {kind:'heavier', dw, dr, text:`+${fmt(dw)} KG VS LAST TIME`};
  if (dw < 0) return {kind:'lighter', dw, dr, text:`${fmt(-dw)} KG LIGHTER THAN LAST TIME`};
  if (dr > 0) return {kind:'more_reps', dw, dr, text:`+${plural(dr, 'REP')} VS LAST TIME`};
  if (dr < 0) return {kind:'fewer_reps', dw, dr, text:`${plural(-dr, 'REP')} BELOW LAST TIME`};
  return {kind:'matched', dw, dr, text:'MATCHED LAST TIME'};
}

// personalRecordStatus for a Set 1 result against all earlier Set 1s (newest-first list).
function personalRecords(prior, cur, e){
  if (!prior.length) return [];
  const out = [];
  const maxW = Math.max(...prior.map(p => p.w));
  if (cur.w > maxW) out.push({type:'top_weight', text:'NEW TOP-SET WEIGHT', detail:`${fmt(cur.w)} kg × ${cur.r}`});
  const atW = prior.filter(p => p.w === cur.w);
  if (atW.length && cur.r > Math.max(...atW.map(p => p.r))) out.push({type:'reps_at_weight', text:`NEW BEST AT ${fmt(cur.w)} KG`, detail:`${cur.r} reps`});
  const e1 = epley(cur.w, cur.r), maxE1 = Math.max(...prior.map(p => epley(p.w, p.r)));
  if (e1 > maxE1 + 0.05) out.push({type:'e1rm', text:'NEW ESTIMATED 1RM', detail:`${e1.toFixed(1)} kg`});
  if (cur.r >= e.hi && !atW.some(p => p.r >= e.hi)) out.push({type:'first_top', text:'FIRST TIME AT THE TOP OF THE RANGE', detail:`${fmt(cur.w)} kg × ${cur.r}`});
  return out;
}

// exerciseImproved — decided by Set 1 only.
//   A same weight + more reps · B heavier while reps ≥ range minimum · C reached the top of the range
function exerciseImproved(prev, cur, e){
  if (!prev) return 'first';
  if (cur.w === prev.w && cur.r > prev.r) return 'improved';
  if (cur.w > prev.w && cur.r >= e.lo) return 'improved';
  if (cur.r >= e.hi) return 'improved';
  if (cur.w === prev.w && cur.r === prev.r) return 'matched';
  return 'unchanged';
}

// progressionStatus for a logged Set 1. prior = earlier Set 1s, newest first (today excluded).
function topSetResult(e, inc, cur, prior){
  const prev = prior[0] || null;
  const next = planSet1(cur, e, inc, prev);              // exactly what next session will recommend
  let status;
  if (cur.r >= e.hi) status = 'unlocked';
  else if (cur.r < e.lo && prev && cur.w > prev.w) status = 'missed';
  else if (cur.r < e.lo) status = 'below_range';
  else status = 'in_range';
  const repsUntilProgression = Math.max(0, e.hi - cur.r);
  const records = status === 'missed' ? [] : personalRecords(prior, cur, e);
  const comparison = compareSet(prev, cur);
  const range = `${e.lo}–${e.hi}`;
  let headline, lines;
  if (status === 'unlocked'){
    headline = 'TOP OF REP RANGE REACHED';
    lines = [`You reached ${cur.r} reps, the top of your ${range} range.`];
  } else if (status === 'missed'){
    headline = 'PROGRESSION ATTEMPT MISSED';
    lines = [`${cur.r} reps is below your ${e.lo}-rep minimum.`, `Today's back-off sets still use ${fmt(cur.w)} kg.`];
  } else if (status === 'below_range'){
    headline = comparison.kind === 'first' ? 'FIRST TIME LOGGED' : comparison.text;
    lines = [`${cur.r} reps is below your ${e.lo}-rep minimum.`];
  } else {
    const atW = records.find(r => r.type === 'reps_at_weight');
    headline = records.some(r => r.type === 'top_weight') ? 'NEW TOP-SET WEIGHT' : atW ? atW.text : comparison.text;
    lines = [`${cur.r} reps is within your ${range} range.`, `${plural(repsUntilProgression, 'more rep')} until weight increase.`];
  }
  if (status === 'below_range'){
    const atW = records.find(r => r.type === 'reps_at_weight');
    if (atW) headline = atW.text;
  }
  // One extra record line, only for records the headline doesn't already say.
  const shown = {top_weight: headline === 'NEW TOP-SET WEIGHT', reps_at_weight: headline.startsWith('NEW BEST AT'), first_top:false, e1rm:false};
  const extra = ['e1rm', 'first_top', 'reps_at_weight', 'top_weight'].map(t => records.find(r => r.type === t)).find(r => r && !shown[r.type] && !(r.type === 'reps_at_weight' && status === 'unlocked')) || null;
  return {status, comparison, nextPlan:next, nextTopSetWeight:next.weight, repsUntilProgression,
    progress:{reps:Math.min(cur.r, e.hi), target:e.hi}, records, recordLine:extra, improved:exerciseImproved(prev, cur, e), headline, lines};
}

// Back-off sets: "NEW BEST SET" when this set beats every earlier set with the same set number
// (by estimated 1RM, so a heavier set or more reps at the same weight both count). Needs history.
function backoffRecord(history, exId, idx, cur){
  const prior = history.map(s => s.entries && s.entries[exId] && s.entries[exId].sets && s.entries[exId].sets[idx]).filter(v => v && v.w != null && v.r != null);
  if (!prior.length) return null;
  const best = Math.max(...prior.map(v => epley(+v.w, +v.r)));
  return epley(cur.w, cur.r) > best + 0.05 ? {type:'best_set', text:'NEW BEST SET', detail:`${fmt(cur.w)} kg × ${cur.r}`} : null;
}

// What the next session does with Set 1, in one short line.
function nextTimeText(plan){
  if (plan.kind === 'increase') return `Set 1 increases to ${fmt(plan.weight)} kg`;
  if (plan.kind === 'rollback') return `Set 1 returns to ${fmt(plan.weight)} kg`;
  return `Set 1 stays at ${fmt(plan.weight)} kg`;
}

// Exercise completion summary. todayEntry = this workout's entry; history excludes today.
function exerciseSummary(e, inc, todayEntry, history){
  const pe = prevEntry(history, e.id);
  const sets = todayEntry.sets.map((s, i) => s ? {i, w:s.w, r:s.r, cmp:compareSet(pe && pe.sets[i], s)} : null).filter(Boolean);
  const gains = sets.filter(s => s.cmp.kind === 'more_reps' || s.cmp.kind === 'heavier')
    .map(s => s.cmp.kind === 'heavier' ? `+${fmt(s.cmp.dw)} kg on Set ${s.i+1}` : `+${plural(s.cmp.dr, 'rep')} on Set ${s.i+1}`);
  const s1 = todayEntry.sets[0];
  const top = s1 ? topSetResult(e, inc, s1, set1History(history, e.id)) : null;
  return {sets, gains, top, nextTime: top ? nextTimeText(top.nextPlan) : null, firstTime: !pe};
}

// Close-to-progression teasers from the latest Set 1 of each exercise.
function closeToProgression(history, exercises, incFor, maxReps = 2){
  return exercises.map(e => {
    const h = set1History(history, e.id); if (!h.length) return null;
    const last = h[0];
    if (last.r >= e.hi || last.r < e.lo) return null;
    const need = e.hi - last.r; if (need > maxReps) return null;
    return {exercise:e, last, need, unlocks: +(last.w + incFor(e.id)).toFixed(3)};
  }).filter(Boolean).sort((a,b) => a.need - b.need);
}

// workoutSummary for the recap. history must NOT include this workout yet.
function workoutSummary(day, entries, history, incFor){
  const list = PROGRAM[day] || [];
  const total = list.reduce((n, e) => n + e.sets, 0);
  const done = list.reduce((n, e) => n + (entries[e.id] ? entries[e.id].sets.filter(Boolean).length : 0), 0);
  const counts = {improved:0, matched:0, other:0, skipped:0};
  const highlights = [];
  const after = [{id:Infinity, date:new Date().toISOString(), day, entries}, ...history];
  list.forEach(e => {
    const s1 = entries[e.id] && entries[e.id].sets[0]; if (!s1){ counts.skipped++; return; }
    const t = topSetResult(e, incFor(e.id), s1, set1History(history, e.id));
    if (t.improved === 'improved') counts.improved++; else if (t.improved === 'matched') counts.matched++; else counts.other++;
    if (t.status === 'unlocked' || t.improved === 'improved' || t.records.length){
      highlights.push({name:e.name, set:`${fmt(s1.w)} kg × ${s1.r}`,
        change: t.comparison.kind === 'first' ? null : (t.comparison.kind === 'more_reps' || t.comparison.kind === 'heavier') ? t.comparison.text.replace(' VS LAST TIME','').toLowerCase() : null,
        record: t.records.find(r => r.type === 'top_weight' || r.type === 'e1rm') || null,
        next: t.status === 'unlocked' ? `Next time: ${fmt(t.nextTopSetWeight)} kg` : null,
        rank: t.status === 'unlocked' ? 0 : t.records.length ? 1 : 2});
    }
  });
  highlights.sort((a,b) => a.rank - b.rank);
  return {day, done, total, counts, highlights:highlights.slice(0, 5),
    close: closeToProgression(after, list, incFor).slice(0, 3), nextDay: nextDay(day)};
}

// Recent meaningful events, newest first, capped. One event per exercise per session.
function progressFeed(history, incFor, limit = 12){
  const sessions = [...history].sort((a,b) => a.id - b.id);
  const priorByEx = {}, countByDay = {}, events = [];
  sessions.forEach(s => {
    (PROGRAM[s.day] || []).forEach(e => {
      const s1 = s.entries[e.id] && s.entries[e.id].sets[0]; if (!s1) return;
      const prior = priorByEx[e.id] || [];
      if (prior.length){
        const t = topSetResult(e, incFor(e.id), s1, prior);
        let ev = null;
        if (t.status === 'unlocked') ev = {line:`${fmt(s1.w)} kg × ${s1.r}`, sub:`Next session: ${fmt(t.nextTopSetWeight)} kg`};
        else if (t.records.some(r => r.type === 'top_weight')) ev = {line:`New Set 1 weight: ${fmt(s1.w)} kg`, sub:`${s1.r} reps`};
        else if (t.comparison.kind === 'more_reps') ev = {line:`+${plural(t.comparison.dr, 'rep')} at ${fmt(s1.w)} kg`, sub:null};
        if (ev) events.push({date:s.date, id:s.id, title:e.name, ...ev});
      }
      priorByEx[e.id] = [{w:+s1.w, r:+s1.r, date:s.date, id:s.id}, ...prior];
    });
    if (PROGRAM[s.day]){
      countByDay[s.day] = (countByDay[s.day] || 0) + 1;
      if (countByDay[s.day] % 10 === 0) events.push({date:s.date, id:s.id, title:`${countByDay[s.day]} ${DAY_NAMES[s.day]} workouts completed`, line:null, sub:null});
    }
  });
  return events.reverse().slice(0, limit);
}

// =====================================================================
// STORAGE — LOCAL FIRST, SYNCED THROUGH SUPABASE.
// Every device keeps a full copy in its own browser storage (IndexedDB). The app reads and
// writes ONLY that local copy, so it is instant and works offline. When signed in, a second
// copy lives in Supabase (table ppl_records, private per user by row-level security), and the
// two are matched both ways.
//
// Matching rule: every record carries `_at` (when it last changed). For each record, the newer
// copy wins and is copied to the other side. Deleted body-weight entries stay as small
// "deleted" markers so a delete on one device also removes the entry on the other.
//
// Supabase rows: { user_id, kind: 'session'|'bw'|'kv', key, body, at }
// =====================================================================
const STORAGE = { mode:'local', state:'local', email:null, userId:null, lastSync:null, error:null, configured:false };
const _listeners = [];
function onStorageChange(cb){ _listeners.push(cb); }
function notify(kind){ _listeners.forEach(cb => { try{ cb(kind); }catch(e){} }); }
const nowMs = () => Date.now();
const KV_KEYS = ['meta', 'incs', 'active', 'restDays'];
function plain(o){ return JSON.parse(JSON.stringify(o)); }

// ---------- local copy (IndexedDB) ----------
let dbp = null;
function openDB(){
  return new Promise((res, rej) => {
    try{
      const r = indexedDB.open('ppl-coach', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', {keyPath:'id'});
        if (!d.objectStoreNames.contains('bodyweight')) d.createObjectStore('bodyweight', {keyPath:'id'});
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }catch(e){ rej(e); }
  });
}
function tx(store, mode, fn){
  return dbp.then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}
const LOCAL = {
  kvGet: k => tx('kv','readonly', s => s.get(k)),
  kvSet: (k, v) => tx('kv','readwrite', s => s.put(v, k)),
  getSessions: () => tx('sessions','readonly', s => s.getAll()),
  putSession: sess => tx('sessions','readwrite', s => s.put(sess)),
  getBW: () => tx('bodyweight','readonly', s => s.getAll()),
  putBW: e => tx('bodyweight','readwrite', s => s.put(e))
};
const _chains = {};
function queued(path, fn){
  const next = (_chains[path] || Promise.resolve()).catch(() => {}).then(fn);
  _chains[path] = next;
  return next;
}
// When each kv value last changed on this device (kept in the kv store under '__at').
function setLocalAt(k, t){
  return queued('local:__at', async () => { const m = (await LOCAL.kvGet('__at')) || {}; m[k] = t; await LOCAL.kvSet('__at', m); });
}
async function getLocalAt(){ return (await LOCAL.kvGet('__at')) || {}; }

// ---------- Supabase ----------
let sb = null;
const TABLE = 'ppl_records';
const signedIn = () => STORAGE.mode === 'sync' && !!STORAGE.userId;
async function remoteAll(){
  const out = []; const page = 1000;
  for (let from = 0; from < 200000; from += page){
    const { data, error } = await sb.from(TABLE).select('kind,key,body,at').order('kind').order('key').range(from, from + page - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < page) break;
  }
  return out;
}
async function remoteUpsert(rows){
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 500){
    const chunk = rows.slice(i, i + 500).map(r => ({ user_id:STORAGE.userId, ...r }));
    const { error } = await sb.from(TABLE).upsert(chunk, { onConflict:'user_id,kind,key' });
    if (error) throw error;
  }
}
// Send one change right away when signed in. A failure is fine: the next sync compares
// everything and sends whatever Supabase is missing.
function pushRow(kind, key, body, at){
  if (!signedIn()) return;
  queued('remote:' + kind + ':' + key, () => remoteUpsert([{kind, key:String(key), body, at}]))
    .then(() => { STORAGE.lastSync = nowMs(); STORAGE.state = 'synced'; notify('status'); })
    .catch(() => { STORAGE.state = 'offline'; notify('status'); });
}

// ---------- the functions the app calls (always local first) ----------
const kvGet = k => LOCAL.kvGet(k);
async function kvSet(k, v){
  const t = nowMs(), val = v == null ? null : plain(v);
  await LOCAL.kvSet(k, val); await setLocalAt(k, t);
  pushRow('kv', k, {v:val}, t);
}
const getSessions = () => LOCAL.getSessions();
async function putSession(s){
  const rec = {...plain(s), _at:nowMs()};
  await LOCAL.putSession(rec);
  pushRow('session', rec.id, rec, rec._at);
}
async function getBW(){ return (await LOCAL.getBW()).filter(e => !e.deleted); }
async function putBW(e){
  const rec = {...plain(e), _at:nowMs()}; delete rec.deleted;
  await LOCAL.putBW(rec);
  pushRow('bw', rec.id, rec, rec._at);
}
async function delBW(id){
  const rec = {id, deleted:true, _at:nowMs()};
  await LOCAL.putBW(rec);
  pushRow('bw', id, rec, rec._at);
}

// ---------- two-way sync ----------
let _syncing = null;
function syncNow(){
  if (!signedIn()) return Promise.resolve(null);
  if (_syncing) return _syncing;
  if (typeof navigator !== 'undefined' && navigator.onLine === false){ STORAGE.state = 'offline'; notify('status'); return Promise.resolve(null); }
  STORAGE.state = 'syncing'; notify('status');
  _syncing = (async () => {
    let pulled = 0, pushed = 0;
    try{
      const remote = await remoteAll();
      const rIdx = { session:new Map(), bw:new Map(), kv:new Map() };
      remote.forEach(r => rIdx[r.kind] && rIdx[r.kind].set(String(r.key), r));
      const toPush = [];
      for (const [kind, lget, lput] of [['session', LOCAL.getSessions, LOCAL.putSession], ['bw', LOCAL.getBW, LOCAL.putBW]]){
        const local = await lget(), lMap = new Map(local.map(x => [String(x.id), x]));
        for (const [key, r] of rIdx[kind]){
          const l = lMap.get(key);
          if (!l || (r.at || 0) > (l._at || 0)){ await lput({...r.body, _at:r.at}); pulled++; }
        }
        for (const l of local){
          const r = rIdx[kind].get(String(l.id));
          if (!r || (l._at || 0) > (r.at || 0)) toPush.push({kind, key:String(l.id), body:l, at:l._at || 0});
        }
      }
      const at = await getLocalAt();
      for (const k of KV_KEYS){
        const r = rIdx.kv.get(k), lv = await LOCAL.kvGet(k), la = at[k] || 0;
        if (r && (lv === undefined || (r.at || 0) > la)){ await LOCAL.kvSet(k, r.body ? r.body.v ?? null : null); await setLocalAt(k, r.at || 0); pulled++; }
        else if (lv !== undefined && (!r || la > (r.at || 0))) toPush.push({kind:'kv', key:k, body:{v:lv}, at:la});
      }
      await remoteUpsert(toPush); pushed = toPush.length;
      STORAGE.lastSync = nowMs(); STORAGE.state = 'synced'; STORAGE.error = null;
    }catch(e){
      STORAGE.state = 'offline'; STORAGE.error = String(e && (e.message || e.code) || e);
    }
    _syncing = null;
    notify('status');
    if (pulled) notify('data');
    return {pulled, pushed};
  })();
  return _syncing;
}

// ---------- sign in ----------
function setUser(session){
  if (session && session.user){
    const changed = STORAGE.userId !== session.user.id;
    STORAGE.userId = session.user.id; STORAGE.email = session.user.email || null; STORAGE.mode = 'sync';
    if (changed) syncNow();
  } else {
    STORAGE.userId = null; STORAGE.email = null; STORAGE.mode = 'local'; STORAGE.state = 'local';
  }
  notify('status');
}
async function signIn(email, password){
  if (!sb) throw new Error('Sync isn’t set up in this copy of the app.');
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  setUser(data.session); return data.session;
}
async function signUp(email, password){
  if (!sb) throw new Error('Sync isn’t set up in this copy of the app.');
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  if (!data.session) throw new Error('Account created. Check your email to confirm it, then sign in.');
  setUser(data.session); return data.session;
}
async function signOut(){ if (sb) await sb.auth.signOut(); setUser(null); }

// Opens the local copy right away (the app renders from it at once), then connects to
// Supabase in the background. The page never waits for the network.
let _wired = false;
async function initDB(){
  dbp = openDB(); await dbp;
  try{ navigator.storage && navigator.storage.persist && navigator.storage.persist(); }catch(e){}
  const cfg = window.PPL_CONFIG || {};
  if (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient){
    STORAGE.configured = true;
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:false } });
    sb.auth.onAuthStateChange((_ev, session) => setUser(session));
    sb.auth.getSession().then(({ data }) => setUser(data && data.session)).catch(() => {});
  }
  if (!_wired){
    _wired = true;
    try{
      window.addEventListener('online', () => syncNow());
      window.addEventListener('offline', () => { if (signedIn()){ STORAGE.state = 'offline'; notify('status'); } });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
      setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 120000);
    }catch(e){}
  }
  return STORAGE;
}

// ---------- backup & restore ----------
const BACKUP_VERSION = 1;
async function exportAll(){
  const [meta, incs, active, restDays, sessions, bodyweight] = await Promise.all([kvGet('meta'), kvGet('incs'), kvGet('active'), kvGet('restDays'), getSessions(), getBW()]);
  const strip = x => { const c = plain(x); delete c._at; return c; };
  return {app:'ppl-coach', version:BACKUP_VERSION, exportedAt:new Date().toISOString(),
    meta: meta ?? null, incs: incs ?? null, active: active ?? null, restDays: restDays ?? [], sessions:(sessions || []).map(strip), bodyweight:(bodyweight || []).map(strip)};
}
function checkBackup(b){
  if (!b || typeof b !== 'object' || b.app !== 'ppl-coach') return 'This file is not a PPL Coach backup.';
  if (!Array.isArray(b.sessions) || !Array.isArray(b.bodyweight)) return 'The backup is missing its workouts or body-weight list.';
  if (b.sessions.some(s => !s || typeof s.id !== 'number' || !s.entries || !s.day)) return 'Some workouts in the backup are damaged.';
  if (b.bodyweight.some(e => !e || typeof e.id !== 'number' || typeof e.weightKg !== 'number' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || ''))) return 'Some body-weight entries in the backup are damaged.';
  return null;
}
async function importAll(b){
  const err = checkBackup(b); if (err) throw new Error(err);
  for (const s of b.sessions) await putSession(s);
  for (const e of b.bodyweight) await putBW(e);
  if (b.meta) await kvSet('meta', b.meta);
  if (b.incs) await kvSet('incs', b.incs);
  if (Array.isArray(b.restDays)) await kvSet('restDays', b.restDays);
  return {sessions:b.sessions.length, bodyweight:b.bodyweight.length};
}

function num(v){ const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; }
function int(v){ const n = parseInt(v, 10); return isFinite(n) ? n : null; }
window.PPL = {ROTATION, DAY_NAMES, CATS, BACKOFF, DEFAULT_INC, PROGRAM, ALL_EX, EX_BY_ID, nextDay, fmt, fmt2, fmtTime, roundTo, pctLabel,
  planSet1, warmup, backoff, restFor, findPrevSet1, dateKey, daysInMonth, epley, set1Series, bodyWeightFor, getStrengthPercentile, percentileLabel,
  set1History, prevEntry, planFromHistory, plural, compareSet, personalRecords, exerciseImproved, topSetResult, backoffRecord, nextTimeText,
  exerciseSummary, closeToProgression, workoutSummary, progressFeed, kvGet, kvSet, getSessions, putSession, getBW, putBW, delBW, plain, initDB, num, int,
  STORAGE, exportAll, importAll, checkBackup, syncNow, onStorageChange, signIn, signUp, signOut};
