// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Utilities ----
function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

// Normalize input processes
// Each process: { pid, arrivalTime, burstTime, priority?, timeQuantum?, queueIndex? }
function normalizeProcesses(list) {
  return list.map(p => ({
    pid: String(p.pid),
    arrivalTime: Number(p.arrivalTime),
    burstTime: Number(p.burstTime),
    priority: (p.priority === undefined || p.priority === null || p.priority === "") ? 0 : Number(p.priority),
    timeQuantum: (p.timeQuantum === undefined || p.timeQuantum === null || p.timeQuantum === "") ? null : Number(p.timeQuantum),
    queueIndex: p.queueIndex !== undefined ? Number(p.queueIndex) : 0
  })).sort((a,b) => a.arrivalTime - b.arrivalTime);
}

function computeMetricsFromTimeline(processes, timeline) {
  // timeline: [{pid,start,end}] including 'IDLE'
  const pMap = {};
  processes.forEach(p => pMap[p.pid] = { ...p, remaining: p.burstTime });

  const firstStart = {};
  const finishTime = {};
  let busy = 0;
  let makespan = 0;

  for (const seg of timeline) {
    makespan = Math.max(makespan, seg.end);
    if (seg.pid !== 'IDLE') busy += (seg.end - seg.start);

    if (seg.pid !== 'IDLE') {
      if (!(seg.pid in firstStart)) firstStart[seg.pid] = seg.start;
      pMap[seg.pid].remaining -= (seg.end - seg.start);
      if (pMap[seg.pid].remaining <= 0) finishTime[seg.pid] = seg.end;
    }
  }

  const perProcess = processes.map(p => {
    const tat = (finishTime[p.pid] ?? 0) - p.arrivalTime;
    const rt  = (firstStart[p.pid] ?? 0) - p.arrivalTime;
    const wt  = tat - p.burstTime;
    return { pid: p.pid, arrivalTime: p.arrivalTime, burstTime: p.burstTime, priority: p.priority, TAT: tat, WT: wt, RT: rt };
  });

  const avgTAT = perProcess.reduce((s,p)=>s+p.TAT,0)/perProcess.length || 0;
  const avgWT  = perProcess.reduce((s,p)=>s+p.WT,0)/perProcess.length || 0;
  const utilization = makespan ? (busy / makespan) * 100 : 0;

  return {
    perProcess,
    aggregate: { averageTAT: avgTAT, averageWT: avgWT, cpuUtilization: utilization, makespan }
  };
}

// ---- Core Schedulers ----
// All return: { timeline: [{pid,start,end}], meta?: {} }

function fcfs(processes) {
  const procs = deepClone(normalizeProcesses(processes));
  let t = 0;
  const timeline = [];
  for (const p of procs) {
    if (t < p.arrivalTime) {
      timeline.push({ pid: 'IDLE', start: t, end: p.arrivalTime });
      t = p.arrivalTime;
    }
    timeline.push({ pid: p.pid, start: t, end: t + p.burstTime });
    t += p.burstTime;
  }
  return { timeline };
}

function nonPreemptiveSelect(processes, comparator) {
  const arr = deepClone(normalizeProcesses(processes));
  const timeline = [];
  let t = 0;
  const done = new Set();

  while (done.size < arr.length) {
    const ready = arr.filter(p => !done.has(p.pid) && p.arrivalTime <= t);
    if (ready.length === 0) {
      const next = arr.filter(p => !done.has(p.pid)).sort((a,b) => a.arrivalTime - b.arrivalTime)[0];
      if (t < next.arrivalTime) {
        timeline.push({ pid:'IDLE', start: t, end: next.arrivalTime });
        t = next.arrivalTime;
      }
      continue;
    }
    ready.sort(comparator);
    const p = ready[0];
    timeline.push({ pid: p.pid, start: t, end: t + p.burstTime });
    t += p.burstTime;
    done.add(p.pid);
  }
  return { timeline };
}

