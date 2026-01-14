// app.js

// --------- UI Helpers ---------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel)=> Array.from(document.querySelectorAll(sel));

const procBody = $('#procBody');
const queueHead = $('#queueHead');
const algorithmSel = $('#algorithm');
const preemptiveWrap = $('#preemptiveWrap');
const preemptiveCheck = $('#preemptive');
const rrQuantumWrap = $('#rrQuantumWrap');
const rrQuantumInput = $('#rrQuantum');
const multiConfig = $('#multiConfig');
const queueCountInput = $('#queueCount');
const buildQueuesBtn = $('#buildQueues');
const queuesArea = $('#queuesArea');

let rowCounter = 1;


// Reset
$('#resetBtn').addEventListener('click', ()=>{
  procBody.innerHTML = '';
  rowCounter = 1;
  clearGantt();
  clearMetrics();
  queuesArea.innerHTML = '';
});

// Sample data
$('#sampleData').addEventListener('click', ()=>{
  procBody.innerHTML = '';
  [
    {pid:'P1', arrival:0, burst:7, priority:2},
    {pid:'P2', arrival:2, burst:4, priority:1},
    {pid:'P3', arrival:4, burst:1, priority:3},
    {pid:'P4', arrival:5, burst:4, priority:2}
  ].forEach(addRowFromData);
});

// Add row
$('#addRow').addEventListener('click', ()=>addRowFromData({
  pid:`P${rowCounter++}`,
  arrival:0,
  burst:1,
  priority:1,
  tq:''
}));

function addRowFromData(d){
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="p-2"><input class="pid w-24 p-1 rounded border dark:bg-gray-900 dark:border-gray-700" value="${d.pid||''}"></td>
    <td class="p-2"><input type="number" min="0" class="arrival w-24 p-1 rounded border dark:bg-gray-900 dark:border-gray-700" value="${d.arrival??0}"></td>
    <td class="p-2"><input type="number" min="1" class="burst w-24 p-1 rounded border dark:bg-gray-900 dark:border-gray-700" value="${d.burst??1}"></td>
    <td class="p-2"><input type="number" class="priority w-24 p-1 rounded border dark:bg-gray-900 dark:border-gray-700" value="${d.priority??0}"></td>
    <td class="p-2"><input type="number" min="1" class="tq w-28 p-1 rounded border dark:bg-gray-900 dark:border-gray-700" value="${d.tq??''}" placeholder="(optional)"></td>
    <td class="p-2" ${queueHead.style.display==='none'?'style="display:none"':''}>
      <input type="number" min="0" class="queueIdx w-24 p-1 rounded border dark:bg-gray-900 dark:border-gray-700" value="${d.queueIndex??0}">
    </td>
    <td class="p-2">
      <button class="del px-2 py-1 rounded bg-rose-600 text-white">Delete</button>
    </td>
  `;
  procBody.appendChild(tr);
  tr.querySelector('.del').addEventListener('click', ()=>tr.remove());
}

// Algorithm-dependent UI
algorithmSel.addEventListener('change', refreshAlgoUI);
function refreshAlgoUI(){
  const val = algorithmSel.value;
  preemptiveWrap.classList.add('hidden');
  rrQuantumWrap.classList.add('hidden');
  multiConfig.classList.add('hidden');
  queueHead.style.display = 'none';
  $$('.queueIdx').forEach(i=>i.closest('td').style.display='none');

  if (val.includes('Preemptive') || val === 'Priority (Preemptive)') {
    preemptiveWrap.classList.remove('hidden');
    preemptiveCheck.checked = true;
  } else {
    preemptiveCheck.checked = false;
  }
  if (val === 'Round Robin') rrQuantumWrap.classList.remove('hidden');

  if (val === 'Multilevel Queue' || val === 'Multilevel Feedback Queue') {
    multiConfig.classList.remove('hidden');
    queueHead.style.display = '';
    $$('.queueIdx').forEach(i=>i.closest('td').style.display='');
  }
}
refreshAlgoUI();

// Build per-queue config UI
buildQueuesBtn.addEventListener('click', ()=>{
  const count = Math.max(1, Math.min(6, Number(queueCountInput.value)||1));
  queuesArea.innerHTML = '';
  for (let i=0;i<count;i++){
    const div = document.createElement('div');
    div.className = 'border rounded-lg p-3';
    div.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="font-medium">Queue ${i} (0 = highest priority)</div>
        <select class="qAlgo rounded border p-2 dark:bg-gray-900 dark:border-gray-700">
          <option>RR</option>
          <option>FCFS</option>
          <option>SJF</option>
          <option>SRTF</option>
          <option>LJF</option>
        </select>
        <div class="flex items-center gap-2 qQuantumWrap">
          <span class="text-sm">Quantum</span>
          <input type="number" min="1" value="${i===0?2:4}" class="qQuantum w-24 rounded border p-2 dark:bg-gray-900 dark:border-gray-700"/>
        </div>
      </div>
    `;
    queuesArea.appendChild(div);
    const algoSel = div.querySelector('.qAlgo');
    const qWrap = div.querySelector('.qQuantumWrap');
    algoSel.addEventListener('change', ()=>{
      if (algoSel.value === 'RR') qWrap.style.display = '';
      else qWrap.style.display = 'none';
    });
  }
});

