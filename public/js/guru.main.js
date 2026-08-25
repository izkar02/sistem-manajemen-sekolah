// public/js/guru.main.js
import {
  successAlert,
  errorAlert,
  warningAlert,
  confirmDelete,
  confirmAction,
} from "./swal-utils.js";

/* ============================================================
   STATE GLOBAL
   ============================================================ */
let ME_DATA = null; // respons /api/auth/me
let TEACHER_CTX = null; // respons /api/guru/attendance/context
let ACTIVE_SESSION = null; // { id, class_id, class_name, subject_name, tanggal }
let STUDENTS_DATA = []; // daftar siswa sesi aktif
let ATTENDANCE_MAP = {}; // { student_id: { status, keterangan } }
let PERIODS_CACHE = []; // daftar academic_periods

/* ============================================================
   AUTH — /api/auth/me
   ============================================================ */
async function me() {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (!res.ok) {
    window.location.href = "/login.html";
    return null;
  }

  const d = await res.json();
  if (d.user.role !== "guru") {
    errorAlert("Akses ditolak.");
    window.location.href = "/login.html";
    return null;
  }

  ME_DATA = d;
  document.getElementById("info").textContent =
    `Halo, ${d.user.username} (${d.user.role}) ${d.user.displayName}`;
  return d;
}

/* ============================================================
   SIDEBAR MOBILE TOGGLE
   ============================================================ */
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

/* ============================================================
   TOAST
   ============================================================ */
