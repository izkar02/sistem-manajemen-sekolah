// public/js/guru.main.js
async function me() {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (!res.ok) {
    // redirect ke login
    window.location.href = "/login.html";
    return;
  }

  const d = await res.json();

  const user = d.user;

  if (user.role !== "guru") {
    alert("Akses ditolak.");
    window.location.href = "/login.html";
    return;
  }

  document.getElementById("info").textContent =
    `Halo, ${user.username} (${user.role}) ${user.displayName}`;
}

/* SIDEBAR MOBILE TOGGLE */
const sidebar = document.querySelector(".sidebar");
const menuBtn = document.getElementById("menuToggle");
if (menuBtn) {
  menuBtn.onclick = () => {
    sidebar.classList.toggle("active");
    let overlay = document.querySelector(".sidebar-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "sidebar-overlay";
      document.body.appendChild(overlay);
      overlay.onclick = () => {
        sidebar.classList.remove("active");
        overlay.remove();
      };
    } else overlay.remove();
  };
}

/* NAV */
document.querySelectorAll(".sidebar button").forEach((btn) => {
  btn.onclick = () => {
    const page = btn.dataset.page;
    if (page) {
      document
        .querySelectorAll(".page")
        .forEach((p) => p.classList.remove("active"));
      const target = document.getElementById("page-" + page);
      if (target) target.classList.add("active");
    }
    sidebar.classList.remove("active");
    const overlay = document.querySelector(".sidebar-overlay");
    if (overlay) overlay.remove();
  };
});

/* LOGOUT */
document.getElementById("logoutBtn").onclick = async () => {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  window.location.href = "/login.html";
};

/* ---------- Jadwal (list + detail) ---------- */
const jadwalWrap = document.getElementById("guru_jadwalWrap");
const jadwalDetail = document.getElementById("guru_jadwalDetail");

async function fetchJadwalList() {
  try {
    // coba endpoint khusus siswa yang memfilter berdasarkan kelas
    let res = await fetch("/api/public/jadwal", {
      credentials: "include",
    });
    if (res.ok) {
      const j = await res.json();
      return j.data || [];
    }

    // fallback ke endpoint publik umum (jika mine tidak tersedia)
    const res2 = await fetch("/api/public/jadwal", { credentials: "include" });
    if (res2.ok) {
      const j2 = await res2.json();
      return j2.data || [];
    }

    return [];
  } catch (err) {
    console.error("fetchJadwalList error:", err);
    return [];
  }
}

function renderJadwalList(items) {
  jadwalWrap.innerHTML = "";
  if (!items || !items.length) {
    jadwalWrap.innerHTML = `<div class="empty">Belum ada jadwal tersimpan di server.</div>`;
    return;
  }
  const list = document.createElement("div");
  list.className = "list";
  items.forEach((s) => {
    const el = document.createElement("div");
    el.className = "schedule-item";
    el.style.display = "flex";
    el.style.justifyContent = "space-between";
    el.style.alignItems = "center";
    el.innerHTML = `
      <div>
        <strong class="jadwal-name" data-id="${s.id}">${s.name}</strong>
        <div class="meta">${s.academic || ""} • ${s.created_at ?? ""}</div>
      </div>
      <div class="controls" style="display:flex; gap:8px;">
        <button class="ghost" data-view="${s.id}">Lihat</button>
      </div>
    `;
    list.appendChild(el);
  });
  jadwalWrap.appendChild(list);

  // attach listeners
  jadwalWrap.querySelectorAll("[data-view]").forEach((btn) => {
    btn.onclick = async (e) => {
      const id = e.currentTarget.dataset.view;
      await loadJadwalDetail(id);
    };
  });

  // also allow clicking title to open detail
  jadwalWrap.querySelectorAll(".jadwal-name").forEach((el) => {
    el.onclick = async (ev) => {
      const id = ev.currentTarget.dataset.id;
      await loadJadwalDetail(id);
    };
  });
}