function preemptiveTick(processes, pickFn) {
  const arr = deepClone(normalizeProcesses(processes)).map(p => ({...p, remaining: p.burstTime}));
  const timeline = [];
  let t = 0;
  let completed = 0;
  let currentPid = null;
  let segStart = 0;

  while (completed < arr.length) {
    const ready = arr.filter(p => p.arrivalTime <= t && p.remaining > 0);
    let next = null;
    if (ready.length > 0) {
      next = pickFn(ready);
      if (currentPid !== next.pid) {
        if (currentPid !== null) timeline.push({ pid: currentPid, start: segStart, end: t });
        currentPid = next.pid;
        segStart = t;
      }
      next.remaining -= 1;
      t += 1;
      if (next.remaining === 0) {
        timeline.push({ pid: next.pid, start: segStart, end: t });
        currentPid = null;
        completed += 1;
      }
    } else {
      const nextArrival = Math.min(...arr.filter(p=>p.remaining>0).map(p=>p.arrivalTime));
      const end = Math.max(t+1, nextArrival);
      timeline.push({ pid:'IDLE', start: t, end });
      t = end;
      currentPid = null;
    }
  }
  return { timeline };
}

function sjfNP(processes) {
  return nonPreemptiveSelect(processes, (a,b) => a.burstTime - b.burstTime || a.arrivalTime - b.arrivalTime);
}
function ljfNP(processes) {
  return nonPreemptiveSelect(processes, (a,b) => b.burstTime - a.burstTime || a.arrivalTime - b.arrivalTime);
}
function priorityNP(processes) {
  // lower number => higher priority
  return nonPreemptiveSelect(processes, (a,b) => a.priority - b.priority || a.arrivalTime - b.arrivalTime);
}
function srtf(processes) {
  return preemptiveTick(processes, (ready) => ready.sort((a,b)=>a.remaining - b.remaining || a.arrivalTime - b.arrivalTime)[0]);
}
function sjfPreemptive(processes){ return srtf(processes); }
function ljfPreemptive(processes) {
  return preemptiveTick(processes, (ready) => ready.sort((a,b)=>b.remaining - a.remaining || a.arrivalTime - b.arrivalTime)[0]);
}
function priorityPreemptive(processes) {
  return preemptiveTick(processes, (ready) => ready.sort((a,b)=>a.priority - b.priority || a.arrivalTime - b.arrivalTime)[0]);
}
function roundRobin(processes, quantumFallback=1) {
  const arr = deepClone(normalizeProcesses(processes)).map(p => ({...p, remaining: p.burstTime}));
  const timeline = [];
  let t = 0;
  const queue = [];
  const arrived = new Set();

  const pushArrivals = () => {
    arr.forEach(p=>{
      if (!arrived.has(p.pid) && p.arrivalTime <= t) {
        queue.push(p.pid);
        arrived.add(p.pid);
      }
    });
  };

  pushArrivals();
  while (arr.some(p=>p.remaining>0)) {
    if (queue.length === 0) {
      const nextArrival = Math.min(...arr.filter(p=>p.remaining>0).map(p=>p.arrivalTime));
      if (t < nextArrival) {
        timeline.push({ pid:'IDLE', start:t, end: nextArrival });
        t = nextArrival;
      }
      pushArrivals();
      continue;
    }
    const pid = queue.shift();
    const p = arr.find(x=>x.pid===pid);
    const q = p.timeQuantum || quantumFallback;
    const start = t;
    let spent = 0;
    while (spent < q && p.remaining > 0) {
      t += 1;
      spent += 1;
      p.remaining -= 1;
      pushArrivals();
    }
    timeline.push({ pid: p.pid, start, end: t });
    if (p.remaining > 0) queue.push(p.pid);
  }
  return { timeline };
}