function showToast(message, type = "default", duration = 3500) {
  const colors = {
    default: "#111",
    success: "#16a34a",
    error: "#dc2626",
    info: "#2563eb",
  };
  let t = document.createElement("div");
  t.className = "small-toast";
  t.textContent = message;
  Object.assign(t.style, {
    position: "fixed",
    right: "18px",
    top: "18px",
    background: colors[type] || "#111",
    color: "white",
    padding: "8px 14px",
    borderRadius: "8px",
    boxShadow: "0 6px 18px rgba(0,0,0,.15)",
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

/* ============================================================
   JADWAL
   ============================================================ */
const jadwalWrap = document.getElementById("guru_jadwalWrap");
const jadwalDetail = document.getElementById("guru_jadwalDetail");

async function fetchJadwalList() {
  try {
    const res = await fetch("/api/public/jadwal", { credentials: "include" });
    if (res.ok) {
      const j = await res.json();
      return j.data || [];
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
    el.style.cssText =
      "display:flex;justify-content:space-between;align-items:center";
    el.innerHTML = `
      <div>
        <strong class="jadwal-name" data-id="${s.id}">${s.name}</strong>
        <div class="meta">${s.academic || ""} • ${s.created_at ?? ""}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="ghost" data-view="${s.id}">Lihat</button>
      </div>`;
    list.appendChild(el);
  });
  jadwalWrap.appendChild(list);
  jadwalWrap.querySelectorAll("[data-view]").forEach((btn) => {
    btn.onclick = async (e) => {
      await loadJadwalDetail(e.currentTarget.dataset.view);
    };
  });
  jadwalWrap.querySelectorAll(".jadwal-name").forEach((el) => {
    el.onclick = async (ev) => {
      await loadJadwalDetail(ev.currentTarget.dataset.id);
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
  const h = Math.floor(totalMinutes / 60),
    m = totalMinutes % 60;
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

  const BREAK = 3,
    BREAK_DUR = 30,
    START = 7 * 60;
  const startTimes = [],
    endTimes = [];
  let cur = START;
  for (let p = 0; p < periodsPerDay; p++) {
    if (p === BREAK) {
      startTimes[p] = cur;
      cur += BREAK_DUR;
      endTimes[p] = cur;
      continue;
    }
    startTimes[p] = cur;
    cur += periodDuration;
    endTimes[p] = cur;
  }

  let html = `<h2>${name}</h2><p class="meta">${academic}</p>`;
  classes.forEach((cls, classIdx) => {
    html += `<h3 class="class-title">Kelas ${cls.display || cls.name}</h3>
      <table class="schedule-table"><thead><tr><th>Sesi (Waktu)</th>`;
    html += DAY_LABELS.slice(0, daysPerWeek)
      .map((d) => `<th>${d}</th>`)
      .join("");
    html += `</tr></thead><tbody>`;
    for (let p = 0; p < periodsPerDay; p++) {
      const isBreak = p === BREAK;
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

/* ============================================================
   GURU LIST
   ============================================================ */
const guruTableBody = document.querySelector("#guruTable tbody");
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
    tr.innerHTML = `<td>${g.nama || ""}</td><td>${g.nip || ""}</td><td>${g.jk || ""}</td>
      <td>${g.agama || ""}</td><td>${g.email || ""}</td><td>${g.hp || ""}</td>`;
    guruTableBody.appendChild(tr);
  });
}
function applyGuruFilter(q) {
  const ql = (q || "").trim().toLowerCase();
  if (!ql) {
    renderGuruRows(GURU_CACHE);
    return;
  }
  renderGuruRows(
    GURU_CACHE.filter(
      (g) =>
        (g.nama || "").toLowerCase().includes(ql) ||
        (g.nip || "").toLowerCase().includes(ql) ||
        (g.email || "").toLowerCase().includes(ql) ||
        (g.hp || "").toLowerCase().includes(ql),
    ),
  );
}
guruFilterInput.addEventListener("input", (e) =>
  applyGuruFilter(e.target.value),
);
refreshGuruBtn.onclick = async () => {
  await initGuru();
};
async function initGuru() {
  guruTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#666">Memuat...</td></tr>`;
  GURU_CACHE = await fetchGuruAll();
  renderGuruRows(GURU_CACHE);
}

/* ============================================================
   DATA SISWA
   ============================================================ */
let SISWA_CACHE = [];
let KELAS_CACHE = [];

async function loadKelasFilter() {
  try {
    const res = await fetch("/api/public/kelas", { credentials: "include" });
    if (!res.ok) return;
    const d = await res.json();
    KELAS_CACHE = d.data || [];
    const select = document.getElementById("kelasFilter");
    select.innerHTML =
      `<option value="">Semua Kelas</option>` +
      KELAS_CACHE.map(
        (k) => `<option value="${k.nama}">${k.nama}</option>`,
      ).join("");
  } catch (err) {
    console.error("[KELAS] Error:", err);
  }
}

async function loadSiswa() {
  const res = await fetch("/api/public/siswa", { credentials: "include" });
  if (!res.ok) {
    errorAlert("Gagal memuat data siswa");
    return;
  }
  const d = await res.json();
  SISWA_CACHE = d.data || [];
  renderSiswaRows(SISWA_CACHE);
}
function renderSiswaRows(rows) {
  const tbody = document.querySelector("#siswaTable tbody");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center">Tidak ada data siswa</td></tr>`;
    return;
  }
  rows.forEach((s) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${s.nis}</td><td>${s.nama}</td><td>${s.jk || ""}</td>
      <td>${s.agama || ""}</td><td>${s.kelas_nama || ""}</td><td>${s.hp_ortu || ""}</td>`;
    tbody.appendChild(tr);
  });
}
function applySiswaFilter() {
  const keyword = document
    .getElementById("siswaQuickFilter")
    .value.toLowerCase()
    .trim();
  const kelas = document.getElementById("kelasFilter").value;
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
  ?.addEventListener("input", applySiswaFilter);
document
  .getElementById("kelasFilter")
  ?.addEventListener("change", applySiswaFilter);
document.getElementById("resetFilterBtn")?.addEventListener("click", () => {
  document.getElementById("siswaQuickFilter").value = "";
  document.getElementById("kelasFilter").value = "";
  renderSiswaRows(SISWA_CACHE);
});

/* ============================================================
   DASHBOARD — /api/guru/attendance/statistics
   ============================================================ */
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
  badge: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 21V5l8-3 8 3v16h-6v-5h-4v5H4Zm4-9h2v-2H8v2Zm0 4h2v-2H8v2Zm6-4h2v-2h-2v2Zm0 4h2v-2h-2v2Z"/></svg>`,
  gender: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 12c-4.4 0-8 2.24-8 5v1h16v-1c0-2.76-3.6-5-8-5Z"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.4 21 3 13.6 3 4c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1L6.6 10.8Z"/></svg>`,
  faith: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2 5 6v6c0 5 3 8.5 7 10 4-1.5 7-5 7-10V6l-7-4Z"/></svg>`,
  mail: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v.01L12 12l8-5.99V6H4Zm16 2.24-7.42 5.56a1 1 0 0 1-1.16 0L4 8.24V18h16V8.24Z"/></svg>`,
  briefcase: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9 4a2 2 0 0 0-2 2v1H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3V6a2 2 0 0 0-2-2H9Zm0 2h6v1H9V6Zm-5 5h16v6H4v-6Z"/></svg>`,
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

function renderGuruProfile(period) {
  const profilWrap = document.getElementById("guru_profilWrap");
  if (!profilWrap) return;
  if (!ME_DATA) {
    profilWrap.innerHTML = `<div class="empty">Gagal memuat profil. Coba muat ulang halaman.</div>`;
    return;
  }

  const g = ME_DATA;
  const jkLabel = g.jk === "P" ? "Perempuan" : g.jk === "L" ? "Laki-laki" : "-";
  const tipeLabel =
    g.teacher_type === "kelas" ? "Guru Kelas" : "Guru Mata Pelajaran";
  const subjectChips = (g.subjects || [])
    .map((s) => `<span class="chip">${s.kode} — ${s.nama}</span>`)
    .join("");

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
      <h3 class="profil-identity-title">Identitas Guru</h3>

      <div class="profil-identity-row">
        <span class="profil-icon">${PROFIL_ICONS.person}</span>
        <span class="profil-identity-label">Nama</span>
        <span class="profil-identity-value">: ${g.user.displayName || "-"}</span>
      </div>
      <div class="profil-identity-row">
        <span class="profil-icon">${PROFIL_ICONS.badge}</span>
        <span class="profil-identity-label">NIP</span>
        <span class="profil-identity-value">: ${g.nip || "-"}</span>
      </div>
      <div class="profil-identity-row">
        <span class="profil-icon">${PROFIL_ICONS.briefcase}</span>
        <span class="profil-identity-label">Jenis Guru</span>
        <span class="profil-identity-value">: ${tipeLabel}</span>
      </div>
      <div class="profil-identity-row">
        <span class="profil-icon">${PROFIL_ICONS.gender}</span>
        <span class="profil-identity-label">Jenis Kelamin</span>
        <span class="profil-identity-value">: ${jkLabel}</span>
      </div>
      <div class="profil-identity-row">
        <span class="profil-icon">${PROFIL_ICONS.faith}</span>
        <span class="profil-identity-label">Agama</span>
        <span class="profil-identity-value">: ${g.agama || "-"}</span>
      </div>
      <div class="profil-identity-row">
        <span class="profil-icon">${PROFIL_ICONS.mail}</span>
        <span class="profil-identity-label">Email</span>
        <span class="profil-identity-value">: ${g.email || "-"}</span>
      </div>
      <div class="profil-identity-row">
        <span class="profil-icon">${PROFIL_ICONS.phone}</span>
        <span class="profil-identity-label">No. HP</span>
        <span class="profil-identity-value">: ${g.hp || "-"}</span>
      </div>
      <div class="profil-identity-row">
        <span class="profil-icon">${PROFIL_ICONS.badge}</span>
        <span class="profil-identity-label">Mapel Diampu</span>
        <span class="profil-identity-value chip-list">${subjectChips || '<span style="color:#9ca3af;font-size:12px">Belum ada mata pelajaran</span>'}</span>
      </div>
    </div>
  `;
}

async function initDashboard() {
  // Tampilkan info guru dari ME_DATA (identitas lengkap, mirip dashboard siswa)
  const period = await fetchActivePeriod();
  renderGuruProfile(period);

  try {
    const res = await fetch("/api/guru/attendance/statistics", {
      credentials: "include",
    });
    if (!res.ok) return;
    const d = await res.json();

    // hari ini
    document.getElementById("st-sessions").textContent = d.today.sessions;
    document.getElementById("st-hadir").textContent = d.today.hadir;
    document.getElementById("st-izin").textContent = d.today.izin;
    document.getElementById("st-sakit").textContent = d.today.sakit;
    document.getElementById("st-alpha").textContent = d.today.alpha;

    // semester
    document.getElementById("ss-sessions").textContent =
      d.semester_summary.sessions;
    document.getElementById("ss-hadir").textContent = d.semester_summary.hadir;
    document.getElementById("ss-izin").textContent = d.semester_summary.izin;
    document.getElementById("ss-sakit").textContent = d.semester_summary.sakit;
    document.getElementById("ss-alpha").textContent = d.semester_summary.alpha;
  } catch (err) {
    console.error("initDashboard error:", err);
  }
}

/* ============================================================
   ATTENDANCE CONTEXT — /api/guru/attendance/context
   ============================================================ */
async function loadAttendanceContext() {
  try {
    const res = await fetch("/api/guru/attendance/context", {
      credentials: "include",
    });
    if (!res.ok) {
      showToast("Gagal memuat konteks absensi", "error");
      return null;
    }
    TEACHER_CTX = await res.json();
    return TEACHER_CTX;
  } catch (err) {
    console.error("loadAttendanceContext:", err);
    return null;
  }
}
/* ============================================================
   AMBIL DATA KELAS DARI ENDPOINT PUBLIK
   ============================================================ */
async function loadPublicClasses() {
  try {
    const res = await fetch("/api/public/kelas", {
      credentials: "include",
    });
    if (!res.ok) {
      console.error("Gagal memuat data kelas");
      return [];
    }
    const data = await res.json();
    return data.data || data || []; // sesuaikan dengan struktur response
  } catch (err) {
    console.error("loadPublicClasses:", err);
    return [];
  }
}

/* ============================================================
   ABSENSI — inisialisasi form
   ============================================================ */
async function initAbsensi() {
  // Set default tanggal = hari ini (pakai timezone lokal, bukan UTC)
  const todayLocal = new Date();
  const yyyy = todayLocal.getFullYear();
  const mm = String(todayLocal.getMonth() + 1).padStart(2, "0");
  const dd = String(todayLocal.getDate()).padStart(2, "0");
  document.getElementById("absensiTanggal").value = `${yyyy}-${mm}-${dd}`;

  const ctx = await loadAttendanceContext();
  if (!ctx) return;

  const teacherType = ctx.teacher.teacher_type;
  const sel = document.getElementById("selKelasOrMapel");
  const label = document.getElementById("lblKelasOrMapel");

  if (teacherType === "kelas") {
    // Guru kelas → tidak perlu pilih mapel atau kelas.
    // Kelas sudah otomatis dari wali_id, dan absensi bersifat harian.
    // Sembunyikan grup dropdown selKelasOrMapel sepenuhnya.
    document.getElementById("fgKelasOrMapel").style.display = "none";
  } else {
    // Guru mapel → pilih kelas DARI ENDPOINT PUBLIK
    label.textContent = "Kelas";

    // Tampilkan loading terlebih dahulu
    sel.innerHTML = `<option value="">Memuat data kelas...</option>`;
    sel.disabled = true;

    // Ambil data kelas dari endpoint publik
    const classes = await loadPublicClasses();

    // Reset select
    sel.disabled = false;

    if (classes.length === 0) {
      sel.innerHTML = `<option value="">— Tidak ada kelas tersedia —</option>`;
    } else {
      sel.innerHTML =
        `<option value="">— Pilih Kelas —</option>` +
        classes
          .map((c) => `<option value="${c.id}">${c.nama}</option>`)
          .join("");
    }
  }

  await loadHistory();
}

/* ============================================================
   BUAT SESI ABSENSI
   ============================================================ */
document.getElementById("btnMulaiAbsensi").onclick = async () => {
  if (!TEACHER_CTX) {
    showToast("Konteks guru belum dimuat", "error");
    return;
  }

  const teacherType = TEACHER_CTX.teacher.teacher_type;
  const selVal = document.getElementById("selKelasOrMapel").value;
  const tanggal = document.getElementById("absensiTanggal").value;
  const materi = document.getElementById("absensiMateri").value.trim();

  if (!tanggal) {
    showToast("Tanggal wajib diisi", "error");
    return;
  }

  if (teacherType === "mapel" && !selVal) {
    showToast("Pilih kelas terlebih dahulu", "error");
    return;
  }

  let body;
  if (teacherType === "kelas") {
    // Guru kelas: class_id otomatis dari konteks (wali_id), tidak perlu mapel
    const myClass = (TEACHER_CTX.classes || [])[0];
    if (!myClass) {
      showToast("Kelas tidak ditemukan untuk guru ini", "error");
      return;
    }
    body = {
      class_id: myClass.id,
      subject_id: null,
      tanggal,
      materi: materi || null,
    };
  } else {
    // subject_id dari ME_DATA.subjects (guru mapel hanya 1 mapel)
    const mySubject = (ME_DATA.subjects || [])[0];
    body = {
      class_id: Number(selVal),
      subject_id: mySubject ? mySubject.subject_id : null,
      tanggal,
      materi: materi || null,
    };
  }

  const btn = document.getElementById("btnMulaiAbsensi");
  btn.disabled = true;
  btn.textContent = "Membuat...";

  try {
    const res = await fetch("/api/guru/attendance/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (!res.ok) {
      showToast(d.error || "Gagal membuat sesi", "error");
      return;
    }

    // Simpan session aktif
    const className =
      teacherType === "kelas"
        ? TEACHER_CTX.classes[0]?.nama || "—"
        : document.getElementById("selKelasOrMapel").selectedOptions[0]?.text ||
          "—";
    const subjectName =
      teacherType === "kelas"
        ? "" // guru kelas tidak pakai mapel
        : ME_DATA.subjects[0]?.nama || "—";

    ACTIVE_SESSION = {
      id: d.session_id,
      class_id: body.class_id,
      class_name: className,
      subject_name: subjectName,
      tanggal,
      materi,
    };

    await loadStudentsForSession(body.class_id);
    showToast("Sesi absensi berhasil dibuat", "success");
  } catch (err) {
    console.error(err);
    showToast("Terjadi kesalahan", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Mulai Absensi";
  }
};

/* ============================================================
   MUAT SISWA & TAMPILKAN TABEL ABSENSI
   ============================================================ */
async function loadStudentsForSession(classId) {
  const res = await fetch(`/api/guru/attendance/class/${classId}/students`, {
    credentials: "include",
  });
  if (!res.ok) {
    showToast("Gagal memuat daftar siswa", "error");
    return;
  }
  const d = await res.json();

  STUDENTS_DATA = d.students || [];
  ATTENDANCE_MAP = {};
  STUDENTS_DATA.forEach((s) => {
    ATTENDANCE_MAP[s.id] = { status: "hadir", keterangan: "" };
  });

  renderAbsensiTable();
  showAbsensiPanel();
}

function renderAbsensiTable() {
  const tbody = document.getElementById("absensiTableBody");
  tbody.innerHTML = "";

  STUDENTS_DATA.forEach((s, i) => {
    const att = ATTENDANCE_MAP[s.id];
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${s.nis}</td>
      <td>${s.nama}</td>
      <td>
        <div class="status-btns">
          ${["hadir", "izin", "sakit", "alpha"]
            .map(
              (st) =>
                `<button class="status-btn ${att.status === st ? "active-" + st : ""}"
              data-sid="${s.id}" data-status="${st}"
              onclick="setStatus(${s.id}, '${st}')">
              ${st.charAt(0).toUpperCase() + st.slice(1)}
            </button>`,
            )
            .join("")}
        </div>
      </td>
      <td>
        <input class="keterangan-input" type="text" placeholder="Keterangan..."
          value="${att.keterangan}"
          oninput="setKeterangan(${s.id}, this.value)" />
      </td>`;
    tbody.appendChild(tr);
  });

  updateAbsensiCounter();
}

function showAbsensiPanel() {
  const panel = document.getElementById("absensiPanel");
  panel.style.display = "block";

  document.getElementById("absensiInfoTitle").textContent =
    `${ACTIVE_SESSION.class_name} — ${ACTIVE_SESSION.subject_name}`;
  document.getElementById("absensiInfoMeta").textContent =
    `Tanggal: ${ACTIVE_SESSION.tanggal}${ACTIVE_SESSION.materi ? " · Materi: " + ACTIVE_SESSION.materi : ""}`;

  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ============================================================
   STATUS HELPERS
   ============================================================ */
window.setStatus = function (studentId, status) {
  if (!ATTENDANCE_MAP[studentId]) return;
  ATTENDANCE_MAP[studentId].status = status;

  // Update tombol aktif
  document.querySelectorAll(`[data-sid="${studentId}"]`).forEach((btn) => {
    btn.className =
      "status-btn" + (btn.dataset.status === status ? " active-" + status : "");
  });
  updateAbsensiCounter();
};

window.setKeterangan = function (studentId, val) {
  if (ATTENDANCE_MAP[studentId]) ATTENDANCE_MAP[studentId].keterangan = val;
};

window.setAllStatus = function (status) {
  STUDENTS_DATA.forEach((s) => {
    ATTENDANCE_MAP[s.id].status = status;
  });
  renderAbsensiTable();
};

function updateAbsensiCounter() {
  const counts = { hadir: 0, izin: 0, sakit: 0, alpha: 0 };
  Object.values(ATTENDANCE_MAP).forEach((a) => {
    if (counts[a.status] !== undefined) counts[a.status]++;
  });
  document.getElementById("absensiCounter").textContent =
    `Hadir: ${counts.hadir} · Izin: ${counts.izin} · Sakit: ${counts.sakit} · Alpha: ${counts.alpha}`;
}

/* ============================================================
   SIMPAN ABSENSI
   ============================================================ */
document.getElementById("btnSimpanAbsensi").onclick = async () => {
  if (!ACTIVE_SESSION) return;

  const details = STUDENTS_DATA.map((s) => ({
    student_id: s.id,
    status: ATTENDANCE_MAP[s.id].status,
    keterangan: ATTENDANCE_MAP[s.id].keterangan || null,
  }));

  const btn = document.getElementById("btnSimpanAbsensi");
  btn.disabled = true;
  btn.textContent = "Menyimpan...";

  try {
    const res = await fetch(
      `/api/guru/attendance/session/${ACTIVE_SESSION.id}/details`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ details }),
      },
    );
    const d = await res.json();
    if (!res.ok) {
      showToast(d.error || "Gagal menyimpan absensi", "error");
      return;
    }

    showToast(`Absensi disimpan — ${d.saved} siswa tercatat`, "success");
    resetAbsensiPanel();
    await loadHistory();
    await initDashboard();
  } catch (err) {
    console.error(err);
    showToast("Terjadi kesalahan saat menyimpan", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Simpan Absensi";
  }
};

/* ============================================================
   BATALKAN SESI
   ============================================================ */
document.getElementById("btnBatalAbsensi").onclick = async () => {
  if (!ACTIVE_SESSION) return;
  if (
    !(await confirmDelete(
      "Sesi absensi ini akan dihapus dan tindakan tidak dapat dibatalkan.",
    ))
  )
    return;

  try {
    const res = await fetch(
      `/api/guru/attendance/session/${ACTIVE_SESSION.id}`,
      {
        method: "DELETE",
        credentials: "include",
      },
    );
    const d = await res.json();
    if (!res.ok) {
      showToast(d.error || "Gagal menghapus sesi", "error");
      return;
    }
    showToast("Sesi absensi dibatalkan", "info");
    resetAbsensiPanel();
  } catch (err) {
    showToast("Terjadi kesalahan", "error");
  }
};

function resetAbsensiPanel() {
  ACTIVE_SESSION = null;
  STUDENTS_DATA = [];
  ATTENDANCE_MAP = {};
  document.getElementById("absensiPanel").style.display = "none";
  document.getElementById("absensiMateri").value = "";
}

/* ============================================================
   HISTORI SESI
   ============================================================ */
async function loadHistory() {
  const listEl = document.getElementById("historyList");
  listEl.innerHTML = `<div class="empty-state">Memuat histori...</div>`;
  try {
    const res = await fetch("/api/guru/attendance/history?active_period=1", {
      credentials: "include",
    });
    if (!res.ok) {
      listEl.innerHTML = `<div class="empty-state">Gagal memuat histori</div>`;
      return;
    }
    const d = await res.json();
    renderHistory(d.data || []);
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">Terjadi kesalahan</div>`;
  }
}

function renderHistory(sessions) {
  const listEl = document.getElementById("historyList");
  if (!sessions.length) {
    listEl.innerHTML = `<div class="empty-state">Belum ada sesi absensi di semester ini</div>`;
    return;
  }

  const ATTENDANCE_EDIT_WINDOW_DAYS = 7;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  listEl.innerHTML = "";

  sessions.forEach((s) => {
    const isDraft = s.status === "draft";

    // Ambil tanggal murni YYYY-MM-DD dari string API tanpa new Date()
    // untuk menghindari timezone shift di WIB (+7/+8).
    const tanggalStr = String(s.tanggal).slice(0, 10);

    // Hitung diffDays pakai Date lokal (bukan UTC) agar tidak shift
    const [sy, sm, sd] = tanggalStr.split("-").map(Number);
    const sessionDateLocal = new Date(sy, sm - 1, sd);
    const todayLocal = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );
    const diffDays = Math.round(
      (todayLocal - sessionDateLocal) / (1000 * 60 * 60 * 24),
    );
    const withinEditWindow =
      diffDays >= 0 && diffDays <= ATTENDANCE_EDIT_WINDOW_DAYS;

    const canEdit = withinEditWindow;
    const canDelete = withinEditWindow;

    const div = document.createElement("div");
    div.className = "history-item";
    div.innerHTML = `
      <div>
        <div class="hi-title">${s.class_name}${s.subject_name ? " — " + s.subject_name : ""}</div>
        <div class="hi-meta">${tanggalStr} ${s.materi ? "· " + s.materi : ""}</div>
        <div class="hi-badges" style="margin-top:6px">
          <span class="badge ${isDraft ? "badge-draft" : "badge-green"}">${isDraft ? "Draft" : "Selesai"}</span>
          <span class="badge badge-green">H: ${s.hadir}</span>
          <span class="badge badge-blue">I: ${s.izin}</span>
          <span class="badge badge-yellow">S: ${s.sakit}</span>
          <span class="badge badge-red">A: ${s.alpha}</span>
        </div>
      </div>
      <div class="hi-actions">
        <button class="ghost" onclick="openDetailModal(${s.id})">Lihat</button>
        ${canEdit ? `<button class="ghost" onclick="openEditModal(${s.id})">Edit</button>` : ""}
        ${canDelete ? `<button class="ghost" style="color:#dc2626" onclick="deleteSession(${s.id})">Hapus</button>` : ""}
      </div>`;
    listEl.appendChild(div);
  });
}

document.getElementById("btnRefreshHistory").onclick = async () => {
  await loadHistory();
};

/* ============================================================
   MODAL DETAIL SESI
   ============================================================ */
window.openDetailModal = async function (sessionId) {
  try {
    const res = await fetch(`/api/guru/attendance/session/${sessionId}`, {
      credentials: "include",
    });
    if (!res.ok) {
      showToast("Gagal memuat detail", "error");
      return;
    }
    const d = await res.json();

    document.getElementById("modalTitle").textContent =
      `${d.session.class_name}${d.session.subject_name ? " — " + d.session.subject_name : ""} · ${d.session.tanggal}`;

    const statusColor = {
      hadir: "#16a34a",
      izin: "#2563eb",
      sakit: "#d97706",
      alpha: "#dc2626",
    };
    let rows = (d.students || [])
      .map(
        (s, i) =>
          `<tr>
        <td>${i + 1}</td>
        <td>${s.nis}</td>
        <td>${s.nama}</td>
        <td style="color:${statusColor[s.status] || "#111"};font-weight:600">${s.status}</td>
        <td>${s.keterangan || ""}</td>
      </tr>`,
      )
      .join("");

    document.getElementById("modalBody").innerHTML = `
      <p style="font-size:12px;color:#6b7280;margin-bottom:10px">
        Status: <strong>${d.session.status}</strong>
        ${d.session.materi ? " · Materi: " + d.session.materi : ""}
      </p>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>No</th><th>NIS</th><th>Nama</th><th>Status</th><th>Keterangan</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    document.getElementById("modalDetail").classList.add("open");
  } catch (err) {
    showToast("Terjadi kesalahan", "error");
  }
};

/* ============================================================
   MODAL EDIT SESI
   ============================================================ */
window.openEditModal = async function (sessionId) {
  try {
    const res = await fetch(`/api/guru/attendance/session/${sessionId}`, {
      credentials: "include",
    });
    if (!res.ok) {
      showToast("Gagal memuat data", "error");
      return;
    }
    const d = await res.json();

    // Buat map sementara
    const editMap = {};
    (d.students || []).forEach((s) => {
      editMap[s.student_id] = {
        status: s.status,
        keterangan: s.keterangan || "",
      };
    });

    document.getElementById("modalTitle").textContent =
      `Edit Absensi — ${d.session.class_name} · ${d.session.tanggal}`;

    const statusColor = {
      hadir: "#16a34a",
      izin: "#2563eb",
      sakit: "#d97706",
      alpha: "#dc2626",
    };
    let rows = (d.students || [])
      .map(
        (s, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${s.nis}</td>
        <td>${s.nama}</td>
        <td>
          <select class="edit-status-sel" data-sid="${s.student_id}"
            style="padding:4px 6px;border-radius:4px;border:1px solid #d1d5db;
            color:${statusColor[editMap[s.student_id]?.status] || "#111"}">
            ${["hadir", "izin", "sakit", "alpha"]
              .map(
                (st) =>
                  `<option value="${st}" ${editMap[s.student_id]?.status === st ? "selected" : ""}>${st}</option>`,
              )
              .join("")}
          </select>
        </td>
        <td>
          <input class="keterangan-input edit-ket-input" data-sid="${s.student_id}"
            value="${editMap[s.student_id]?.keterangan || ""}" placeholder="Keterangan..." />
        </td>
      </tr>`,
      )
      .join("");

    document.getElementById("modalBody").innerHTML = `
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>No</th><th>NIS</th><th>Nama</th><th>Status</th><th>Keterangan</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn-success" id="btnSimpanEdit">Simpan Perubahan</button>
        <button class="ghost" id="btnBatalEdit">Batal</button>
      </div>`;

    document.getElementById("modalDetail").classList.add("open");

    document.getElementById("btnBatalEdit").onclick = () => {
      document.getElementById("modalDetail").classList.remove("open");
    };

    document.getElementById("btnSimpanEdit").onclick = async () => {
      const details = [];
      document.querySelectorAll(".edit-status-sel").forEach((sel) => {
        const sid = Number(sel.dataset.sid);
        const ket =
          document.querySelector(`.edit-ket-input[data-sid="${sid}"]`)?.value ||
          null;
        details.push({ student_id: sid, status: sel.value, keterangan: ket });
      });

      const putRes = await fetch(
        `/api/guru/attendance/session/${sessionId}/details`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ details }),
        },
      );
      const pd = await putRes.json();
      if (!putRes.ok) {
        showToast(pd.error || "Gagal menyimpan", "error");
        return;
      }
      showToast("Absensi berhasil diperbarui", "success");
      document.getElementById("modalDetail").classList.remove("open");
      await loadHistory();
    };
  } catch (err) {
    showToast("Terjadi kesalahan", "error");
  }
};