// Gather form data
function collectProcesses(){
  const rows = $$('#procBody tr');
  return rows.map(r=>{
    const pid = r.querySelector('.pid').value.trim();
    const arrivalTime = Number(r.querySelector('.arrival').value||0);
    const burstTime = Number(r.querySelector('.burst').value||0);
    const priority = Number(r.querySelector('.priority').value||0);
    const tqv = r.querySelector('.tq').value;
    const timeQuantum = tqv===''? null : Number(tqv);
    const qEl = r.querySelector('.queueIdx');
    const queueIndex = qEl && qEl.closest('td').style.display!== 'none' ? Number(qEl.value||0) : 0;
    return { pid, arrivalTime, burstTime, priority, timeQuantum, queueIndex };
  }).filter(p=>p.pid && p.burstTime>0);
}

function collectMultiOptions(){
  const boxes = $$('#queuesArea > div');
  const queues = boxes.map(b=>{
    const algo = b.querySelector('.qAlgo').value;
    const quantEl = b.querySelector('.qQuantum');
    const q = quantEl ? Number(quantEl.value||1) : 1;
    return { algo, quantum: algo==='RR'? q : undefined };
  });
  return { queues, count: queues.length };
}

// Simulate
$('#simulateBtn').addEventListener('click', async ()=>{
  const processes = collectProcesses();
  if (processes.length === 0) {
    alert('Please add at least one process.');
    return;
  }
  const algoVal = algorithmSel.value;
  let payloadAlgo = 'FCFS';
  let options = {};

  switch (algoVal) {
    case 'FCFS': payloadAlgo = 'FCFS'; break;
    case 'SJF (Non-Preemptive)': payloadAlgo = 'SJF'; options.preemptive = false; break;
    case 'SJF (Preemptive)': payloadAlgo = 'SJF'; options.preemptive = true; break;
    case 'LJF (Non-Preemptive)': payloadAlgo = 'LJF'; options.preemptive = false; break;
    case 'LJF (Preemptive)': payloadAlgo = 'LJF'; options.preemptive = true; break;
    case 'SRTF': payloadAlgo = 'SRTF'; break;
    case 'Round Robin': payloadAlgo = 'RR'; options.quantum = Number(rrQuantumInput.value || 2); break;
    case 'Priority (Non-Preemptive)': payloadAlgo = 'PRIORITY'; options.preemptive = false; break;
    case 'Priority (Preemptive)': payloadAlgo = 'PRIORITY'; options.preemptive = true; break;
    case 'Multilevel Queue': payloadAlgo = 'MLQ'; options = { ...collectMultiOptions() }; break;
    case 'Multilevel Feedback Queue': payloadAlgo = 'MLFQ'; options = { ...collectMultiOptions() }; break;
  }

  // If manual preemptive toggle was shown, respect it (for SJF/LJF/Priority UI variants)
  if (!['RR','MLQ','MLFQ','SRTF','FCFS'].includes(payloadAlgo)) {
    options.preemptive = $('#preemptive').checked;
  }

  try {
    const resp = await fetch('/api/simulate', {
      method:'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ processes, algorithm: payloadAlgo, options })
    });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || 'Failed');
    drawGantt(data.timeline, processes);
    fillMetrics(data.metrics, data.aggregate);
  } catch (e) {
    console.error(e);
    alert('Simulation error: '+ e.message);
  }
});

// --------- D3 Gantt ---------
const svg = d3.select('#ganttSvg');
function clearGantt(){ svg.selectAll('*').remove(); }

function palette(pid) {
  // deterministic color
  let hash = 0;
  for (let i=0;i<pid.length;i++) hash = (hash*31 + pid.charCodeAt(i))|0;
  const hue = Math.abs(hash)%360;
  return `hsl(${hue} 70% 50%)`;
}

