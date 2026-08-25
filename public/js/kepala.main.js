// public/js/kepala.main.js
// Halaman Kepala Sekolah — semua fitur di sini bersifat READ-ONLY
// (tidak ada create/update/delete, sesuai peran kepala sekolah sebagai pengawas)
import { successAlert, errorAlert, warningAlert } from "./swal-utils.js";

/* ---------- AUTH & INFO ---------- */
async function me() {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (!res.ok) {
    window.location.href = "/login.html";
    return null;
  }

  const d = await res.json();
  const user = d.user;

  if (!user || user.role !== "kepala") {
    errorAlert("Akses ditolak.");
    window.location.href = "/login.html";
    return null;
  }

  document.getElementById("info").textContent =
    `Halo, ${user.displayName || user.username} (Kepala Sekolah)`;
  return user;
}

/* ---------- SIDEBAR MOBILE TOGGLE ---------- */
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

/* ---------- NAV ---------- */
document.querySelectorAll(".sidebar button").forEach((btn) => {
  btn.onclick = () => {
    const page = btn.dataset.page;
    if (page) {
      document
        .querySelectorAll(".page")
        .forEach((p) => p.classList.remove("active"));
      const target = document.getElementById("page-" + page);
      if (target) target.classList.add("active");

      if (page === "dashboard") loadDashboard();
      if (page === "rekap" && !REKAP_INITIALIZED) {
        initRekap();
        REKAP_INITIALIZED = true;
      }
      if (page === "siswa" && !SISWA_INITIALIZED) {
        initSiswa();
        SISWA_INITIALIZED = true;
      }
    }
    sidebar.classList.remove("active");
    const overlay = document.querySelector(".sidebar-overlay");
    if (overlay) overlay.remove();
  };
});

/* ---------- LOGOUT ---------- */
document.getElementById("logoutBtn").onclick = async () => {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  window.location.href = "/login.html";
};

/* ---------- DASHBOARD ---------- */
async function loadDashboard() {
  try {
    const res = await fetch("/api/admin/dashboard", {
      credentials: "include",
    });
    if (!res.ok) {
      console.error("Gagal memuat dashboard:", res.status);
      return;
    }
    const d = await res.json();
    document.getElementById("count-guru").textContent = d.guru ?? 0;
    document.getElementById("count-siswa").textContent = d.siswa ?? 0;
    document.getElementById("count-kelas").textContent = d.kelas ?? 0;
  } catch (err) {
    console.error("loadDashboard error:", err);
  }

  await loadDashboardAttendanceStats();
}

/* Statistik kehadiran sekolah (semua guru/kelas) — memakai
   /api/guru/attendance/statistics yang untuk role kepala mengembalikan
   agregat sekolah, bukan data pribadi satu guru. */
async function loadDashboardAttendanceStats() {
  try {
    const res = await fetch("/api/guru/attendance/statistics", {
      credentials: "include",
    });
    if (!res.ok) {
      document.getElementById("dashStatSemesterLabel").textContent =
        "Gagal memuat statistik kehadiran.";
      return;
    }
    const d = await res.json();

    document.getElementById("dashStatSemesterLabel").textContent =
      `Semester: ${d.semester?.nama ?? "-"}`;

    document.getElementById("st-sessions").textContent = d.today.sessions;
    document.getElementById("st-hadir").textContent = d.today.hadir;
    document.getElementById("st-izin").textContent = d.today.izin;
    document.getElementById("st-sakit").textContent = d.today.sakit;
    document.getElementById("st-alpha").textContent = d.today.alpha;

    document.getElementById("ss-sessions").textContent =
      d.semester_summary.sessions;
    document.getElementById("ss-hadir").textContent = d.semester_summary.hadir;
    document.getElementById("ss-izin").textContent = d.semester_summary.izin;
    document.getElementById("ss-sakit").textContent = d.semester_summary.sakit;
    document.getElementById("ss-alpha").textContent = d.semester_summary.alpha;
  } catch (err) {
    console.error("loadDashboardAttendanceStats error:", err);
  }
}

