// public/js/siswa.main.js
// Modul sederhana untuk halaman siswa (jadwal + daftar guru)
import { successAlert, errorAlert, warningAlert } from "./swal-utils.js";

function escapeHtml(value) {
  if (value === null || value === undefined) return "-";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function me() {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (!res.ok) {
    // jika tidak login -> redirect ke login
    window.location.href = "/login.html";
    return null;
  }
  const d = await res.json();
  const user = d.user;
  if (!user) {
    window.location.href = "/login.html";
    return null;
  }
  document.getElementById("info").textContent =
    `Halo, ${user.displayName || user.username}`;
  return user;
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
const jadwalWrap = document.getElementById("siswa_jadwalWrap");
const jadwalDetail = document.getElementById("siswa_jadwalDetail");
let JADWAL_CACHE = []; // hasil /api/public/jadwal/mine, dipakai lagi saat "Lihat" diklik

// Hanya memakai endpoint khusus siswa yang memfilter jadwal berdasarkan
// kelas (kelas_id diambil fresh dari DB di server). Sengaja TIDAK ada lagi
// fallback ke /api/public/jadwal (daftar semua jadwal, semua kelas) karena
// itu bisa membocorkan jadwal kelas lain ke siswa.
async function fetchJadwalList() {
  try {
    const res = await fetch("/api/public/jadwal/mine", {
      credentials: "include",
    });
    if (res.ok) {
      const j = await res.json();
      JADWAL_CACHE = j.data || [];
      return JADWAL_CACHE;
    }
    JADWAL_CACHE = [];
    return [];
  } catch (err) {
    console.error("fetchJadwalList error:", err);
    JADWAL_CACHE = [];
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

// Detail diambil dari cache hasil /jadwal/mine (payload sudah dipotong
// hanya untuk kelas siswa yang login di server), bukan fetch ulang ke
// endpoint publik /api/public/jadwal/:id yang mengembalikan SEMUA kelas.
function loadJadwalDetail(id) {
  if (!id) return;
  const schedule = JADWAL_CACHE.find((s) => String(s.id) === String(id));
  if (!schedule) {
    errorAlert("Gagal memuat detail jadwal");
    return;
  }
  renderJadwalDetail(schedule);
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

  // Sesi-sesi yang otomatis jadi jam istirahat, ditulis pakai nomor sesi
  // seperti yang tampil di tabel (1-based): "Sesi 3" dan "Sesi 7".
  const SCHED_BREAK_SESSIONS = [4, 8];
  const SCHED_BREAK_DURATION = 30;
  const DAY_START_MINUTES = 7 * 60;

  // compute times
  const startTimes = new Array(periodsPerDay);
  const endTimes = new Array(periodsPerDay);
  let cur = DAY_START_MINUTES;
  for (let p = 0; p < periodsPerDay; p++) {
    if (SCHED_BREAK_SESSIONS.includes(p + 1)) {
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
      const isBreak = SCHED_BREAK_SESSIONS.includes(p + 1);
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

/* ---------- Profil / Dashboard siswa ---------- */
const profilWrap = document.getElementById("siswa_profilWrap");

const BULAN_LABELS = [
  "JANUARI",
  "FEBRUARI",
  "MARET",
  "APRIL",
  "MEI",
  "JUNI",
  "JULI",
  "AGUSTUS",
  "SEPTEMBER",
  "OKTOBER",
  "NOVEMBER",
  "DESEMBER",
];

// ikon-ikon kecil (inline SVG, tanpa dependensi eksternal)
const PROFIL_ICONS = {
  person: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.24-8 5v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1c0-2.76-3.6-5-8-5Z"/></svg>`,
  building: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 21V5l8-3 8 3v16h-6v-5h-4v5H4Zm4-9h2v-2H8v2Zm0 4h2v-2H8v2Zm6-4h2v-2h-2v2Zm0 4h2v-2h-2v2Z"/></svg>`,
  gender: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 12c-4.4 0-8 2.24-8 5v1h16v-1c0-2.76-3.6-5-8-5Z"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.4 21 3 13.6 3 4c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1L6.6 10.8Z"/></svg>`,
  faith: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2 5 6v6c0 5 3 8.5 7 10 4-1.5 7-5 7-10V6l-7-4Z"/></svg>`,
};

function formatPeriodeLabel(period) {
  if (!period || !period.tanggal_mulai || !period.tanggal_selesai) return "-";
  const start = new Date(period.tanggal_mulai);
  const end = new Date(period.tanggal_selesai);
  const bulanAwal = BULAN_LABELS[start.getMonth()];
  const bulanAkhir = BULAN_LABELS[end.getMonth()];
  const tahunAwal = start.getFullYear();
  const tahunAkhir = end.getFullYear();
  if (tahunAwal === tahunAkhir) {
    return `${bulanAwal} - ${bulanAkhir} ${tahunAkhir}`;
  }
  return `${bulanAwal} ${tahunAwal} - ${bulanAkhir} ${tahunAkhir}`;
}

async function fetchProfile() {
  try {
    const res = await fetch("/api/siswa/profile", { credentials: "include" });
    if (!res.ok) return null;
    const j = await res.json();
    return j.student || null;
  } catch (err) {
    console.error("fetchProfile error:", err);
    return null;
  }
}

async function fetchActivePeriod() {
  try {
    const res = await fetch("/api/academic-periods/active", {
      credentials: "include",
    });
    if (!res.ok) return null; // 404 = memang belum ada semester aktif
    return await res.json();
  } catch (err) {
    console.error("fetchActivePeriod error:", err);
    return null;
  }
}

function renderProfile(student, period) {
  if (!profilWrap) return;
  if (!student) {
    profilWrap.innerHTML = `<div class="empty">Gagal memuat profil. Coba muat ulang halaman.</div>`;
    return;
  }

  const kelasLabel = student.kelas_nama
    ? student.kelas_nama
    : student.tingkat && student.section
      ? `${student.tingkat}${student.section}`
      : "-";
  const jkLabel =
    student.jk === "P" ? "Perempuan" : student.jk === "L" ? "Laki-laki" : "-";

  const semesterBanner = period
    ? `
      <div class="profil-semester-card">
        <div class="profil-semester-label">
          Semester Regular
          <span class="profil-badge">${period.nama || "-"}</span>
        </div>
        <div class="profil-semester-periode">
          Periode
          <span class="profil-badge profil-badge-outline">${formatPeriodeLabel(period)}</span>
        </div>
      </div>
    `
    : `
      <div class="profil-semester-card profil-semester-empty">
        Belum ada semester aktif yang diatur oleh admin.
      </div>
    `;

  profilWrap.innerHTML = `
    ${semesterBanner}

    <div class="profil-banner"></div>

    <div class="card profil-identity-card">
      <h3 class="profil-identity-title">Identitas Siswa</h3>

      <div class="profil-identity-row">
        <span class="profil-icon">${PROFIL_ICONS.person}</span>
        <span class="profil-identity-label">NIS</span>
        <span class="profil-identity-value">: ${student.nis || "-"}</span>
      </div>
      <div class="profil-identity-row">
        <span class="profil-icon">${PROFIL_ICONS.person}</span>
        <span class="profil-identity-label">Nama</span>
        <span class="profil-identity-value">: ${student.nama || "-"}</span>
      </div>
      <div class="profil-identity-row">
        <span class="profil-icon">${PROFIL_ICONS.building}</span>
        <span class="profil-identity-label">Kelas</span>
        <span class="profil-identity-value">: ${kelasLabel}</span>
      </div>
      <div class="profil-identity-row">
        <span class="profil-icon">${PROFIL_ICONS.gender}</span>
        <span class="profil-identity-label">Jenis Kelamin</span>
        <span class="profil-identity-value">: ${jkLabel}</span>
      </div>
      <div class="profil-identity-row">
        <span class="profil-icon">${PROFIL_ICONS.faith}</span>
        <span class="profil-identity-label">Agama</span>
        <span class="profil-identity-value">: ${student.agama || "-"}</span>
      </div>
      <div class="profil-identity-row">
        <span class="profil-icon">${PROFIL_ICONS.phone}</span>
        <span class="profil-identity-label">No. HP Ortu</span>
        <span class="profil-identity-value">: ${student.hp_ortu || "-"}</span>
      </div>
    </div>
  `;
}

async function initProfil() {
  if (!profilWrap) return;
  profilWrap.innerHTML = `<div class="empty">Memuat profil...</div>`;
  const [student, period] = await Promise.all([
    fetchProfile(),
    fetchActivePeriod(),
  ]);
  renderProfile(student, period);
}

/* ---------- Riwayat Absensi siswa ---------- */
const absensiWrap = document.getElementById("siswa_absensiWrap");

const ATTENDANCE_STATUS_LABEL = {
  hadir: "Hadir",
  izin: "Izin",
  sakit: "Sakit",
  alpha: "Alpha",
};

async function fetchAttendanceHistory() {
  try {
    const res = await fetch("/api/siswa/attendance/history", {
      credentials: "include",
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j.history || [];
  } catch (err) {
    console.error("fetchAttendanceHistory error:", err);
    return null;
  }
}

function renderAttendanceHistory(history) {
  if (!absensiWrap) return;
  if (history === null) {
    absensiWrap.innerHTML = `<div class="empty">Gagal memuat riwayat absensi.</div>`;
    return;
  }
  if (!history.length) {
    absensiWrap.innerHTML = `<div class="empty">Belum ada catatan absensi.</div>`;
    return;
  }
  let html = `<table class="schedule-table"><thead><tr>
    <th>Tanggal</th><th>Mapel</th><th>Guru</th><th>Status</th><th>Keterangan</th>
  </tr></thead><tbody>`;
  history.forEach((h) => {
    const statusLabel = ATTENDANCE_STATUS_LABEL[h.status] || h.status || "-";
    html += `<tr>
      <td>${h.tanggal || "-"}</td>
      <td>${h.subject_name || (h.session_type === "harian" ? "Harian" : "-")}</td>
      <td>${h.teacher_name || "-"}</td>
      <td>${statusLabel}</td>
      <td>${h.keterangan || "-"}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  absensiWrap.innerHTML = html;
}

async function initAbsensi() {
  if (!absensiWrap) return;
  absensiWrap.innerHTML = `<div class="empty">Memuat riwayat absensi...</div>`;
  const history = await fetchAttendanceHistory();
  renderAttendanceHistory(history);
}

/* ---------- Guru list + filter ---------- */
const guruTableBody = document.querySelector("#siswaGuruTable tbody");
const guruFilterInput = document.getElementById("guruFilterInput");
const refreshGuruBtn = document.getElementById("refreshGuruBtn");

let GURU_CACHE = [];

async function fetchGuruAll() {
  let res = await fetch("/api/public/guru", { credentials: "include" });
  if (!res.ok) {
    // show message
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

// debounce small helper
function debounce(fn, wait = 180) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// wiring
guruFilterInput.addEventListener("input", (e) => {
  applyGuruFilter(e.target.value);
});
refreshGuruBtn.onclick = async () => {
  await initGuru();
};

async function initGuru() {
  guruTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#666">Memuat...</td></tr>`;
  GURU_CACHE = await fetchGuruAll();
  renderGuruRows(GURU_CACHE);
}

/* ---------- Ekstrakurikuler (list + detail, read-only) ---------- */
// Catatan: siswa TIDAK bisa mendaftar ekskul sendiri dari halaman ini.
// Hanya menampilkan info + tombol "Lihat Detail". Pendaftaran anggota
// masih ditangani manual oleh pembina/admin lewat halaman guru/admin.
const ekskulWrap = document.getElementById("siswa_ekskulWrap");
const ekskulDetail = document.getElementById("siswa_ekskulDetail");
const ekskulMineWrap = document.getElementById("siswa_ekskulMineWrap");
let EKSKUL_CACHE = [];

const EKSKUL_ICON = "🏕️";
const DAY_LABELS_FULL = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
];

function formatEkskulDay(day) {
  if (day === null || day === undefined || day === "") return "-";
  if (typeof day === "number" || /^[0-6]$/.test(String(day))) {
    return DAY_LABELS_FULL[Number(day)] || "-";
  }
  const s = String(day);
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function formatEkskulTime(t) {
  if (!t) return "";
  // DB biasanya kirim "HH:MM:SS" -> tampilkan "HH:MM" saja
  return String(t).slice(0, 5);
}

// inject CSS sekali saja, supaya tidak bergantung pada siswa.css
// (yang mungkin belum punya style untuk kartu ekskul)
(function injectEkskulStyle() {
  if (document.getElementById("ekskul-style")) return;
  const style = document.createElement("style");
  style.id = "ekskul-style";
  style.textContent = `
    .ekskul-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 12px;
      margin-top: 8px;
    }
    .ekskul-card {
      border: 1px solid #e6e9ef;
      border-radius: 10px;
      padding: 14px;
      background: #fff;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .ekskul-card-title {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .ekskul-card-row {
      font-size: 13px;
      color: #444;
    }
    .ekskul-card-row strong {
      color: #111;
      font-weight: 600;
    }
    .ekskul-card .ghost {
      margin-top: 10px;
      align-self: flex-start;
    }
    .ekskul-detail-card {
      border: 1px solid #e6e9ef;
      border-radius: 10px;
      padding: 16px;
      background: #fafbfc;
    }
    .ekskul-detail-row {
      display: flex;
      gap: 8px;
      font-size: 14px;
      padding: 4px 0;
    }
    .ekskul-detail-label {
      min-width: 110px;
      font-weight: 600;
      color: #333;
    }
  `;
  document.head.appendChild(style);
})();

async function fetchEkskulList() {
  try {
    const res = await fetch("/api/public/extracurriculars", {
      credentials: "include",
    });
    if (!res.ok) {
      EKSKUL_CACHE = [];
      return null;
    }
    const j = await res.json();
    EKSKUL_CACHE = j.data || [];
    return EKSKUL_CACHE;
  } catch (err) {
    console.error("fetchEkskulList error:", err);
    EKSKUL_CACHE = [];
    return null;
  }
}

function renderEkskulList(items) {
  if (!ekskulWrap) return;
  ekskulDetail.innerHTML = "";

  if (items === null) {
    ekskulWrap.innerHTML = `<div class="empty">Gagal memuat daftar ekstrakurikuler.</div>`;
    return;
  }
  if (!items.length) {
    ekskulWrap.innerHTML = `<div class="empty">Belum ada ekstrakurikuler yang tersedia.</div>`;
    return;
  }

  const grid = document.createElement("div");
  grid.className = "ekskul-grid";

  items.forEach((item) => {
    const day = formatEkskulDay(item.day_of_week);
    const time =
      formatEkskulTime(item.start_time) && formatEkskulTime(item.end_time)
        ? `${formatEkskulTime(item.start_time)}–${formatEkskulTime(item.end_time)}`
        : "-";
    const kuota = `${item.active_members ?? 0}/${item.max_members ?? "-"}`;

    const el = document.createElement("div");
    el.className = "ekskul-card";
    el.innerHTML = `
      <div class="ekskul-card-title">${EKSKUL_ICON} ${escapeHtml(item.name)}</div>
      <div class="ekskul-card-row"><strong>Pembina</strong> : ${escapeHtml(item.teacher_name)}</div>
      <div class="ekskul-card-row"><strong>${escapeHtml(day)}</strong>, ${escapeHtml(time)}</div>
      <div class="ekskul-card-row"><strong>Lokasi</strong> : ${escapeHtml(item.location)}</div>
      <div class="ekskul-card-row"><strong>Peserta</strong> : ${escapeHtml(kuota)}</div>
      <button class="ghost" data-detail="${item.id}">Lihat Detail</button>
    `;
    grid.appendChild(el);
  });

  ekskulWrap.innerHTML = "";
  ekskulWrap.appendChild(grid);

  ekskulWrap.querySelectorAll("[data-detail]").forEach((btn) => {
    btn.onclick = () => renderEkskulDetail(btn.dataset.detail);
  });
}

function renderEkskulDetail(id) {
  if (!ekskulDetail) return;
  const item = EKSKUL_CACHE.find((e) => String(e.id) === String(id));
  if (!item) {
    ekskulDetail.innerHTML = "";
    errorAlert("Gagal memuat detail ekstrakurikuler");
    return;
  }

  const day = formatEkskulDay(item.day_of_week);
  const time =
    formatEkskulTime(item.start_time) && formatEkskulTime(item.end_time)
      ? `${formatEkskulTime(item.start_time)}–${formatEkskulTime(item.end_time)}`
      : "-";
  const kuota = `${item.active_members ?? 0}/${item.max_members ?? "-"}`;

  ekskulDetail.innerHTML = `
    <div class="ekskul-detail-card">
      <div class="ekskul-detail-row"><span class="ekskul-detail-label">Nama</span><span>: ${escapeHtml(item.name)}</span></div>
      <div class="ekskul-detail-row"><span class="ekskul-detail-label">Pembina</span><span>: ${escapeHtml(item.teacher_name)}</span></div>
      <div class="ekskul-detail-row"><span class="ekskul-detail-label">Jadwal</span><span>: ${escapeHtml(day)}</span></div>
      <div class="ekskul-detail-row"><span class="ekskul-detail-label">Waktu</span><span>: ${escapeHtml(time)}</span></div>
      <div class="ekskul-detail-row"><span class="ekskul-detail-label">Lokasi</span><span>: ${escapeHtml(item.location)}</span></div>
      <div class="ekskul-detail-row"><span class="ekskul-detail-label">Kapasitas</span><span>: ${escapeHtml(kuota)}</span></div>
      <div class="ekskul-detail-row"><span class="ekskul-detail-label">Deskripsi</span><span>: ${escapeHtml(item.description) || "-"}</span></div>
    </div>
  `;
  ekskulDetail.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function fetchEkskulMine() {
  try {
    const res = await fetch("/api/public/extracurriculars/mine", {
      credentials: "include",
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j.data || [];
  } catch (err) {
    console.error("fetchEkskulMine error:", err);
    return null;
  }
}

function renderEkskulMine(items) {
  if (!ekskulMineWrap) return;

  if (items === null) {
    ekskulMineWrap.innerHTML = `<div class="empty">Gagal memuat data ekstrakurikuler Anda.</div>`;
    return;
  }
  if (!items.length) {
    ekskulMineWrap.innerHTML = `<div class="empty">Anda tidak mengikuti ekstrakurikuler manapun.</div>`;
    return;
  }

  const grid = document.createElement("div");
  grid.className = "ekskul-grid";

  items.forEach((item) => {
    const day = formatEkskulDay(item.day_of_week);
    const time =
      formatEkskulTime(item.start_time) && formatEkskulTime(item.end_time)
        ? `${formatEkskulTime(item.start_time)}–${formatEkskulTime(item.end_time)}`
        : "-";

    const el = document.createElement("div");
    el.className = "ekskul-card";
    el.innerHTML = `
      <div class="ekskul-card-title">${EKSKUL_ICON} ${escapeHtml(item.name)}</div>
      <div class="ekskul-card-row"><strong>Pembina</strong> : ${escapeHtml(item.teacher_name)}</div>
      <div class="ekskul-card-row"><strong>${escapeHtml(day)}</strong>, ${escapeHtml(time)}</div>
      <div class="ekskul-card-row"><strong>Lokasi</strong> : ${escapeHtml(item.location)}</div>
      <div class="ekskul-card-row"><strong>Bergabung sejak</strong> : ${escapeHtml(item.join_date || "-")}</div>
    `;
    grid.appendChild(el);
  });

  ekskulMineWrap.innerHTML = "";
  ekskulMineWrap.appendChild(grid);
}

async function initEkskul() {
  if (ekskulMineWrap) {
    ekskulMineWrap.innerHTML = `<div class="empty">Memuat data...</div>`;
    const mine = await fetchEkskulMine();
    renderEkskulMine(mine);
  }

  if (!ekskulWrap) return;
  ekskulWrap.innerHTML = `<div class="empty">Memuat ekstrakurikuler...</div>`;
  const items = await fetchEkskulList();
  renderEkskulList(items);
}

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
  await me();
  // Dashboard/profil siswa (halaman default)
  await initProfil();
  // Riwayat absensi
  await initAbsensi();
  // Jadwal
  const jadwals = await fetchJadwalList();
  renderJadwalList(jadwals || []);
  // init guru list
  await initGuru();
  // Ekstrakurikuler
  await initEkskul();
})();