async function loadJadwalDetail(id) {
  if (!id) return;
  let res = await fetch(`/api/public/jadwal/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  if (!res.ok) {
    alert("Gagal memuat detail jadwal");
    return;
  }
  const j = await res.json();
  const data = j.data;
  renderJadwalDetail(data);
}

const DAY_LABELS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
function formatHM(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function renderJadwalDetail(schedule) {
  if (!schedule) {
    jadwalDetail.innerHTML = "";
    return;
  }

  const payload = schedule.payload ?? schedule; // payload could be entire object (depends on endpoint)
  const name = schedule.name ?? payload.name ?? "Jadwal";
  const academic = schedule.academic ?? payload.academic ?? "";

  // attempt to get classes, daysPerWeek etc from payload
  const classes =
    (payload.payload && payload.payload.classes) || payload.classes || [];
  const daysPerWeek =
    (payload.payload && payload.payload.daysPerWeek) ||
    payload.daysPerWeek ||
    5;
  const periodsPerDay =
    (payload.payload && payload.payload.periodsPerDay) ||
    payload.periodsPerDay ||
    8;
  const periodDuration =
    (payload.payload && payload.payload.periodDuration) ||
    payload.periodDuration ||
    35;
  const assignments =
    (payload.payload &&
      payload.payload.generated &&
      payload.payload.generated.assignments) ||
    (payload.generated && payload.generated.assignments) ||
    payload.assignments ||
    (payload.payload && payload.payload.assignments) ||
    [];

  const SCHED_BREAK_SESSION_INDEX = 3;
  const SCHED_BREAK_DURATION = 30;
  const DAY_START_MINUTES = 7 * 60;

  // compute times
  const startTimes = new Array(periodsPerDay);
  const endTimes = new Array(periodsPerDay);
  let cur = DAY_START_MINUTES;
  for (let p = 0; p < periodsPerDay; p++) {
    if (p === SCHED_BREAK_SESSION_INDEX) {
      startTimes[p] = cur;
      cur += SCHED_BREAK_DURATION;
      endTimes[p] = cur;
      continue;
    }
    startTimes[p] = cur;
    cur += periodDuration;
    endTimes[p] = cur;
  }

  let html = `<h2>${name}</h2><p class="meta">${academic}</p>`;
  classes.forEach((cls, classIdx) => {
    html += `<h3 class="class-title">Kelas ${cls.display || cls.name}</h3>`;
    html += `<table class="schedule-table"><thead><tr><th>Sesi (Waktu)</th>`;
    html += DAY_LABELS.slice(0, daysPerWeek)
      .map((d) => `<th>${d}</th>`)
      .join("");
    html += `</tr></thead><tbody>`;

    for (let p = 0; p < periodsPerDay; p++) {
      const isBreak = p === SCHED_BREAK_SESSION_INDEX;
      const timeLabel = `${formatHM(startTimes[p])} - ${formatHM(endTimes[p])}`;
      html += `<tr><td><strong>Sesi ${p + 1}</strong><br><small>${timeLabel}</small>${isBreak ? "<br><em>Istirahat</em>" : ""}</td>`;
      for (let d = 0; d < daysPerWeek; d++) {
        if (isBreak) {
          html += `<td class="break-cell">Istirahat</td>`;
          continue;
        }
        const slot = assignments.find(
          (a) => a.classIdx === classIdx && a.day === d && a.period === p,
        );
        html += `<td>${slot ? `<strong>${slot.subjectName}</strong><br><small>${slot.teacherName}</small>` : "-"}</td>`;
      }
      html += `</tr>`;
    }

    html += `</tbody></table>`;
  });

  jadwalDetail.innerHTML = html;
}

/* ---------- Guru list + filter ---------- */
const guruTableBody = document.querySelector("#guruTable tbody");
const guruFilterInput = document.getElementById("guruFilterInput");
const refreshGuruBtn = document.getElementById("refreshGuruBtn");

let GURU_CACHE = [];

async function fetchGuruAll() {
  let res = await fetch("/api/public/guru", { credentials: "include" });
  if (!res.ok) {
    // show message
    guruTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#666">Gagal memuat daftar guru</td></tr>`;
    return [];
  }
  const j = await res.json();
  return j.data || [];
}