/* ---------- JADWAL (list + detail, seluruh sekolah) ---------- */
const jadwalWrap = document.getElementById("kepala_jadwalWrap");
const jadwalDetail = document.getElementById("kepala_jadwalDetail");

async function fetchJadwalList() {
  try {
    const res = await fetch("/api/public/jadwal", { credentials: "include" });
    if (!res.ok) return [];
    const j = await res.json();
    return j.data || [];
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
    el.innerHTML = `
      <div>
        <strong class="jadwal-name" data-id="${s.id}" style="cursor:pointer">${s.name}</strong>
        <div class="meta">${s.academic || ""} • ${s.created_at ?? ""}</div>
      </div>
      <div class="controls" style="display:flex; gap:8px;">
        <button class="ghost" data-view="${s.id}">Lihat</button>
      </div>
    `;
    list.appendChild(el);
  });
  jadwalWrap.appendChild(list);

  jadwalWrap.querySelectorAll("[data-view]").forEach((btn) => {
    btn.onclick = async (e) => {
      const id = e.currentTarget.dataset.view;
      await loadJadwalDetail(id);
    };
  });

  jadwalWrap.querySelectorAll(".jadwal-name").forEach((el) => {
    el.onclick = async (ev) => {
      const id = ev.currentTarget.dataset.id;
      await loadJadwalDetail(id);
    };
  });
}

