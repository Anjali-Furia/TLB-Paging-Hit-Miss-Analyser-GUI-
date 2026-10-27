// Global Variables
let chartInstance = null;
let stepperState = { active: false, currentIndex: 0, logs: [] };

// Initialize Interactive 3D WebGL Background via Three.js
document.addEventListener("DOMContentLoaded", () => {
  initThreeJSBackground();

  document.getElementById("btnRun").addEventListener("click", runSimulation);
  document.getElementById("btnNext").addEventListener("click", nextStep);
  document.getElementById("btnReset").addEventListener("click", resetAll);
});

/**
 * Three.js Interactive WebGL 3D Background
 * Renders a glowing rotating particle starfield that shifts with cursor movement.
 */
function initThreeJSBackground() {
  const canvas = document.getElementById("webgl-canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 50;

  // Create Particles
  const particlesGeometry = new THREE.BufferGeometry();
  const particlesCount = 700;
  const posArray = new Float32Array(particlesCount * 3);

  for (let i = 0; i < particlesCount * 3; i++) {
    posArray[i] = (Math.random() - 0.5) * 120;
  }

  particlesGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

  const particlesMaterial = new THREE.PointsMaterial({
    size: 0.8,
    color: 0x00f2fe,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending
  });

  const particlesMesh = new THREE.Points(particlesGeometry, particlesMaterial);
  scene.add(particlesMesh);

  // Mouse Interaction
  let mouseX = 0;
  let mouseY = 0;
  window.addEventListener("mousemove", (event) => {
    mouseX = (event.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (event.clientY / window.innerHeight - 0.5) * 2;
  });

  // Animation Loop
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const elapsedTime = clock.getElapsedTime();

    particlesMesh.rotation.y = elapsedTime * 0.05 + mouseX * 0.2;
    particlesMesh.rotation.x = elapsedTime * 0.03 + mouseY * 0.2;

    renderer.render(scene, camera);
  }
  animate();

  // Handle Resize
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// Input Validation Function
function getInputs() {
  const errorEl = document.getElementById("errorAlert");
  errorEl.classList.add("d-none");

  const tlbSize = parseInt(document.getElementById("tlbSize").value);
  const pageSize = parseFloat(document.getElementById("pageSize").value);
  const tTlb = parseFloat(document.getElementById("tTlb").value);
  const tMem = parseFloat(document.getElementById("tMem").value);
  const seqRaw = document.getElementById("seqInput").value.trim();

  if (isNaN(tlbSize) || tlbSize <= 0) return showError("TLB Size must be > 0");
  if (isNaN(pageSize) || pageSize <= 0) return showError("Page Size must be > 0");
  if (isNaN(tTlb) || tTlb < 0) return showError("TLB Lookup Time must be >= 0");
  if (isNaN(tMem) || tMem <= 0) return showError("Memory Access Time must be > 0");
  if (!seqRaw) return showError("Please provide a Page Reference Sequence");

  const seq = seqRaw.replace(/,/g, " ").trim().split(/\s+/).map(Number);
  if (seq.some(isNaN) || seq.some(p => p < 0)) return showError("Sequence must contain non-negative numbers");

  return { tlbSize, pageSize, tTlb, tMem, seq };
}

function showError(msg) {
  const errorEl = document.getElementById("errorAlert");
  errorEl.innerText = msg;
  errorEl.classList.remove("d-none");
  errorEl.classList.remove("animate-shake");
  void errorEl.offsetWidth;
  errorEl.classList.add("animate-shake");
  return null;
}

// 1. Traditional TLB Algorithm
function runTraditionalAlgo(tlbSize, seq, tTlb, tMem) {
  const tlb = [];
  const logs = [];
  let hits = 0, misses = 0;

  seq.forEach((page, idx) => {
    const isHit = tlb.includes(page);
    let evicted = "None", remarks = "";

    if (isHit) {
      hits++;
      remarks = `Page ${page} found in TLB.`;
    } else {
      misses++;
      if (tlb.length >= tlbSize) {
        evicted = tlb.shift(); // FIFO eviction
        remarks = `TLB Full. Evicted Page ${evicted}. Loaded Page ${page}.`;
      } else {
        remarks = `Page ${page} loaded into TLB.`;
      }
      tlb.push(page);
    }

    logs.push({
      step: idx + 1,
      page,
      result: isHit ? "HIT" : "MISS",
      tlbState: [...tlb],
      ptAccess: isHit ? "No" : "Yes",
      evicted: String(evicted),
      protected: "N/A",
      recentlyEvicted: "N/A",
      remarks
    });
  });

  const total = seq.length;
  const hitRatio = total > 0 ? hits / total : 0;
  const missRatio = total > 0 ? misses / total : 0;
  const eat = hitRatio * (tTlb + tMem) + missRatio * (tTlb + 2 * tMem);

  return {
    logs,
    metrics: {
      total, hits, misses, deadEntryMisses: "N/A",
      ptAccesses: misses,
      hitRatio: (hitRatio * 100).toFixed(1),
      missRatio: (missRatio * 100).toFixed(1),
      eat: eat.toFixed(1)
    }
  };
}

// 2. Simplified DEPOT-Inspired Algorithm
function runDEPOTAlgo(tlbSize, seq, tTlb, tMem) {
  const tlb = [];
  const protectedSet = new Set();
  const recentlyEvicted = new Set();
  const logs = [];
  let hits = 0, normalMisses = 0, deadMisses = 0;

  seq.forEach((page, idx) => {
    const isHit = tlb.includes(page);
    let result = "", evicted = "None", isDead = false, remarks = "";

    if (isHit) {
      hits++;
      result = "HIT";
      remarks = `Page ${page} found in TLB.`;
    } else {
      if (recentlyEvicted.has(page)) {
        isDead = true;
        deadMisses++;
        result = "DEAD-ENTRY MISS";
        remarks = `Page ${page} was recently evicted! Loaded & Granted Protection.`;
      } else {
        normalMisses++;
        result = "NORMAL MISS";
        remarks = `Page ${page} loaded into TLB.`;
      }

      if (tlb.length >= tlbSize) {
        let victimIdx = tlb.findIndex(p => !protectedSet.has(p));
        if (victimIdx === -1) victimIdx = 0; // Fallback to FIFO

        const evictedPage = tlb.splice(victimIdx, 1)[0];
        protectedSet.delete(evictedPage);
        recentlyEvicted.add(evictedPage);
        evicted = evictedPage;
      }

      tlb.push(page);
      if (isDead) protectedSet.add(page);
    }

    logs.push({
      step: idx + 1,
      page,
      result,
      tlbState: [...tlb],
      ptAccess: isHit ? "No" : "Yes",
      evicted: String(evicted),
      protected: protectedSet.size > 0 ? [...protectedSet].join(", ") : "None",
      recentlyEvicted: recentlyEvicted.size > 0 ? [...recentlyEvicted].join(", ") : "None",
      remarks
    });
  });

  const total = seq.length;
  const totalMisses = normalMisses + deadMisses;
  const hitRatio = total > 0 ? hits / total : 0;
  const missRatio = total > 0 ? totalMisses / total : 0;
  const eat = hitRatio * (tTlb + tMem) + missRatio * (tTlb + 2 * tMem);

  return {
    logs,
    metrics: {
      total, hits, misses: totalMisses, deadEntryMisses: deadMisses,
      ptAccesses: totalMisses,
      hitRatio: (hitRatio * 100).toFixed(1),
      missRatio: (missRatio * 100).toFixed(1),
      eat: eat.toFixed(1)
    }
  };
}

// Simulation Handler
function runSimulation() {
  const inputs = getInputs();
  if (!inputs) return;

  stepperState.active = false;
  const mode = document.querySelector('input[name="algoMode"]:checked').value;
  const { tlbSize, seq, tTlb, tMem } = inputs;

  const trad = runTraditionalAlgo(tlbSize, seq, tTlb, tMem);
  const depot = runDEPOTAlgo(tlbSize, seq, tTlb, tMem);

  if (mode === "trad") {
    renderTable(trad.logs);
    renderMetricsSingle("Traditional TLB", trad.metrics);
    renderChart({ Traditional: trad.metrics });
  } else if (mode === "depot") {
    renderTable(depot.logs);
    renderMetricsSingle("DEPOT-Inspired TLB", depot.metrics);
    renderChart({ "DEPOT-Inspired": depot.metrics });
  } else {
    renderTable(depot.logs);
    renderMetricsComparison(trad.metrics, depot.metrics);
    renderChart({ Traditional: trad.metrics, "DEPOT-Inspired": depot.metrics });
  }
}

// Next Step Stepper Handler
function nextStep() {
  const inputs = getInputs();
  if (!inputs) return;

  const mode = document.querySelector('input[name="algoMode"]:checked').value;
  const { tlbSize, seq, tTlb, tMem } = inputs;

  if (!stepperState.active) {
    document.getElementById("traceTableBody").innerHTML = "";
    stepperState.active = true;
    stepperState.currentIndex = 0;
    const res = mode === "trad" ? runTraditionalAlgo(tlbSize, seq, tTlb, tMem) : runDEPOTAlgo(tlbSize, seq, tTlb, tMem);
    stepperState.logs = res.logs;
  }

  if (stepperState.currentIndex < stepperState.logs.length) {
    const row = stepperState.logs[stepperState.currentIndex];
    appendRowToTable(row, 0);
    stepperState.currentIndex++;
    document.getElementById("stepCounter").innerText = `Step ${stepperState.currentIndex} / ${stepperState.logs.length}`;
  }
}

// Table Rendering with Staggered Cascade
function renderTable(logs) {
  const tbody = document.getElementById("traceTableBody");
  tbody.innerHTML = "";
  logs.forEach((row, index) => {
    appendRowToTable(row, index * 0.04);
  });
  document.getElementById("stepCounter").innerText = `Total Steps: ${logs.length}`;
}

function appendRowToTable(row, delay) {
  const tbody = document.getElementById("traceTableBody");
  const tr = document.createElement("tr");

  let badgeClass = "badge-miss";
  let rowClass = "row-miss";

  if (row.result.includes("HIT")) {
    badgeClass = "badge-hit";
    rowClass = "row-hit";
  } else if (row.result.includes("DEAD")) {
    badgeClass = "badge-dead-miss";
    rowClass = "row-dead";
  }

  tr.className = `${rowClass} row-cascade`;
  tr.style.animationDelay = `${delay}s`;
  tr.innerHTML = `
    <td><strong>${row.step}</strong></td>
    <td>${row.page}</td>
    <td><span class="${badgeClass}">${row.result}</span></td>
    <td class="font-monospace">[${row.tlbState.join(", ")}]</td>
    <td>${row.ptAccess}</td>
    <td>${row.evicted}</td>
    <td>${row.protected}</td>
    <td>${row.recentlyEvicted}</td>
    <td class="text-start small">${row.remarks}</td>
  `;
  tbody.appendChild(tr);
}

// Metrics Rendering
function renderMetricsSingle(title, m) {
  document.getElementById("metricsContainer").innerHTML = `
    <h5 class="fw-bold text-cyan mb-3">${title}</h5>
    <ul class="list-group list-group-flush font-monospace small bg-transparent">
      <li class="list-group-item bg-transparent text-light border-secondary d-flex justify-content-between"><span>Total References:</span> <strong>${m.total}</strong></li>
      <li class="list-group-item bg-transparent text-light border-secondary d-flex justify-content-between"><span>Hits / Misses:</span> <strong>${m.hits} / ${m.misses}</strong></li>
      <li class="list-group-item bg-transparent text-light border-secondary d-flex justify-content-between"><span>Dead-Entry Misses:</span> <strong>${m.deadEntryMisses}</strong></li>
      <li class="list-group-item bg-transparent text-light border-secondary d-flex justify-content-between"><span>Hit Ratio:</span> <strong class="text-success">${m.hitRatio}%</strong></li>
      <li class="list-group-item bg-dark-glass text-light border-secondary d-flex justify-content-between"><span>Effective Access Time (EAT):</span> <strong class="text-cyan">${m.eat} ns</strong></li>
    </ul>
  `;
}

function renderMetricsComparison(trad, depot) {
  document.getElementById("metricsContainer").innerHTML = `
    <div class="table-responsive">
      <table class="table table-dark table-bordered text-center align-middle font-monospace small mb-0">
        <thead class="bg-dark-glass">
          <tr><th>Metric</th><th>Traditional</th><th>DEPOT</th></tr>
        </thead>
        <tbody>
          <tr><td>Hits / Misses</td><td>${trad.hits} / ${trad.misses}</td><td>${depot.hits} / ${depot.misses}</td></tr>
          <tr><td>Dead-Entry Misses</td><td>N/A</td><td>${depot.deadEntryMisses}</td></tr>
          <tr><td>Hit Ratio (%)</td><td>${trad.hitRatio}%</td><td>${depot.hitRatio}%</td></tr>
          <tr class="table-active"><td><strong>EAT (ns)</strong></td><td><strong>${trad.eat} ns</strong></td><td><strong class="text-cyan">${depot.eat} ns</strong></td></tr>
        </tbody>
      </table>
    </div>
  `;
}

// Chart Rendering
function renderChart(dataMap) {
  const ctx = document.getElementById("comparisonChart").getContext("2d");
  if (chartInstance) chartInstance.destroy();

  const labels = Object.keys(dataMap);
  const hitRatios = labels.map(k => parseFloat(dataMap[k].hitRatio));
  const eats = labels.map(k => parseFloat(dataMap[k].eat));

  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Hit Ratio (%)", data: hitRatios, backgroundColor: "rgba(16, 185, 129, 0.85)", borderRadius: 6 },
        { label: "EAT (ns)", data: eats, backgroundColor: "rgba(0, 242, 254, 0.85)", borderRadius: 6 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 1200, easing: "easeInOutCubic" },
      scales: {
        y: { beginAtZero: true, grid: { color: "rgba(255, 255, 255, 0.1)" }, ticks: { color: "#fff" } },
        x: { grid: { display: false }, ticks: { color: "#fff" } }
      },
      plugins: {
        legend: { labels: { color: "#fff" } }
      }
    }
  });
}

// Reset Handler
function resetAll() {
  document.getElementById("traceTableBody").innerHTML = `<tr><td colspan="9" class="text-muted py-4">Click "Run Simulation" or "Next Step" to start interactive walkthrough.</td></tr>`;
  document.getElementById("metricsContainer").innerHTML = `<p class="text-muted text-center py-5">Run simulation to view performance comparison.</p>`;
  document.getElementById("errorAlert").classList.add("d-none");
  document.getElementById("stepCounter").innerText = "Step 0";
  stepperState = { active: false, currentIndex: 0, logs: [] };
  if (chartInstance) chartInstance.destroy();
}