function drawGantt(timeline, processes){
  clearGantt();

  const height = 220;
  svg.attr('height', height);

  // build rows (unique PIDs plus IDLE)
  const pids = Array.from(new Set(timeline.map(s=>s.pid)));
  const yScale = d3.scaleBand().domain(pids).range([30, height-30]).padding(0.2);

  const maxTime = d3.max(timeline, d=>d.end) || 0;
  const width = svg.node().getBoundingClientRect().width || 800;
  const xScale = d3.scaleLinear().domain([0, maxTime]).range([100, width-20]);

  // axes
  const xAxis = d3.axisBottom(xScale).ticks(Math.min(maxTime, 20));
  svg.append('g').attr('transform', `translate(0, ${height-25})`).call(xAxis);
  svg.append('text').attr('x', width-60).attr('y', height-30).attr('text-anchor','end').text('Time');

  // pid labels
  svg.selectAll('.ylabels')
    .data(pids)
    .enter()
    .append('text')
    .attr('x', 10)
    .attr('y', d => yScale(d) + yScale.bandwidth()/1.5)
    .attr('class', 'text-sm')
    .text(d => d);

  // bars
  const rows = svg.selectAll('.bar')
    .data(timeline)
    .enter()
    .append('rect')
    .attr('x', d => xScale(d.start))
    .attr('y', d => yScale(d.pid))
    .attr('width', 0)
    .attr('height', yScale.bandwidth())
    .attr('rx', 6)
    .attr('fill', d => d.pid === 'IDLE' ? '#9ca3af' : palette(d.pid))
    .attr('opacity', 0.9);

  rows.transition()
    .duration(400)
    .attr('width', d => Math.max(1, xScale(d.end) - xScale(d.start)));

  // segment labels (small)
  svg.selectAll('.segtext')
    .data(timeline)
    .enter()
    .append('text')
    .attr('x', d => xScale(d.start) + 4)
    .attr('y', d => yScale(d.pid) + yScale.bandwidth()/1.6)
    .attr('font-size', 10)
    .attr('fill', 'white')
    .text(d => d.pid === 'IDLE' ? '' : d.pid);
}

function clearMetrics(){
  $('#metricsBody').innerHTML = '';
  $('#avgTAT').innerText = '-';
  $('#avgWT').innerText = '-';
  $('#util').innerText = '-';
}

function fillMetrics(rows, agg){
  const tbody = $('#metricsBody');
  tbody.innerHTML = '';
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-2">${r.pid}</td>
      <td class="p-2">${r.arrivalTime}</td>
      <td class="p-2">${r.burstTime}</td>
      <td class="p-2">${r.priority}</td>
      <td class="p-2">${r.TAT}</td>
      <td class="p-2">${r.WT}</td>
      <td class="p-2">${r.RT}</td>
    `;
    tbody.appendChild(tr);
  });
  $('#avgTAT').innerText = agg.averageTAT.toFixed(2);
  $('#avgWT').innerText = agg.averageWT.toFixed(2);
  $('#util').innerText = agg.cpuUtilization.toFixed(1) + '%';
}

// Export CSV (timeline + metrics)
$('#exportBtn').addEventListener('click', ()=>{
  const processes = collectProcesses();
  const metricsRows = [['PID','Arrival','Burst','Priority','TAT','WT','RT']];
  $$('#metricsBody tr').forEach(tr=>{
    const tds = Array.from(tr.querySelectorAll('td')).map(td=>td.innerText);
    metricsRows.push(tds);
  });
  const footer = ['Averages/Util','', '', '', $('#avgTAT').innerText, $('#avgWT').innerText, $('#util').innerText];
  metricsRows.push(footer);

  // Create CSV
  const csv = metricsRows.map(r=>r.map(x=>String(x).replaceAll('"','""')).map(x=>`"${x}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cpu_scheduling_metrics.csv';
  a.click();
  URL.revokeObjectURL(url);
});

// Show per-queue column automatically when MLQ/MLFQ chosen
const observer = new MutationObserver(()=> {
  if (algorithmSel.value === 'Multilevel Queue' || algorithmSel.value === 'Multilevel Feedback Queue') {
    queueHead.style.display = '';
    $$('.queueIdx').forEach(i=>i.closest('td').style.display='');
  } else {
    queueHead.style.display = 'none';
    $$('.queueIdx').forEach(i=>i.closest('td').style.display='none');
  }
});
observer.observe($('#multiConfig'), { attributes:true, childList:true, subtree:true });