async function loadJadwalDetail(id) {
  if (!id) return;
  const res = await fetch(`/api/public/jadwal/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  if (!res.ok) {
    errorAlert("Gagal memuat detail jadwal");
    return;
  }
  const j = await res.json();
  renderJadwalDetail(j.data);
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

  const payload = schedule.payload ?? schedule;
  const name = schedule.name ?? payload.name ?? "Jadwal";
  const academic = schedule.academic ?? payload.academic ?? "";

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

  if (!classes.length) {
    html += `<div class="empty">Tidak ada data kelas pada jadwal ini.</div>`;
  }

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

/* ---------- REKAP KEHADIRAN (per kelas & semester, lintas guru) ---------- */
let REKAP_INITIALIZED = false;
let PERIODS_CACHE = [];

async function initRekap() {
  await Promise.all([loadKelasOptions(), loadAcademicPeriods()]);
}

async function loadKelasOptions() {
  const sel = document.getElementById("rekapKelasSelect");
  try {
    const res = await fetch("/api/public/kelas", { credentials: "include" });
    if (!res.ok) return;
    const j = await res.json();
    const kelasList = j.data || [];
    sel.innerHTML =
      `<option value="">— Pilih Kelas —</option>` +
      kelasList
        .map((k) => `<option value="${k.id}">${k.nama}</option>`)
        .join("");
  } catch (err) {
    console.error("loadKelasOptions error:", err);
  }
}

async function loadAcademicPeriods() {
  const sel = document.getElementById("rekapSemesterSelect");
  try {
    const res = await fetch("/api/academic-periods/", {
      credentials: "include",
    });
    if (!res.ok) return;
    const d = await res.json();
    // Endpoint ini mengembalikan array langsung (bukan dibungkus { data: [...] })
    PERIODS_CACHE = Array.isArray(d) ? d : [];
    sel.innerHTML =
      `<option value="">— Pilih Semester —</option>` +
      PERIODS_CACHE.map(
        (p) =>
          `<option value="${p.id}">${p.nama} ${p.is_active ? "(Aktif)" : ""}</option>`,
      ).join("");
  } catch (err) {
    console.error("loadAcademicPeriods error:", err);
  }
}

document.getElementById("btnTampilkanRekap").onclick = async () => {
  const classId = document.getElementById("rekapKelasSelect").value;
  const semesterId = document.getElementById("rekapSemesterSelect").value;

  if (!classId) {
    warningAlert("Pilih kelas terlebih dahulu");
    return;
  }
  if (!semesterId) {
    warningAlert("Pilih semester terlebih dahulu");
    return;
  }

  const btn = document.getElementById("btnTampilkanRekap");
  btn.disabled = true;
  btn.textContent = "Memuat...";

  try {
    const res = await fetch(
      `/api/guru/attendance/class/${classId}/semester-recap?academic_period_id=${semesterId}`,
      { credentials: "include" },
    );
    if (!res.ok) {
      const e = await res.json();
      errorAlert(e.error || "Gagal memuat rekap");
      return;
    }
    const d = await res.json();
    renderRekap(d, classId, semesterId);
  } catch (err) {
    console.error("btnTampilkanRekap error:", err);
    errorAlert("Terjadi kesalahan");
  } finally {
    btn.disabled = false;
    btn.textContent = "Tampilkan";
  }
};

function renderRekap(d, classId, semesterId) {
  const resultDiv = document.getElementById("rekapResult");
  const tbody = document.getElementById("rekapTableBody");

  document.getElementById("rekapHeader").innerHTML =
    `<strong>${d.class.nama}</strong> &bull; ${d.semester.nama} &bull; Total Sesi: ${d.total_sessions}`;

  tbody.innerHTML = "";
  if (!d.students || !d.students.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#9ca3af">Belum ada data absensi</td></tr>`;
  } else {
    d.students.forEach((s, i) => {
      const total =
        s.summary.hadir + s.summary.izin + s.summary.sakit + s.summary.alpha;
      const pct = total > 0 ? Math.round((s.summary.hadir / total) * 100) : 0;
      const pctColor =
        pct >= 80 ? "#16a34a" : pct >= 60 ? "#d97706" : "#dc2626";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${s.nis}</td>
        <td>${s.nama}</td>
        <td style="color:#16a34a;font-weight:600">${s.summary.hadir}</td>
        <td style="color:#2563eb">${s.summary.izin}</td>
        <td style="color:#d97706">${s.summary.sakit}</td>
        <td style="color:#dc2626">${s.summary.alpha}</td>
        <td>${pct}% <span style="color:${pctColor};font-weight:600">&#9679;</span></td>`;
      tbody.appendChild(tr);
    });
  }

  resultDiv.style.display = "block";

  const exportBtn = document.getElementById("btnExportXlsx");
  exportBtn.disabled = false;
  exportBtn.onclick = () => {
    window.open(
      `/api/guru/attendance/export/semester/xlsx?class_id=${classId}&academic_period_id=${semesterId}`,
      "_blank",
    );
  };
}

/* ---------- GURU (lihat saja, dengan filter pencarian) ---------- */
const guruTableBody = document.querySelector("#kepalaGuruTable tbody");
const guruFilterInput = document.getElementById("guruFilterInput");
const refreshGuruBtn = document.getElementById("refreshGuruBtn");

let GURU_CACHE = [];

async function fetchGuruAll() {
  const res = await fetch("/api/public/guru", { credentials: "include" });
  if (!res.ok) {
    guruTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#666">Gagal memuat daftar guru</td></tr>`;
    return [];
  }
  const j = await res.json();
  return j.data || [];
}