// ---- Multilevel Queue (strict priority + cross-queue preemption) ----
// options: { queues: [{algo, quantum?}], count }
function multilevelQueue(processes, options) {
  const Q = (options.queues || []).map(q => ({
    algo: String(q.algo || 'FCFS').toUpperCase(),
    quantum: Number(q.quantum || 1)
  }));
  const ps = normalizeProcesses(processes).map(p => ({
    ...p,
    remaining: p.burstTime,
    queueIndex: Number(p.queueIndex || 0),
    enqOrder: 0, // FCFS fairness within queue
  }));
  let t = 0;
  let orderCounter = 0;
  const timeline = [];

  const allDone = () => ps.every(p => p.remaining === 0);
  const nextArrival = () => {
    const a = ps.filter(p => p.remaining > 0 && p.arrivalTime > t).map(p => p.arrivalTime);
    return a.length ? Math.min(...a) : Infinity;
  };

  // Per-queue RR state
  const rrState = Q.map(() => ({ fifo: [], quantumLeft: 0, currentPid: null }));

  const pushArrivals = () => {
    ps.forEach(p => {
      if (p.remaining > 0 && p.arrivalTime === t) {
        p.enqOrder = orderCounter++;
        const qi = p.queueIndex;
        if (Q[qi] && Q[qi].algo === 'RR') {
          const s = rrState[qi];
          if (!s.fifo.includes(p.pid)) s.fifo.push(p.pid);
        }
      }
    });
  };

  const topReadyQueue = () => {
    for (let qi = 0; qi < Q.length; qi++) {
      const algo = Q[qi].algo;
      let ready = ps.filter(p => p.queueIndex === qi && p.arrivalTime <= t && p.remaining > 0);
      if (algo === 'RR') {
        const s = rrState[qi];
        ready = ready.filter(p => s.fifo.includes(p.pid));
      }
      if (ready.length > 0) return qi;
    }
    return -1;
  };

  const pickInQueue = (qi) => {
    const algo = Q[qi].algo;
    const ready = ps.filter(p => p.queueIndex === qi && p.arrivalTime <= t && p.remaining > 0);
    if (algo === 'FCFS') return ready.sort((a,b) => a.enqOrder - b.enqOrder || a.arrivalTime - b.arrivalTime)[0];
    if (algo === 'SJF')  return ready.sort((a,b) => a.remaining - b.remaining || a.enqOrder - b.enqOrder)[0];
    if (algo === 'LJF')  return ready.sort((a,b) => b.remaining - a.remaining || a.enqOrder - b.enqOrder)[0];
    if (algo === 'SRTF') return ready.sort((a,b) => a.remaining - b.remaining || a.arrivalTime - b.arrivalTime)[0];
    if (algo === 'RR') {
      const s = rrState[qi];
      if (s.currentPid === null) {
        while (s.fifo.length && ps.find(p => p.pid === s.fifo[0]).remaining === 0) s.fifo.shift();
        const idx = s.fifo.findIndex(pid => {
          const p = ps.find(x => x.pid === pid);
          return p && p.arrivalTime <= t && p.remaining > 0;
        });
        if (idx === -1) return null;
        s.fifo.push(...s.fifo.splice(0, idx));
        s.currentPid = s.fifo[0];
        s.quantumLeft = Q[qi].quantum;
      }
      const p = ps.find(x => x.pid === s.currentPid);
      if (!p || p.remaining === 0 || p.arrivalTime > t) {
        s.currentPid = null;
        return pickInQueue(qi);
      }
      return p;
    }
    return ready[0] || null;
  };

  const pushTick = (pid, start, end, qi) => {
    const last = timeline[timeline.length - 1];
    if (last && last.pid === pid && last.end === start) {
      last.end = end;
    } else {
      timeline.push({ pid, start, end, queue: qi });
    }
  };

  while (!allDone()) {
    // ✅ Enqueue arrivals before checking the ready queues
    pushArrivals();

    let qi = topReadyQueue();
    if (qi === -1) {
      const na = nextArrival();
      if (!isFinite(na)) break;
      pushTick('IDLE', t, na, null);
      t = na;
      // arrivals at 'na' will be pushed at the top of the next iteration
      continue;
    }

    const algo = Q[qi].algo;
    const p = pickInQueue(qi);
    if (!p) { t += 1; continue; }

    const start = t;
    t += 1;            // run for exactly 1 tick -> enables cross-queue preemption
    p.remaining -= 1;
    pushTick(p.pid, start, t, qi);

    if (algo === 'RR') {
      const s = rrState[qi];
      s.quantumLeft -= 1;
      if (p.remaining === 0) {
        s.fifo = s.fifo.filter(pid => pid !== p.pid);
        s.currentPid = null;
      } else if (s.quantumLeft === 0) {
        s.fifo.push(s.fifo.shift());
        s.currentPid = null;
      }
    }
  }

  return { timeline, meta: { queues: Q.length } };
}

