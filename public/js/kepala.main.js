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

  document.getElementById("info").textContent = `Halo, ${user.displayName}`;
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
      if (page === "staff") {
        loadStaff();
        populateStaffJabatanFilter();
      }
      if (page === "siswa" && !SISWA_INITIALIZED) {
        initSiswa();
        SISWA_INITIALIZED = true;
      }
      if (page === "sarana") {
        loadKepalaSarana();
        loadKepalaSaranaStats();
        populateKepalaSaranaCategories();
        populateKepalaSaranaLocations();
      }
      if (page === "prasarana") {
        loadKepalaPrasarana();
        loadKepalaPrasaranaStats();
        populateKepalaPrasaranaTypes();
      }
      if (page === "ekstrakurikuler") {
        loadKepalaEkstra();
        loadKepalaEkstraStats();
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

  const SCHED_BREAK_SESSIONS = [4, 8];
  const SCHED_BREAK_DURATION = 30;
  const DAY_START_MINUTES = 7 * 60;

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

/* STAFF */
async function loadStaff() {
  const params = new URLSearchParams();
  const nama = document.getElementById("staffSearchNama")?.value.trim();
  const jabatan = document.getElementById("staffFilterJabatan")?.value;
  const status = document.getElementById("staffFilterStatus")?.value;
  if (nama) params.set("nama", nama);
  if (jabatan) params.set("jabatan", jabatan);
  if (status) params.set("status", status);

  const res = await fetch("/api/admin/staff?" + params.toString(), {
    credentials: "include",
  });
  if (!res.ok) return errorAlert("Gagal memuat data staff");
  const d = await res.json();

  const tbody = document.querySelector("#staffTable tbody");
  tbody.innerHTML = "";
  d.data.forEach((s) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.nik}</td>
      <td>${s.nama_lengkap}</td>
      <td>${s.jabatan}</td>
      <td>${s.status === "aktif" ? "Aktif" : "Nonaktif"}</td>
      <td>
        <button class="detail-staff" data-id="${s.id}">Detail</button>
      </td>`;
    tbody.appendChild(tr);
  });

  document.querySelectorAll(".edit-staff").forEach((b) => {
    b.onclick = async () => {
      const r = await fetch("/api/admin/staff/" + b.dataset.id, {
        credentials: "include",
      });
      const d = await r.json();
      const s = d.data;
      const f = document.getElementById("staffForm");
      f.nik.value = s.nik;
      f.nama_lengkap.value = s.nama_lengkap;
      f.jenis_kelamin.value = s.jenis_kelamin;
      f.agama.value = s.agama || "";
      f.tempat_lahir.value = s.tempat_lahir || "";
      f.tanggal_lahir.value = s.tanggal_lahir
        ? s.tanggal_lahir.substring(0, 10)
        : "";
      f.alamat.value = s.alamat || "";
      f.no_hp.value = s.no_hp || "";
      f.email.value = s.email || "";
      f.jabatan.value = s.jabatan;
      f.status_kepegawaian.value = s.status_kepegawaian || "";
      f.tanggal_mulai.value = s.tanggal_mulai
        ? s.tanggal_mulai.substring(0, 10)
        : "";
      f.status.value = s.status || "aktif";
      f.keterangan.value = s.keterangan || "";
      f.dataset.editId = s.id;
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
  });

  document.querySelectorAll(".detail-staff").forEach((b) => {
    b.onclick = () => showStaffDetail(b.dataset.id);
  });
}

async function populateStaffJabatanFilter() {
  const select = document.getElementById("staffFilterJabatan");
  if (!select) return;
  const res = await fetch("/api/admin/staff/jabatan", {
    credentials: "include",
  });
  if (!res.ok) return;
  const d = await res.json();
  const current = select.value;
  select.innerHTML = `<option value="">-- Semua Jabatan --</option>`;
  (d.data || []).forEach((j) => {
    const opt = document.createElement("option");
    opt.value = j;
    opt.textContent = j;
    select.appendChild(opt);
  });
  select.value = current;
}

async function showStaffDetail(id) {
  const r = await fetch("/api/admin/staff/" + id, { credentials: "include" });
  if (!r.ok) return errorAlert("Gagal memuat detail staff");
  const d = await r.json();
  const s = d.data;

  document.getElementById("staffDetailContent").innerHTML = `
    <h1>Detail Staff</h1>
    <table>
      <tr><th>NIK</th><td>${s.nik}</td></tr>
      <tr><th>Nama Lengkap</th><td>${s.nama_lengkap}</td></tr>
      <tr><th>Jenis Kelamin</th><td>${s.jenis_kelamin === "L" ? "Laki-laki" : "Perempuan"}</td></tr>
      <tr><th>Agama</th><td>${s.agama || "-"}</td></tr>
      <tr><th>Tempat, Tanggal Lahir</th><td>${s.tempat_lahir || "-"}, ${s.tanggal_lahir ? s.tanggal_lahir.substring(0, 10) : "-"}</td></tr>
      <tr><th>Alamat</th><td>${s.alamat || "-"}</td></tr>
      <tr><th>No HP</th><td>${s.no_hp || "-"}</td></tr>
      <tr><th>Email</th><td>${s.email || "-"}</td></tr>
      <tr><th>Jabatan</th><td>${s.jabatan}</td></tr>
      <tr><th>Status Kepegawaian</th><td>${s.status_kepegawaian || "-"}</td></tr>
      <tr><th>Tanggal Mulai</th><td>${s.tanggal_mulai ? s.tanggal_mulai.substring(0, 10) : "-"}</td></tr>
      <tr><th>Status</th><td>${s.status === "aktif" ? "Aktif" : "Nonaktif"}</td></tr>
      <tr><th>Keterangan</th><td>${s.keterangan || "-"}</td></tr>
    </table>
  `;

  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document.getElementById("page-staff-detail").classList.add("active");
}

document.getElementById("staffDetailBack").onclick = () => {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document.getElementById("page-staff").classList.add("active");
  loadStaff();
};

document.getElementById("staffSearchNama").oninput = () => loadStaff();
document.getElementById("staffFilterJabatan").onchange = () => loadStaff();
document.getElementById("staffFilterStatus").onchange = () => loadStaff();

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

/* =========================================================
   SARANA & PRASARANA - KEPALA SEKOLAH
   READ ONLY
========================================================= */

const kepalaConditionLabel = {
  baik: "Baik",
  rusak_ringan: "Rusak Ringan",
  rusak_berat: "Rusak Berat",
};

const kepalaStatusLabel = {
  aktif: "Aktif",
  nonaktif: "Nonaktif",
};

function kepalaEscapeHtml(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showKepalaPage(pageName) {
  document
    .querySelectorAll(".page")
    .forEach((page) => page.classList.remove("active"));

  const page = document.getElementById(`page-${pageName}`);

  if (page) {
    page.classList.add("active");
  }
}

/* =========================================================
   EKSTRAKURIKULER - KEPALA SEKOLAH
   READ ONLY
========================================================= */

const kepalaEkstraDayLabel = {
  senin: "Senin",
  selasa: "Selasa",
  rabu: "Rabu",
  kamis: "Kamis",
  jumat: "Jumat",
  sabtu: "Sabtu",
};

const kepalaEkstraStatusLabel = {
  aktif: "Aktif",
  nonaktif: "Nonaktif",
};

function kepalaFormatTime(time) {
  if (!time) return "-";

  return String(time).substring(0, 5);
}

/* =========================
   STATISTIK
========================= */

async function loadKepalaEkstraStats() {
  try {
    const res = await fetch("/api/admin/extracurriculars/stats/kepala", {
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Gagal memuat statistik ekstrakurikuler");
    }

    const d = await res.json();

    const stats = d.data || {};

    document.getElementById("kepalaEkstraStatTotal").textContent =
      stats.total || 0;

    document.getElementById("kepalaEkstraStatAktif").textContent =
      stats.aktif || 0;

    document.getElementById("kepalaEkstraStatPeserta").textContent =
      stats.total_peserta || 0;
  } catch (err) {
    console.error("loadKepalaEkstraStats:", err);
  }
}

async function loadKepalaEkstra() {
  const tbody = document.querySelector("#kepalaEkstraTable tbody");

  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td
        colspan="9"
        class="table-loading-cell"
      >
        Memuat...
      </td>
    </tr>
  `;

  try {
    const res = await fetch("/api/admin/extracurriculars", {
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Gagal memuat data ekstrakurikuler");
    }

    const d = await res.json();

    const rows = d.data || [];

    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td
            colspan="9"
            style="text-align:center;color:#666"
          >
            Belum ada data ekstrakurikuler
          </td>
        </tr>
      `;

      return;
    }

    tbody.innerHTML = rows
      .map((item, index) => {
        const activeMembers = Number(item.active_members || 0);

        const maxMembers =
          item.max_members !== null && item.max_members !== undefined
            ? Number(item.max_members)
            : null;

        const participantText =
          maxMembers !== null
            ? `${activeMembers} / ${maxMembers}`
            : `${activeMembers}`;

        return `
          <tr>

            <td>${index + 1}</td>

            <td>
              <strong>
                ${kepalaEscapeHtml(item.name)}
              </strong>
            </td>

            <td>
              ${kepalaEscapeHtml(item.teacher_name)}
            </td>

            <td>
              ${
                kepalaEkstraDayLabel[item.day_of_week] ||
                kepalaEscapeHtml(item.day_of_week)
              }
            </td>

            <td>
              ${kepalaFormatTime(item.start_time)}
              -
              ${kepalaFormatTime(item.end_time)}
            </td>

            <td>
              ${kepalaEscapeHtml(item.location)}
            </td>

            <td>
              ${participantText}
            </td>

            <td>
              ${
                kepalaEkstraStatusLabel[item.status] ||
                kepalaEscapeHtml(item.status)
              }
            </td>

            <td>
              <button
                type="button"
                class="btn-detail"
                data-kepala-ekstra-detail="${item.id}"
              >
                Detail
              </button>
            </td>

          </tr>
        `;
      })
      .join("");

    /*
     * Pasang event tombol Detail
     */
    tbody.querySelectorAll("[data-kepala-ekstra-detail]").forEach((button) => {
      button.onclick = () => {
        showKepalaEkstraDetail(button.dataset.kepalaEkstraDetail);
      };
    });
  } catch (err) {
    console.error("loadKepalaEkstra:", err);

    tbody.innerHTML = `
      <tr>
        <td
          colspan="9"
          style="text-align:center;color:#dc2626"
        >
          Gagal memuat data ekstrakurikuler
        </td>
      </tr>
    `;
  }
}

async function showKepalaEkstraDetail(id) {
  try {
    const res = await fetch(`/api/admin/extracurriculars/kepala/${id}`, {
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Gagal memuat detail ekstrakurikuler");
    }

    const d = await res.json();

    const item = d.data;
    const members = d.members || [];

    /* =========================
       DETAIL INFORMASI
    ========================= */

    document.getElementById("kepalaEkstraDetailContent").innerHTML = `

      <div class="card-1">

        <div>
          <strong style="font-size:22px">
            ${kepalaEscapeHtml(item.name)}
          </strong>
        </div>

      </div>

      <table>

        <tbody>

          <tr>
            <th>Pembina</th>
            <td>
              ${kepalaEscapeHtml(item.teacher_name)}
            </td>
          </tr>

          <tr>
            <th>Hari</th>
            <td>
              ${
                kepalaEkstraDayLabel[item.day_of_week] ||
                kepalaEscapeHtml(item.day_of_week)
              }
            </td>
          </tr>

          <tr>
            <th>Waktu</th>
            <td>
              ${kepalaFormatTime(item.start_time)}
              -
              ${kepalaFormatTime(item.end_time)}
            </td>
          </tr>

          <tr>
            <th>Lokasi</th>
            <td>
              ${kepalaEscapeHtml(item.location)}
            </td>
          </tr>

          <tr>
            <th>Peserta</th>
            <td>
              <strong>
                ${Number(item.active_members || 0)}
                /
                ${item.max_members ?? "-"}
                siswa
              </strong>
            </td>
          </tr>

          <tr>
            <th>Status</th>
            <td>
              ${
                kepalaEkstraStatusLabel[item.status] ||
                kepalaEscapeHtml(item.status)
              }
            </td>
          </tr>

        </tbody>

      </table>


      <div style="margin-top:20px">

        <h3>Deskripsi</h3>

        <p>
          ${kepalaEscapeHtml(item.description)}
        </p>

      </div>

    `;

    /* =========================
       DAFTAR ANGGOTA
    ========================= */

    const tbody = document.querySelector("#kepalaEkstraMemberTable tbody");

    if (!members.length) {
      tbody.innerHTML = `
        <tr>
          <td
            colspan="6"
            style="text-align:center;color:#666"
          >
            Belum ada anggota
          </td>
        </tr>
      `;
    } else {
      tbody.innerHTML = members
        .map((member, index) => {
          return `
            <tr>

              <td>
                ${index + 1}
              </td>

              <td>
                ${kepalaEscapeHtml(member.nis)}
              </td>

              <td>
                ${kepalaEscapeHtml(member.student_name)}
              </td>

              <td>
                ${kepalaEscapeHtml(member.kelas_nama)}
              </td>

              <td>
                ${
                  member.join_date
                    ? String(member.join_date).substring(0, 10)
                    : "-"
                }
              </td>

              <td>
                ${member.status === "aktif" ? "Aktif" : "Keluar"}
              </td>

            </tr>
          `;
        })
        .join("");
    }

    /* pindah ke halaman detail */

    showKepalaPage("ekstrakurikuler-detail");
  } catch (err) {
    console.error("showKepalaEkstraDetail:", err);

    errorAlert("Gagal memuat detail ekstrakurikuler");
  }
}

document
  .getElementById("kepalaEkstraDetailBack")
  .addEventListener("click", () => {
    showKepalaPage("ekstrakurikuler");

    loadKepalaEkstra();
    loadKepalaEkstraStats();
  });

/* =========================================================
   SARANA
========================================================= */

async function loadKepalaSaranaStats() {
  try {
    const res = await fetch("/api/admin/facilities/stats", {
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Gagal memuat statistik sarana");
    }

    const d = await res.json();
    const stats = d.data || {};

    document.getElementById("kepalaSaranaStatTotal").textContent =
      stats.total || 0;

    document.getElementById("kepalaSaranaStatBaik").textContent =
      stats.baik || 0;

    document.getElementById("kepalaSaranaStatRusakRingan").textContent =
      stats.rusak_ringan || 0;

    document.getElementById("kepalaSaranaStatRusakBerat").textContent =
      stats.rusak_berat || 0;
  } catch (err) {
    console.error("loadKepalaSaranaStats:", err);
  }
}

async function populateKepalaSaranaCategories() {
  const select = document.getElementById("kepalaSaranaFilterCategory");

  if (!select) return;

  try {
    const currentValue = select.value;

    const res = await fetch("/api/admin/facility-categories", {
      credentials: "include",
    });

    if (!res.ok) return;

    const d = await res.json();
    const categories = d.data || [];

    select.innerHTML = `<option value="">Semua Kategori</option>`;

    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = category.name;
      select.appendChild(option);
    });

    select.value = currentValue;
  } catch (err) {
    console.error("populateKepalaSaranaCategories:", err);
  }
}

async function populateKepalaSaranaLocations() {
  const select = document.getElementById("kepalaSaranaFilterLocation");

  if (!select) return;

  try {
    const currentValue = select.value;

    const res = await fetch("/api/admin/facilities/locations", {
      credentials: "include",
    });

    if (!res.ok) return;

    const d = await res.json();
    const locations = d.data || [];

    select.innerHTML = `<option value="">Semua Lokasi</option>`;

    locations.forEach((location) => {
      const option = document.createElement("option");
      option.value = location;
      option.textContent = location;
      select.appendChild(option);
    });

    select.value = currentValue;
  } catch (err) {
    console.error("populateKepalaSaranaLocations:", err);
  }
}

async function loadKepalaSarana() {
  const search =
    document.getElementById("kepalaSaranaSearch")?.value.trim() || "";

  const categoryId =
    document.getElementById("kepalaSaranaFilterCategory")?.value || "";

  const condition =
    document.getElementById("kepalaSaranaFilterCondition")?.value || "";

  const status =
    document.getElementById("kepalaSaranaFilterStatus")?.value || "";

  const location =
    document.getElementById("kepalaSaranaFilterLocation")?.value || "";

  const params = new URLSearchParams();

  if (search) params.set("search", search);
  if (categoryId) params.set("category_id", categoryId);
  if (condition) params.set("condition_status", condition);
  if (status) params.set("status", status);
  if (location) params.set("location", location);

  const tbody = document.querySelector("#kepalaSaranaTable tbody");

  try {
    const res = await fetch(`/api/admin/facilities?${params.toString()}`, {
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Gagal memuat data sarana");
    }

    const d = await res.json();
    const rows = d.data || [];

    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center;color:#666">
            Tidak ada data sarana
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = rows
      .map(
        (item) => `
          <tr>
            <td>${kepalaEscapeHtml(item.code)}</td>
            <td>${kepalaEscapeHtml(item.name)}</td>
            <td>${kepalaEscapeHtml(item.category_name)}</td>
            <td>${kepalaEscapeHtml(item.quantity)}</td>
            <td>
              ${
                kepalaConditionLabel[item.condition_status] ||
                kepalaEscapeHtml(item.condition_status)
              }
            </td>
            <td>${kepalaEscapeHtml(item.location)}</td>
            <td>
              ${kepalaStatusLabel[item.status] || kepalaEscapeHtml(item.status)}
            </td>
            <td>
              <button
                type="button"
                class="btn-detail"
                data-kepala-sarana-detail="${item.id}"
              >
                Detail
              </button>
            </td>
          </tr>
        `,
      )
      .join("");

    tbody.querySelectorAll("[data-kepala-sarana-detail]").forEach((button) => {
      button.onclick = () => {
        showKepalaSaranaDetail(button.dataset.kepalaSaranaDetail);
      };
    });
  } catch (err) {
    console.error("loadKepalaSarana:", err);

    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;color:#dc2626">
          Gagal memuat data sarana
        </td>
      </tr>
    `;
  }
}

async function showKepalaSaranaDetail(id) {
  try {
    const res = await fetch(`/api/admin/facilities/${id}`, {
      credentials: "include",
    });

    if (!res.ok) {
      return errorAlert("Gagal memuat detail sarana");
    }

    const d = await res.json();
    const item = d.data;
    const maintenance = d.maintenance || [];

    document.getElementById("kepalaSaranaDetailContent").innerHTML = `
      <div class="card">
        <table>
          <tbody>
            <tr>
              <th>Kode</th>
              <td>${kepalaEscapeHtml(item.code)}</td>
            </tr>
            <tr>
              <th>Nama</th>
              <td>${kepalaEscapeHtml(item.name)}</td>
            </tr>
            <tr>
              <th>Kategori</th>
              <td>${kepalaEscapeHtml(item.category_name)}</td>
            </tr>
            <tr>
              <th>Jumlah</th>
              <td>${kepalaEscapeHtml(item.quantity)}</td>
            </tr>
            <tr>
              <th>Kondisi</th>
              <td>
                ${
                  kepalaConditionLabel[item.condition_status] ||
                  kepalaEscapeHtml(item.condition_status)
                }
              </td>
            </tr>
            <tr>
              <th>Lokasi</th>
              <td>${kepalaEscapeHtml(item.location)}</td>
            </tr>
            <tr>
              <th>Tanggal Pengadaan</th>
              <td>
                ${
                  item.procurement_date
                    ? String(item.procurement_date).slice(0, 10)
                    : "-"
                }
              </td>
            </tr>
            <tr>
              <th>Sumber Dana</th>
              <td>${kepalaEscapeHtml(item.funding_source)}</td>
            </tr>
            <tr>
              <th>Status</th>
              <td>
                ${
                  kepalaStatusLabel[item.status] ||
                  kepalaEscapeHtml(item.status)
                }
              </td>
            </tr>
            <tr>
              <th>Deskripsi</th>
              <td>${kepalaEscapeHtml(item.description)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    const maintenanceBody = document.querySelector(
      "#kepalaSaranaMaintenanceTable tbody",
    );

    if (!maintenance.length) {
      maintenanceBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;color:#666">
            Belum ada riwayat pemeliharaan.
          </td>
        </tr>
      `;
    } else {
      maintenanceBody.innerHTML = maintenance
        .map(
          (item) => `
            <tr>
              <td>
                ${
                  item.maintenance_date
                    ? String(item.maintenance_date).slice(0, 10)
                    : "-"
                }
              </td>
              <td>${kepalaEscapeHtml(item.issue_description)}</td>
              <td>${kepalaEscapeHtml(item.action_taken)}</td>
              <td>
                Rp ${Number(item.cost || 0).toLocaleString("id-ID")}
              </td>
              <td>${kepalaEscapeHtml(item.status)}</td>
              <td>${kepalaEscapeHtml(item.notes)}</td>
            </tr>
          `,
        )
        .join("");
    }

    showKepalaPage("sarana-detail");
  } catch (err) {
    console.error("showKepalaSaranaDetail:", err);
    errorAlert("Terjadi kesalahan saat memuat detail sarana");
  }
}

/* Event filter Sarana */

document
  .getElementById("kepalaSaranaSearch")
  .addEventListener("input", loadKepalaSarana);

document
  .getElementById("kepalaSaranaFilterCategory")
  .addEventListener("change", loadKepalaSarana);

document
  .getElementById("kepalaSaranaFilterCondition")
  .addEventListener("change", loadKepalaSarana);

document
  .getElementById("kepalaSaranaFilterStatus")
  .addEventListener("change", loadKepalaSarana);

document
  .getElementById("kepalaSaranaFilterLocation")
  .addEventListener("change", loadKepalaSarana);

document
  .getElementById("kepalaSaranaDetailBack")
  .addEventListener("click", () => {
    showKepalaPage("sarana");
    loadKepalaSarana();
  });

/* =========================================================
   PRASARANA
========================================================= */

async function loadKepalaPrasaranaStats() {
  try {
    const res = await fetch("/api/admin/infrastructure/stats", {
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Gagal memuat statistik prasarana");
    }

    const d = await res.json();
    const stats = d.data || {};

    document.getElementById("kepalaPrasaranaStatTotal").textContent =
      stats.total || 0;

    document.getElementById("kepalaPrasaranaStatBaik").textContent =
      stats.baik || 0;

    document.getElementById("kepalaPrasaranaStatRusakRingan").textContent =
      stats.rusak_ringan || 0;

    document.getElementById("kepalaPrasaranaStatRusakBerat").textContent =
      stats.rusak_berat || 0;
  } catch (err) {
    console.error("loadKepalaPrasaranaStats:", err);
  }
}

async function populateKepalaPrasaranaTypes() {
  const select = document.getElementById("kepalaPrasaranaFilterType");

  if (!select) return;

  try {
    const currentValue = select.value;

    const res = await fetch("/api/admin/infrastructure/types", {
      credentials: "include",
    });

    if (!res.ok) return;

    const d = await res.json();
    const types = d.data || [];

    select.innerHTML = `<option value="">Semua Jenis</option>`;

    types.forEach((type) => {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      select.appendChild(option);
    });

    select.value = currentValue;
  } catch (err) {
    console.error("populateKepalaPrasaranaTypes:", err);
  }
}

async function loadKepalaPrasarana() {
  const search =
    document.getElementById("kepalaPrasaranaSearch")?.value.trim() || "";

  const type =
    document.getElementById("kepalaPrasaranaFilterType")?.value || "";

  const condition =
    document.getElementById("kepalaPrasaranaFilterCondition")?.value || "";

  const status =
    document.getElementById("kepalaPrasaranaFilterStatus")?.value || "";

  const params = new URLSearchParams();

  if (search) params.set("search", search);
  if (type) params.set("type", type);
  if (condition) params.set("condition_status", condition);
  if (status) params.set("status", status);

  const tbody = document.querySelector("#kepalaPrasaranaTable tbody");

  try {
    const res = await fetch(`/api/admin/infrastructure?${params.toString()}`, {
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Gagal memuat data prasarana");
    }

    const d = await res.json();
    const rows = d.data || [];

    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align:center;color:#666">
            Tidak ada data prasarana
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = rows
      .map(
        (item) => `
          <tr>
            <td>${kepalaEscapeHtml(item.code)}</td>
            <td>${kepalaEscapeHtml(item.name)}</td>
            <td>${kepalaEscapeHtml(item.type)}</td>
            <td>${kepalaEscapeHtml(item.capacity)}</td>
            <td>
              ${
                item.area_size !== null && item.area_size !== undefined
                  ? `${kepalaEscapeHtml(item.area_size)} m²`
                  : "-"
              }
            </td>
            <td>${kepalaEscapeHtml(item.location)}</td>
            <td>
              ${
                kepalaConditionLabel[item.condition_status] ||
                kepalaEscapeHtml(item.condition_status)
              }
            </td>
            <td>
              ${kepalaStatusLabel[item.status] || kepalaEscapeHtml(item.status)}
            </td>
            <td>
              <button
                type="button"
                class="btn-detail"
                data-kepala-prasarana-detail="${item.id}"
              >
                Detail
              </button>
            </td>
          </tr>
        `,
      )
      .join("");

    tbody
      .querySelectorAll("[data-kepala-prasarana-detail]")
      .forEach((button) => {
        button.onclick = () => {
          showKepalaPrasaranaDetail(button.dataset.kepalaPrasaranaDetail);
        };
      });
  } catch (err) {
    console.error("loadKepalaPrasarana:", err);

    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center;color:#dc2626">
          Gagal memuat data prasarana
        </td>
      </tr>
    `;
  }
}

async function showKepalaPrasaranaDetail(id) {
  try {
    const res = await fetch(`/api/admin/infrastructure/${id}`, {
      credentials: "include",
    });

    if (!res.ok) {
      return errorAlert("Gagal memuat detail prasarana");
    }

    const d = await res.json();
    const item = d.data;

    document.getElementById("kepalaPrasaranaDetailContent").innerHTML = `
      <div class="card">
        <table>
          <tbody>
            <tr>
              <th>Kode</th>
              <td>${kepalaEscapeHtml(item.code)}</td>
            </tr>
            <tr>
              <th>Nama</th>
              <td>${kepalaEscapeHtml(item.name)}</td>
            </tr>
            <tr>
              <th>Jenis</th>
              <td>${kepalaEscapeHtml(item.type)}</td>
            </tr>
            <tr>
              <th>Kapasitas</th>
              <td>${kepalaEscapeHtml(item.capacity)}</td>
            </tr>
            <tr>
              <th>Luas</th>
              <td>
                ${
                  item.area_size !== null && item.area_size !== undefined
                    ? `${kepalaEscapeHtml(item.area_size)} m²`
                    : "-"
                }
              </td>
            </tr>
            <tr>
              <th>Lokasi</th>
              <td>${kepalaEscapeHtml(item.location)}</td>
            </tr>
            <tr>
              <th>Kondisi</th>
              <td>
                ${
                  kepalaConditionLabel[item.condition_status] ||
                  kepalaEscapeHtml(item.condition_status)
                }
              </td>
            </tr>
            <tr>
              <th>Status</th>
              <td>
                ${
                  kepalaStatusLabel[item.status] ||
                  kepalaEscapeHtml(item.status)
                }
              </td>
            </tr>
            <tr>
              <th>Deskripsi</th>
              <td>${kepalaEscapeHtml(item.description)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    showKepalaPage("prasarana-detail");
  } catch (err) {
    console.error("showKepalaPrasaranaDetail:", err);
    errorAlert("Terjadi kesalahan saat memuat detail prasarana");
  }
}

/* Event filter Prasarana */

document
  .getElementById("kepalaPrasaranaSearch")
  .addEventListener("input", loadKepalaPrasarana);

document
  .getElementById("kepalaPrasaranaFilterType")
  .addEventListener("change", loadKepalaPrasarana);

document
  .getElementById("kepalaPrasaranaFilterCondition")
  .addEventListener("change", loadKepalaPrasarana);

document
  .getElementById("kepalaPrasaranaFilterStatus")
  .addEventListener("change", loadKepalaPrasarana);

document
  .getElementById("kepalaPrasaranaDetailBack")
  .addEventListener("click", () => {
    showKepalaPage("prasarana");
    loadKepalaPrasarana();
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