/* ============================================================
   HAPUS SESI
   ============================================================ */
window.deleteSession = async function (sessionId) {
  if (!(await confirmDelete("Sesi absensi ini akan dihapus secara permanen.")))
    return;
  try {
    const res = await fetch(`/api/guru/attendance/session/${sessionId}`, {
      method: "DELETE",
      credentials: "include",
    });
    const d = await res.json();
    if (!res.ok) {
      showToast(d.error || "Gagal menghapus", "error");
      return;
    }
    showToast("Sesi dihapus", "info");
    await loadHistory();
    await initDashboard();
  } catch (err) {
    showToast("Terjadi kesalahan", "error");
  }
};

/* TUTUP MODAL */
document.getElementById("modalClose").onclick = () => {
  document.getElementById("modalDetail").classList.remove("open");
};
document.getElementById("modalDetail").onclick = (e) => {
  if (e.target === document.getElementById("modalDetail"))
    document.getElementById("modalDetail").classList.remove("open");
};

/* ============================================================
   REKAP ABSENSI
   ============================================================ */
async function initRekap() {
  // Isi dropdown kelas rekap
  const rekapKelasSel = document.getElementById("rekapKelasSelect");
  rekapKelasSel.innerHTML = `<option value="">— Pilih Kelas —</option>`;

  if (TEACHER_CTX) {
    const ctx = TEACHER_CTX;
    const teacherType = ctx.teacher.teacher_type;

    if (teacherType === "kelas") {
      // Guru kelas → hanya kelasnya sendiri
      (ctx.classes || []).forEach((c) => {
        rekapKelasSel.innerHTML += `<option value="${c.id}">${c.nama}</option>`;
      });
    } else {
      // Guru mapel → hanya kelas yang pernah dia ajar sendiri,
      // diambil dari histori sesi absensi miliknya (bukan semua kelas publik)
      // supaya tidak tercampur dengan rekap guru kelas di kelas yang sama.
      try {
        const res = await fetch("/api/guru/attendance/history", {
          credentials: "include",
        });
        if (res.ok) {
          const d = await res.json();
          const sessions = d.data || [];
          // Deduplikasi kelas berdasarkan class_id
          const seen = new Set();
          sessions.forEach((s) => {
            if (!seen.has(s.class_id)) {
              seen.add(s.class_id);
              rekapKelasSel.innerHTML += `<option value="${s.class_id}">${s.class_name}</option>`;
            }
          });
          if (!seen.size) {
            rekapKelasSel.innerHTML += `<option value="" disabled>Belum ada kelas yang pernah diabsen</option>`;
          }
        }
      } catch (err) {
        console.error("initRekap (guru mapel):", err);
      }
    }
  }

  // Isi dropdown semester
  await loadAcademicPeriods();
}