// ---- Multilevel Feedback Queue (strict priority, RR demotion, cross-queue preemption) ----
// options: { queues: [{algo, quantum?}], count }
function mlfq(processes, options) {
  const Q = (options.queues || []).map(q => ({
    algo: String(q.algo || 'RR').toUpperCase(),
    quantum: Number(q.quantum || 1)
  }));
  const ps = normalizeProcesses(processes).map(p => ({
    ...p,
    remaining: p.burstTime,
    queueIndex: 0,
    entered: p.arrivalTime,
  }));
  let t = 0;
  const timeline = [];
  const rrState = Q.map(() => ({ fifo: [], currentPid: null, quantumLeft: 0 }));

  const allDone = () => ps.every(p => p.remaining === 0);
  const nextArrival = () => {
    const a = ps.filter(p => p.remaining > 0 && p.arrivalTime > t).map(p => p.arrivalTime);
    return a.length ? Math.min(...a) : Infinity;
  };

  const pushArrivals = () => {
    ps.forEach(p => {
      if (p.remaining > 0 && p.arrivalTime === t) {
        p.queueIndex = 0;
        p.entered = t;
        if (Q[0] && Q[0].algo === 'RR' && !rrState[0].fifo.includes(p.pid)) {
          rrState[0].fifo.push(p.pid);
        }
      }
    });
  };

  const topReadyQueue = () => {
    for (let qi = 0; qi < Q.length; qi++) {
      const algo = Q[qi].algo;
      let ready = ps.filter(p => p.queueIndex === qi && p.arrivalTime <= t && p.remaining > 0);
      if (algo === 'RR') {
        const s = rrState[qi];
        ready = ready.filter(p => s.fifo.includes(p.pid));
      }
      if (ready.length) return qi;
    }
    return -1;
  };

  const pickInQueue = (qi) => {
    const algo = Q[qi].algo;
    const ready = ps.filter(p => p.queueIndex === qi && p.arrivalTime <= t && p.remaining > 0);
    if (algo === 'FCFS') return ready.sort((a,b)=>a.entered - b.entered || a.arrivalTime - b.arrivalTime)[0];
    if (algo === 'SJF')  return ready.sort((a,b)=>a.remaining - b.remaining || a.entered - b.entered)[0];
    if (algo === 'LJF')  return ready.sort((a,b)=>b.remaining - a.remaining || a.entered - b.entered)[0];
    if (algo === 'SRTF') return ready.sort((a,b)=>a.remaining - b.remaining || a.entered - b.entered)[0];
    if (algo === 'RR') {
      const s = rrState[qi];
      if (s.currentPid === null) {
        while (s.fifo.length && ps.find(p => p.pid === s.fifo[0]).remaining === 0) s.fifo.shift();
        const idx = s.fifo.findIndex(pid => {
          const p = ps.find(x => x.pid === pid);
          return p && p.arrivalTime <= t && p.remaining > 0;
        });
        if (idx === -1) return null;
        s.fifo.push(...s.fifo.splice(0, idx));
        s.currentPid = s.fifo[0];
        s.quantumLeft = Q[qi].quantum;
      }
      return ps.find(x => x.pid === s.currentPid) || null;
    }
    return ready[0] || null;
  };

  const pushTick = (pid, start, end, qi) => {
    const last = timeline[timeline.length - 1];
    if (last && last.pid === pid && last.end === start) last.end = end;
    else timeline.push({ pid, start, end, queue: qi });
  };

  while (!allDone()) {
    // ✅ Enqueue arrivals before checking the ready queues
    pushArrivals();

    let qi = topReadyQueue();
    if (qi === -1) {
      const na = nextArrival();
      if (!isFinite(na)) break;
      pushTick('IDLE', t, na, null);
      t = na;
      // arrivals at 'na' will be pushed at the top of the next iteration
      continue;
    }

    const algo = Q[qi].algo;
    const p = pickInQueue(qi);
    if (!p) { t += 1; continue; }

    const start = t;
    t += 1;          // 1-tick commitment allows cross-queue preemption next tick
    p.remaining -= 1;
    pushTick(p.pid, start, t, qi);

    if (algo === 'RR') {
      const s = rrState[qi];
      s.quantumLeft -= 1;
      if (p.remaining === 0) {
        s.fifo = s.fifo.filter(pid => pid !== p.pid);
        s.currentPid = null;
      } else if (s.quantumLeft === 0) {
        // demote on quantum expiry
        const nextQ = Math.min(qi + 1, Q.length - 1);
        p.queueIndex = nextQ;
        p.entered = t;
        // rotate current queue
        s.fifo.push(s.fifo.shift());
        s.currentPid = null;
        // enqueue into next RR queue if applicable
        if (Q[nextQ].algo === 'RR') {
          const s2 = rrState[nextQ];
          if (!s2.fifo.includes(p.pid)) s2.fifo.push(p.pid);
        }
      }
    }
    // Non-RR queues: no auto demotion; SRTF handled via per-tick repick.
  }

  return { timeline, meta: { queues: Q.length } };
}