function renderGuruRows(rows) {
  guruTableBody.innerHTML = "";
  if (!rows.length) {
    guruTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#666">Tidak ada guru</td></tr>`;
    return;
  }
  rows.forEach((g) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${g.nama || ""}</td>
      <td>${g.nip || ""}</td>
      <td>${g.jk || ""}</td>
      <td>${g.agama || ""}</td>
      <td>${g.email || ""}</td>
      <td>${g.hp || ""}</td>
    `;
    guruTableBody.appendChild(tr);
  });
}

// simple client-side filter; runs on input
function applyGuruFilter(q) {
  const ql = (q || "").trim().toLowerCase();
  if (!ql) {
    renderGuruRows(GURU_CACHE);
    return;
  }
  const filtered = GURU_CACHE.filter((g) => {
    return (
      (g.nama || "").toLowerCase().includes(ql) ||
      (g.nip || "").toLowerCase().includes(ql) ||
      (g.email || "").toLowerCase().includes(ql) ||
      (g.hp || "").toLowerCase().includes(ql)
    );
  });
  renderGuruRows(filtered);
}

// wiring
guruFilterInput.addEventListener("input", (e) => {
  applyGuruFilter(e.target.value);
});
refreshGuruBtn.onclick = async () => {
  await initGuru();
};

async function initGuru() {
  guruTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#666">Memuat...</td></tr>`;
  GURU_CACHE = await fetchGuruAll();
  renderGuruRows(GURU_CACHE);
}

/***** AMBIL DAFTAR KELAS *****/
async function loadKelasFilter() {
  try {
    console.log("[KELAS] Mengambil daftar kelas...");

    const res = await fetch("/api/public/kelas", {
      credentials: "include",
    });

    if (!res.ok) {
      console.error("[KELAS] Gagal:", res.status);
      return;
    }

    const d = await res.json();

    KELAS_CACHE = d.data || [];

    const select = document.getElementById("kelasFilter");

    select.innerHTML =
      `<option value="">Semua Kelas</option>` +
      KELAS_CACHE.map(
        (k) =>
          `<option value="${k.nama}">
            ${k.nama}
          </option>`,
      ).join("");

    console.log(`[KELAS] Berhasil memuat ${KELAS_CACHE.length} kelas`);
  } catch (err) {
    console.error("[KELAS] Error:", err);
  }
}

/* DATA TABLE SISWA */
let SISWA_CACHE = [];
let KELAS_CACHE = [];
async function loadSiswa() {
  console.log("[SISWA] Mengambil data siswa...");
  const res = await fetch("/api/public/siswa", { credentials: "include" });
  if (!res.ok) return alert("Gagal memuat data siswa");
  const d = await res.json();
  SISWA_CACHE = d.data || [];

  console.log(`[SISWA] Berhasil memuat ${SISWA_CACHE.length} siswa`);
  renderSiswaRows(SISWA_CACHE);
}

function renderSiswaRows(rows) {
  const tbody = document.querySelector("#siswaTable tbody");

  tbody.innerHTML = "";

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center">
          Tidak ada data siswa
        </td>
      </tr>
    `;
    return;
  }

  rows.forEach((s) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${s.nis}</td>
      <td>${s.nama}</td>
      <td>${s.jk || ""}</td>
      <td>${s.agama || ""}</td>
      <td>${s.kelas_nama || ""}</td>
      <td>${s.hp_ortu || ""}</td>
    `;

    tbody.appendChild(tr);
  });

  console.log(`[SISWA] Menampilkan ${rows.length} siswa`);
}

function applySiswaFilter() {
  const keyword = document
    .getElementById("siswaQuickFilter")
    .value.toLowerCase()
    .trim();

  const kelas = document.getElementById("kelasFilter").value;

  const filtered = SISWA_CACHE.filter((s) => {
    const cocokKeyword =
      !keyword ||
      (s.nama || "").toLowerCase().includes(keyword) ||
      (s.nis || "").toLowerCase().includes(keyword);

    const cocokKelas = !kelas || s.kelas_nama === kelas;

    return cocokKeyword && cocokKelas;
  });

  renderSiswaRows(filtered);

  console.log(
    `[FILTER] keyword="${keyword}" kelas="${kelas}" hasil=${filtered.length}`,
  );
}

/* =========================
   UI Helpers
   ========================= */

// small toast helper (top-right)
function showToast(message, duration = 3500) {
  let t = document.createElement("div");
  t.className = "small-toast";
  t.textContent = message;
  Object.assign(t.style, {
    position: "fixed",
    right: "18px",
    top: "18px",
    background: "#111",
    color: "white",
    padding: "8px 12px",
    borderRadius: "8px",
    boxShadow: "0 6px 18px rgba(0,0,0,0.15)",
    zIndex: 9999,
    fontSize: "13px",
  });
  document.body.appendChild(t);
  setTimeout(() => {
    t.style.transition = "opacity 300ms";
    t.style.opacity = "0";
  }, duration - 400);
  setTimeout(() => t.remove(), duration);
}

// quick filter input for siswa table (client-side)
// FILTER TABLE SISWA (CLIENT-SIDE)
document
  .getElementById("siswaQuickFilter")
  ?.addEventListener("input", applySiswaFilter);

document
  .getElementById("kelasFilter")
  ?.addEventListener("change", applySiswaFilter);

document.getElementById("resetFilterBtn")?.addEventListener("click", () => {
  document.getElementById("siswaQuickFilter").value = "";
  document.getElementById("kelasFilter").value = "";

  renderSiswaRows(SISWA_CACHE);

  console.log("[FILTER] Reset");
});

/* ---------- INITIAL PAGE LOAD ---------- */
(async function init() {
  await me();
  // By default show jadwal
  const jadwals = await fetchJadwalList();
  renderJadwalList(jadwals || []);
  // init guru list
  await initGuru();
  // data siswa
  await loadKelasFilter();
  await loadSiswa();
})();