async function loadAcademicPeriods() {
  try {
    const res = await fetch("/api/academic-periods/", {
      credentials: "include",
    });
    if (!res.ok) return;
    const d = await res.json();
    // Endpoint GET /api/academic-periods/ mengembalikan array langsung
    // (bukan dibungkus { data: [...] })
    PERIODS_CACHE = Array.isArray(d) ? d : [];
    const sel = document.getElementById("rekapSemesterSelect");
    sel.innerHTML =
      `<option value="">— Pilih Semester —</option>` +
      PERIODS_CACHE.map(
        (p) =>
          `<option value="${p.id}">${p.nama} ${p.is_active ? "(Aktif)" : ""}</option>`,
      ).join("");
  } catch (err) {
    console.error("loadAcademicPeriods:", err);
  }
}

document.getElementById("btnTampilkanRekap").onclick = async () => {
  const classId = document.getElementById("rekapKelasSelect").value;
  const semesterId = document.getElementById("rekapSemesterSelect").value;

  if (!classId) {
    showToast("Pilih kelas terlebih dahulu", "error");
    return;
  }
  if (!semesterId) {
    showToast("Pilih semester terlebih dahulu", "error");
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
      showToast(e.error || "Gagal memuat rekap", "error");
      return;
    }
    const d = await res.json();
    renderRekap(d, classId, semesterId);
  } catch (err) {
    showToast("Terjadi kesalahan", "error");
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
        <td>
          <div style="display:flex;align-items:center;gap:6px">
            <div class="progress-bar-wrap" style="width:60px">
              <div class="progress-bar" style="width:${pct}%;background:${pctColor}"></div>
            </div>
            <span style="font-size:12px;color:${pctColor};font-weight:600">${pct}%</span>
          </div>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  resultDiv.style.display = "block";

  // Aktifkan tombol export
  const exportBtn = document.getElementById("btnExportXlsx");
  exportBtn.disabled = false;
  exportBtn.onclick = () => {
    const teacherId = TEACHER_CTX?.teacher?.id || "";
    window.open(
      `/api/guru/attendance/export/semester/xlsx?class_id=${classId}&academic_period_id=${semesterId}&teacher_id=${teacherId}`,
      "_blank",
    );
  };
}

/* ============================================================
   GANTI PASSWORD
   ============================================================ */
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

/* ============================================================
   INIT UTAMA
   ============================================================ */
(async function init() {
  const userData = await me();
  if (!userData) return;

  // Jadwal
  const jadwals = await fetchJadwalList();
  renderJadwalList(jadwals || []);

  // Guru list
  await initGuru();

  // Siswa
  await loadKelasFilter();
  await loadSiswa();

  // Attendance context (dibutuhkan absensi & rekap)
  await loadAttendanceContext();

  // Dashboard
  await initDashboard();

  // Absensi
  await initAbsensi();

  // Rekap
  await initRekap();
})();