// ---- Router ----
app.post('/api/simulate', (req, res) => {
  try {
    const { processes = [], algorithm, options = {} } = req.body || {};
    const algo = (algorithm || 'FCFS').toUpperCase();
    const preemptive = !!options.preemptive;
    const quantum = Number(options.quantum || 1);

    let result;
    if (algo === 'FCFS') result = fcfs(processes);
    else if (algo === 'SJF' && !preemptive) result = sjfNP(processes);
    else if (algo === 'SJF' && preemptive) result = sjfPreemptive(processes);
    else if (algo === 'LJF' && !preemptive) result = ljfNP(processes);
    else if (algo === 'LJF' && preemptive) result = ljfPreemptive(processes);
    else if (algo === 'SRTF') result = srtf(processes);
    else if (algo === 'ROUND ROBIN' || algo === 'RR') result = roundRobin(processes, quantum);
    else if (algo === 'PRIORITY' && !preemptive) result = priorityNP(processes);
    else if (algo === 'PRIORITY' && preemptive) result = priorityPreemptive(processes);
    else if (algo === 'MLQ' || algo === 'MULTILEVEL QUEUE') result = multilevelQueue(processes, options);
    else if (algo === 'MLFQ' || algo === 'MULTILEVEL FEEDBACK QUEUE') result = mlfq(processes, options);
    else result = fcfs(processes);

    const metrics = computeMetricsFromTimeline(normalizeProcesses(processes), result.timeline);
    res.json({
      ok: true,
      timeline: result.timeline,
      metrics: metrics.perProcess,
      aggregate: metrics.aggregate,
      meta: result.meta || {}
    });
  } catch (e) {
    console.error(e);
    res.status(400).json({ ok:false, error: e.message || 'Simulation error' });
  }
});

// ---- Start ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CPU Scheduling Visualizer listening on http://localhost:${PORT}`);
});