function renderGuruRows(rows) {
  guruTableBody.innerHTML = "";
  if (!rows.length) {
    guruTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#666">Tidak ada guru</td></tr>`;
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

function debounce(fn, wait = 180) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

guruFilterInput.addEventListener(
  "input",
  debounce((e) => applyGuruFilter(e.target.value)),
);
refreshGuruBtn.onclick = async () => {
  await initGuru();
};

async function initGuru() {
  guruTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#666">Memuat...</td></tr>`;
  GURU_CACHE = await fetchGuruAll();
  renderGuruRows(GURU_CACHE);
}

/* ---------- DATA SISWA (read-only, filter kelas + pencarian) ---------- */
let SISWA_INITIALIZED = false;
let SISWA_CACHE = [];

async function initSiswa() {
  await Promise.all([loadSiswaKelasFilter(), loadSiswaData()]);
}

async function loadSiswaKelasFilter() {
  const select = document.getElementById("siswaKelasFilter");
  try {
    const res = await fetch("/api/public/kelas", { credentials: "include" });
    if (!res.ok) return;
    const d = await res.json();
    const kelasList = d.data || [];
    select.innerHTML =
      `<option value="">Semua Kelas</option>` +
      kelasList
        .map((k) => `<option value="${k.nama}">${k.nama}</option>`)
        .join("");
  } catch (err) {
    console.error("loadSiswaKelasFilter error:", err);
  }
}

async function loadSiswaData() {
  const tbody = document.querySelector("#kepalaSiswaTable tbody");
  try {
    const res = await fetch("/api/admin/siswa", { credentials: "include" });
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#666">Gagal memuat data siswa</td></tr>`;
      return;
    }
    const d = await res.json();
    SISWA_CACHE = d.data || [];
    renderSiswaRows(SISWA_CACHE);
  } catch (err) {
    console.error("loadSiswaData error:", err);
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#666">Terjadi kesalahan</td></tr>`;
  }
}

function renderSiswaRows(rows) {
  const tbody = document.querySelector("#kepalaSiswaTable tbody");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#666">Tidak ada data siswa</td></tr>`;
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
}

function applySiswaFilter() {
  const keyword = document
    .getElementById("siswaQuickFilter")
    .value.toLowerCase()
    .trim();
  const kelas = document.getElementById("siswaKelasFilter").value;
  renderSiswaRows(
    SISWA_CACHE.filter((s) => {
      const cocokKeyword =
        !keyword ||
        (s.nama || "").toLowerCase().includes(keyword) ||
        (s.nis || "").toLowerCase().includes(keyword);
      const cocokKelas = !kelas || s.kelas_nama === kelas;
      return cocokKeyword && cocokKelas;
    }),
  );
}

document
  .getElementById("siswaQuickFilter")
  .addEventListener("input", debounce(applySiswaFilter));
document
  .getElementById("siswaKelasFilter")
  .addEventListener("change", applySiswaFilter);
document.getElementById("siswaResetFilterBtn").addEventListener("click", () => {
  document.getElementById("siswaQuickFilter").value = "";
  document.getElementById("siswaKelasFilter").value = "";
  renderSiswaRows(SISWA_CACHE);
});

/* ---------- Ganti Password ---------- */
const gantiPasswordForm = document.getElementById("gantiPasswordForm");
const gantiPasswordMsg = document.getElementById("gantiPasswordMsg");

if (gantiPasswordForm) {
  gantiPasswordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    gantiPasswordMsg.textContent = "";
    gantiPasswordMsg.style.color = "";

    const oldPassword = document.getElementById("oldPassword").value;
    const newPassword = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (newPassword !== confirmPassword) {
      gantiPasswordMsg.textContent = "Konfirmasi password baru tidak cocok.";
      gantiPasswordMsg.style.color = "#dc2626";
      return;
    }

    const submitBtn = gantiPasswordForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword, newPassword }),
        credentials: "include",
      });
      const j = await res.json();

      if (!res.ok) {
        gantiPasswordMsg.textContent = j.error || "Gagal mengubah password.";
        gantiPasswordMsg.style.color = "#dc2626";
        return;
      }

      gantiPasswordMsg.textContent = "Password berhasil diubah.";
      gantiPasswordMsg.style.color = "#16a34a";
      gantiPasswordForm.reset();
    } catch (err) {
      console.error("changePassword error:", err);
      gantiPasswordMsg.textContent = "Terjadi kesalahan, coba lagi.";
      gantiPasswordMsg.style.color = "#dc2626";
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ---------- INITIAL PAGE LOAD ---------- */
(async function init() {
  const user = await me();
  if (!user) return;

  await loadDashboard();

  const jadwals = await fetchJadwalList();
  renderJadwalList(jadwals || []);

  await initGuru();
})();
