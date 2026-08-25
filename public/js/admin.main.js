// public/js/admin.main.js
import {
  successAlert,
  errorAlert,
  warningAlert,
  confirmDelete,
  confirmAction,
} from "./swal-utils.js";

// --- AUTH & INIT (tidak berubah) -------------------------
async function me() {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (!res.ok) return (window.location.href = "/login.html");

  const d = await res.json();
  const user = d.user;

  if (!user || user.role !== "admin") {
    errorAlert("Akses ditolak");
    return (window.location.href = "/login.html");
  }

  document.getElementById("info").textContent =
    `Halo, ${user.displayName || user.username}`;
}

/* SIDEBAR */
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
      if (page === "kelas") {
        populateWaliGuru();
        populateKelasFilter();
      }
      if (page === "penjadwalan") {
        // ensure sched-specific population runs when opening page
        populateWaliGuru(); // just ensure teacher list available
        sched_populateClassesFromDB();
        sched_populateSubjectsFromDB();
        sched_renderAllLocalSchedules();
      }
    }
    sidebar.classList.remove("active");
    const overlay = document.querySelector(".sidebar-overlay");
    if (overlay) overlay.remove();
  };
});

document.getElementById("goSchedule").onclick = () =>
  (window.location.href = "/index.html");

document.getElementById("logoutBtn").onclick = async () => {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
  window.location.href = "/login.html";
};

/* DASHBOARD */
async function loadDashboard() {
  const res = await fetch("/api/admin/dashboard", { credentials: "include" });
  if (!res.ok) return;
  const d = await res.json();
  document.getElementById("count-guru").textContent = d.guru;
  document.getElementById("count-siswa").textContent = d.siswa;
  document.getElementById("count-kelas").textContent = d.kelas;
}

/* GURU */
async function loadGuru() {
  const res = await fetch("/api/admin/guru", { credentials: "include" });
  if (!res.ok) return errorAlert("Gagal memuat data guru");
  const d = await res.json();

  // ambil mapel yang diampu tiap guru (dari teacher_subjects, via endpoint
  // yang sama dipakai halaman Penjadwalan) supaya kelihatan di kolom baru
  // dan supaya guru kelas yang belum di-assign mapel gampang ketahuan.
  let subjectsByTeacherId = new Map();
  try {
    const r2 = await fetch("/api/admin/guru-jadwal", {
      credentials: "include",
    });
    if (r2.ok) {
      const d2 = await r2.json();
      (d2.data || []).forEach((t) => {
        subjectsByTeacherId.set(t.id, t.subjects || []);
      });
    }
  } catch (e) {
    console.warn("Gagal memuat mapel guru:", e);
  }

  const tbody = document.querySelector("#guruTable tbody");
  tbody.innerHTML = "";
  d.data.forEach((g) => {
    const subjects = subjectsByTeacherId.get(g.id) || [];
    const mapelLabel = subjects.length
      ? subjects.join(", ")
      : `<span style="color:#dc2626">Belum ada mapel!</span>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${g.nama}</td>
      <td>${g.nip || ""}</td>
      <td>${g.jk || ""}</td>
      <td>${g.agama || ""}</td>
      <td>${g.hp || ""}</td>
      <td>${g.email || ""}</td>
      <td>${g.keterangan || ""}</td>
      <td>
        ${mapelLabel}<br />
        <button type="button" class="ghost kelola-mapel" data-id="${g.id}" data-nama="${g.nama}">
          Kelola Mapel
        </button>
      </td>
      <td>
        <button class="edit-guru" data-id="${g.id}">Edit</button>
        <button class="del-guru" data-id="${g.id}">Hapus</button>
      </td>`;
    tbody.appendChild(tr);
  });

  document.querySelectorAll(".del-guru").forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmDelete("Data guru ini akan dihapus secara permanen.")))
        return;
      await fetch("/api/admin/guru/" + b.dataset.id, {
        method: "DELETE",
        credentials: "include",
      });
      loadGuru();
    };
  });

  document.querySelectorAll(".edit-guru").forEach((b) => {
    b.onclick = async () => {
      const r = await fetch("/api/admin/guru/" + b.dataset.id, {
        credentials: "include",
      });
      const d = await r.json();
      const g = d.data;
      const f = document.getElementById("guruForm");
      f.nama.value = g.nama;
      f.nip.value = g.nip || "";
      f.jk.value = g.jk || "L";
      f.agama.value = g.agama || "";
      f.hp.value = g.hp || "";
      f.email.value = g.email || "";
      f.username.value = g.username || "";
      f.password.value = g.password || "";
      f.teacher_type.value = g.teacher_type || "kelas";
      f.keterangan.value = g.keterangan || "";
      f.dataset.editId = g.id;
    };
  });

  document.querySelectorAll(".kelola-mapel").forEach((b) => {
    b.onclick = () => openMapelModal(b.dataset.id, b.dataset.nama);
  });
}

/* ---------- Modal "Kelola Mapel Diampu" ---------- */
let allSubjectsCache = null;
async function openMapelModal(teacherId, teacherNama) {
  const overlay = document.getElementById("mapelModalOverlay");
  const list = document.getElementById("mapelModalList");
  const title = document.getElementById("mapelModalTitle");
  title.textContent = `Kelola Mapel Diampu — ${teacherNama}`;
  list.innerHTML = "Memuat...";
  overlay.style.display = "flex";

  if (!allSubjectsCache) {
    const r = await fetch("/api/admin/subjects", { credentials: "include" });
    const d = await r.json();
    allSubjectsCache = d.data || [];
  }

  const rAssigned = await fetch(`/api/admin/guru/${teacherId}/subjects`, {
    credentials: "include",
  });
  const dAssigned = await rAssigned.json();
  const assignedIds = new Set((dAssigned.data || []).map((x) => Number(x)));

  list.innerHTML = allSubjectsCache
    .map(
      (s) => `
      <label style="display:flex; align-items:center; gap:8px;">
        <input type="checkbox" class="mapel-check" value="${s.id}" ${
          assignedIds.has(Number(s.id)) ? "checked" : ""
        } />
        <span>${s.kode ? s.kode + " — " : ""}${s.nama}</span>
      </label>`,
    )
    .join("");

  document.getElementById("mapelModalSave").onclick = async () => {
    const ids = Array.from(
      document.querySelectorAll(".mapel-check:checked"),
    ).map((cb) => Number(cb.value));
    await fetch(`/api/admin/guru/${teacherId}/subjects`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject_ids: ids }),
    });
    overlay.style.display = "none";
    loadGuru();
    // kalau modal dibuka dari halaman Penjadwalan, refresh juga daftar guru di sana
    if (typeof sched_populateTeachersFromDB === "function") {
      sched_populateTeachersFromDB();
    }
  };
  document.getElementById("mapelModalCancel").onclick = () => {
    overlay.style.display = "none";
  };
}

document.getElementById("guruForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    nama: f.nama.value,
    nip: f.nip.value,
    jk: f.jk.value,
    agama: f.agama.value,
    hp: f.hp.value,
    email: f.email.value,
    username: f.username.value,
    password: f.password.value,
    teacher_type: f.teacher_type.value,
    keterangan: f.keterangan.value,
  };
  const url = f.dataset.editId
    ? "/api/admin/guru/" + f.dataset.editId
    : "/api/admin/guru";
  const method = f.dataset.editId ? "PUT" : "POST";
  await fetch(url, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  delete f.dataset.editId;
  f.reset();
  loadGuru();
};

/* KELAS */
async function populateWaliGuru() {
  const select = document.getElementById("kelasWali");
  if (!select) return;
  const res = await fetch("/api/admin/guru", { credentials: "include" });
  if (!res.ok) {
    console.error("Gagal memuat guru");
    return;
  }
  const d = await res.json();
  select.innerHTML = `<option value="">-- Pilih Guru --</option>`;
  d.data.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.nama;
    select.appendChild(opt);
  });
}

/* populate dropdown filter di page Kelas (untuk lihat daftar siswa per kelas) */
async function populateKelasFilter() {
  const sel = document.getElementById("kelasFilter");
  if (!sel) return;
  const res = await fetch("/api/admin/kelas", { credentials: "include" });
  if (!res.ok) {
    console.error("Gagal memuat daftar kelas");
    return;
  }
  const d = await res.json();
  sel.innerHTML = `<option value="">-- Pilih Kelas --</option>`;
  d.data.forEach((k) => {
    const label =
      k.tingkat && k.section ? `${k.tingkat}.${k.section}` : k.nama || "Kelas";
    sel.innerHTML += `<option value="${k.id}">${label}</option>`;
  });
}

/* render siswa ke table #kelasSiswaTable */
function renderSiswaPerKelas(rows) {
  const tbody = document.querySelector("#kelasSiswaTable tbody");
  tbody.innerHTML = "";
  if (!rows || rows.length === 0) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    tr.innerHTML = `<td colspan="6" style="text-align:center; color:#666;">Belum ada siswa di kelas ini</td>`;
    tbody.appendChild(tr);
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

/* loadKelas (list kelas table) */
async function loadKelas() {
  const res = await fetch("/api/admin/kelas", { credentials: "include" });
  if (!res.ok) return errorAlert("Gagal memuat data kelas");
  const d = await res.json();
  const tbody = document.querySelector("#kelasTable tbody");
  tbody.innerHTML = "";
  d.data.forEach((k) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${k.tingkat}.${k.section}</td>
      <td>${k.wali_nama || ""}</td>
      <td>
        <button class="edit-kelas" data-id="${k.id}">Edit</button>
        <button class="del-kelas" data-id="${k.id}">Hapus</button>
      </td>`;
    tbody.appendChild(tr);
  });

  document.querySelectorAll(".del-kelas").forEach((b) => {
    b.onclick = async () => {
      if (
        !(await confirmDelete("Data kelas ini akan dihapus secara permanen."))
      )
        return;
      await fetch("/api/admin/kelas/" + b.dataset.id, {
        method: "DELETE",
        credentials: "include",
      });
      loadKelas();
      populateClassSelect();
    };
  });

  document.querySelectorAll(".edit-kelas").forEach((b) => {
    b.onclick = async () => {
      await populateWaliGuru();
      const r = await fetch("/api/admin/kelas/" + b.dataset.id, {
        credentials: "include",
      });
      const d = await r.json();
      const k = d.data;
      const f = document.getElementById("kelasForm");
      f.tingkat.value = k.tingkat;
      f.section.value = k.section;
      document.getElementById("kelasWali").value = k.wali_id || "";
      f.dataset.editId = k.id;
    };
  });
  populateKelasFilter();
}

/* KELAS FORM submit */
document.getElementById("kelasForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    tingkat: f.tingkat.value,
    section: f.section.value,
    wali_id: document.getElementById("kelasWali").value || null,
  };
  const url = f.dataset.editId
    ? "/api/admin/kelas/" + f.dataset.editId
    : "/api/admin/kelas";
  const method = f.dataset.editId ? "PUT" : "POST";
  await fetch(url, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  delete f.dataset.editId;
  f.reset();
  loadKelas();
  populateClassSelect();
};

/* SISWA */
async function populateClassSelect() {
  const sel = document.getElementById("siswaKelas");
  if (!sel) return;
  const res = await fetch("/api/admin/kelas", { credentials: "include" });
  const d = await res.json();
  sel.innerHTML = `<option value="">-- Pilih Kelas --</option>`;
  d.data.forEach((k) => {
    sel.innerHTML += `<option value="${k.id}">${k.tingkat}.${k.section}</option>`;
  });
}

async function loadSiswa() {
  const res = await fetch("/api/admin/siswa", { credentials: "include" });
  if (!res.ok) return errorAlert("Gagal memuat data siswa");
  const d = await res.json();
  const tbody = document.querySelector("#siswaTable tbody");
  tbody.innerHTML = "";
  d.data.forEach((s) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.nis}</td>
      <td>${s.nama}</td>
      <td>${s.jk || ""}</td>
      <td>${s.agama || ""}</td>
      <td>${s.kelas_nama || ""}</td>
      <td>${s.hp_ortu || ""}</td>
      <td>
        <button class="edit-siswa" data-id="${s.id}">Edit</button>
        <button class="del-siswa" data-id="${s.id}">Hapus</button>
      </td>`;
    tbody.appendChild(tr);
  });

  // attach listeners AFTER rendering
  document.querySelectorAll(".del-siswa").forEach((b) => {
    b.onclick = async () => {
      if (
        !(await confirmDelete("Data siswa ini akan dihapus secara permanen."))
      )
        return;
      await fetch("/api/admin/siswa/" + b.dataset.id, {
        method: "DELETE",
        credentials: "include",
      });
      loadSiswa();
    };
  });

  document.querySelectorAll(".edit-siswa").forEach((b) => {
    b.onclick = async () => {
      const r = await fetch("/api/admin/siswa/" + b.dataset.id, {
        credentials: "include",
      });
      const d = await r.json();
      const s = d.data;
      const f = document.getElementById("siswaForm");
      f.nis.value = s.nis;
      f.nama.value = s.nama;
      f.jk.value = s.jk || "L";
      f.agama.value = s.agama || "";
      document.getElementById("siswaKelas").value = s.kelas_id || "";
      f.hpOrtu.value = s.hp_ortu || "";
      f.dataset.editId = s.id;
    };
  });
}

/* =========================
   DOWNLOAD CSV & UI helpers for admin siswa
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

// download helper from text (filename)
function triggerDownloadFromText(text, filename = "data.csv") {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// handler tombol download CSV
const downloadBtn = document.getElementById("downloadSiswaCsv");
const downloadStatus = document.getElementById("downloadStatus");
if (downloadBtn) {
  downloadBtn.onclick = async (ev) => {
    downloadBtn.disabled = true;
    downloadStatus.style.display = "inline";
    downloadStatus.textContent = "Mengunduh…";

    try {
      const res = await fetch("/api/admin/siswa/export", {
        method: "GET",
        credentials: "include",
        headers: { Accept: "text/csv, application/json" },
      });

      if (!res.ok) {
        // try parse json for error message
        let bodyText = await res.text();
        try {
          const j = JSON.parse(bodyText);
          throw new Error(j.error || bodyText || `HTTP ${res.status}`);
        } catch {
          throw new Error(bodyText || `HTTP ${res.status}`);
        }
      }

      // If server returns a CSV file (Content-Type text/csv) -> download
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("text/csv") || ct.includes("application/csv")) {
        const blob = await res.blob();
        const filename = `daftar_akun_siswa_${new Date().toISOString().slice(0, 10)}.csv`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.setAttribute("download", filename);
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast("CSV berhasil diunduh");
      } else {
        // fallback: maybe server returned JSON with { csv: "..." }
        const text = await res.text();
        try {
          const j = JSON.parse(text);
          if (j.csv) {
            triggerDownloadFromText(
              j.csv,
              `daftar_akun_siswa_${new Date().toISOString().slice(0, 10)}.csv`,
            );
            showToast("CSV berhasil diunduh (fallback)");
          } else {
            throw new Error("Response tidak berisi CSV");
          }
        } catch (err) {
          throw err;
        }
      }
    } catch (err) {
      console.error("Download CSV error:", err);
      errorAlert("Gagal mengunduh CSV: " + (err.message || err));
      // jika endpoint belum dibuat, beri tahu admin cara membuatnya
      showToast(
        "Download gagal — periksa endpoint /api/admin/siswa/export",
        4000,
      );
    } finally {
      downloadBtn.disabled = false;
      downloadStatus.style.display = "none";
    }
  };
}

// quick filter input for siswa table (client-side)
// FILTER TABLE SISWA (CLIENT-SIDE)
const siswaQuickFilter = document.getElementById("siswaQuickFilter");
if (siswaQuickFilter) {
  siswaQuickFilter.addEventListener("input", (e) => {
    const q = (e.target.value || "").trim().toLowerCase();
    const tbody = document.querySelector("#siswaTable tbody");
    if (!tbody) return;
    Array.from(tbody.querySelectorAll("tr")).forEach((tr) => {
      const text = tr.textContent || "";
      tr.style.display = text.toLowerCase().includes(q) ? "" : "none";
    });
  });
}

// === SISWA: submit (create / edit) - updated to auto-download CSV on create ===
document.getElementById("siswaForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;

  // disable submit button during request (prevent double submit)
  const submitBtn = f.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  const body = {
    nis: f.nis.value,
    nama: f.nama.value,
    jk: f.jk.value,
    agama: f.agama.value,
    kelas_id: document.getElementById("siswaKelas").value || null,
    hp_ortu: f.hpOrtu.value,
  };

  const isEdit = !!f.dataset.editId;
  const url = isEdit
    ? `/api/admin/siswa/${f.dataset.editId}`
    : "/api/admin/siswa";
  const method = isEdit ? "PUT" : "POST";

  try {
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // handle non-OK (try to parse JSON error if possible)
    if (!res.ok) {
      let text = await res.text();
      try {
        const j = JSON.parse(text || "{}");
        errorAlert(j.error || text || `Request failed: ${res.status}`);
      } catch {
        errorAlert(text || `Request failed: ${res.status}`);
      }
      return;
    }

    const json = await res.json();

    if (!json.ok) {
      errorAlert(json.error || "Gagal menyimpan siswa");
      return;
    }

    // If created new (POST) and server returned CSV mapping -> trigger download
    if (!isEdit && json.csv) {
      try {
        const csv = json.csv;
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const urlObj = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = urlObj;
        // suggest filename: siswa-<nis>.csv (fallback to 'siswa.csv')
        const filename = `siswa-${body.nis || "export"}.csv`;
        a.setAttribute("download", filename);
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(urlObj);
      } catch (err) {
        console.warn("Download CSV gagal:", err);
      }

      // optional: show created user info if returned
      if (json.user && json.user.username) {
        successAlert(`Siswa dibuat. Username: ${json.user.username}`);
      } else {
        successAlert("Siswa dibuat dan CSV siap di-download.");
      }
    } else {
      // edit case or no csv
      successAlert("Siswa berhasil disimpan.");
    }

    // cleanup form and refresh list
    delete f.dataset.editId;
    f.reset();
    loadSiswa();
  } catch (err) {
    console.error("submit siswa error:", err);
    errorAlert("Terjadi kesalahan pada saat menyimpan siswa. Cek console.");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
};

/* lihat siswa per kelas (kelas filter) */
document.getElementById("lihatSiswaBtn").onclick = async () => {
  const sel = document.getElementById("kelasFilter");
  const kelasId = sel ? sel.value : "";
  if (!kelasId) {
    renderSiswaPerKelas([]);
    return;
  }
  const res = await fetch(
    `/api/admin/siswa?kelas_id=${encodeURIComponent(kelasId)}`,
    {
      credentials: "include",
    },
  );
  if (!res.ok) {
    errorAlert("Gagal memuat daftar siswa untuk kelas ini");
    return;
  }
  const d = await res.json();
  renderSiswaPerKelas(d.data || []);
};

/* INITIAL LOAD ADMIN (existing) */
(async () => {
  await me();
  loadDashboard();
  loadGuru();
  await loadKelas();
  populateClassSelect();
  populateKelasFilter();
  populateWaliGuru();
  loadSiswa();
})();

/* =========================
   SCHEDULER (Tahap 2)
   - semua fungsi menggunakan prefix sched_
   ========================= */

const SCHED_LOCAL_KEY = "sd_sched_local_v1";

/* sched data model (local in-memory) */
const schedData = {
  classes: [], // {id, display, name}
  subjects: [], // {name, freq, classTargets}
  teachers: [], // {name, role, subjects, classId, maxLoad}
  preferences: [], // {teacherName, days:[], periods:[]}
  generated: null,
};

/* DOM refs (scheduler area) */
const schedForm = document.getElementById("sched_scheduleForm");
const schedName = document.getElementById("sched_name");
const schedAcademic = document.getElementById("sched_academic");
const schedDaysPerWeek = document.getElementById("sched_daysPerWeek");
const schedPeriodsPerDay = document.getElementById("sched_periodsPerDay");
const schedPeriodDuration = document.getElementById("sched_periodDuration");

const sched_classesList = document.getElementById("sched_classesList");
const sched_selectAllKelasBtn = document.getElementById("sched_selectAllKelas");
const sched_resetKelasBtn = document.getElementById("sched_resetKelas");
const sched_toggleKelasBtn = document.getElementById("sched_toggleKelas");
const sched_subjectsList = document.getElementById("sched_subjectsList");

// menyimpan daftar mata pelajaran mentah dari DB (id, kode, nama)
let schedSubjectsDB = [];

// index mata pelajaran yang sedang diedit inline (null = tidak ada yang diedit)
let sched_editingSubjectIdx = null;

const sched_teachersList = document.getElementById("sched_teachersList");

// index guru yang sedang diedit inline (hanya field max sesi/minggu yang bisa diedit,
// karena nama/peran/mapel diambil langsung dari database)
let sched_editingTeacherIdx = null;

const sched_preferencesList = document.getElementById("sched_preferencesList");
const sched_prefTeacherSelect = document.getElementById(
  "sched_prefTeacherSelect",
);
const sched_prefType = document.getElementById("sched_prefType");
const sched_prefPriority = document.getElementById("sched_prefPriority");
const sched_prefDaySelect = document.getElementById("sched_prefDaySelect");
const sched_prefPeriodsCheckboxes = document.getElementById(
  "sched_prefPeriodsCheckboxes",
);
const sched_addPrefSlotBtn = document.getElementById("sched_addPrefSlotBtn");
const sched_prefSlotsPreview = document.getElementById(
  "sched_prefSlotsPreview",
);
const sched_savePrefBtn = document.getElementById("sched_savePrefBtn");

// slot (hari+periode) yang sedang dirakit untuk 1 preferensi guru (belum disimpan)
let sched_prefCurrentSlots = [];

const sched_saveDraftBtn = document.getElementById("sched_saveDraft");
const sched_schedulesWrap = document.getElementById("sched_schedulesWrap");
const sched_scheduleDetail = document.getElementById("sched_scheduleDetail");

/* Helper - load/save local schedules for scheduler area */
function sched_loadLocalSchedules() {
  try {
    return JSON.parse(localStorage.getItem(SCHED_LOCAL_KEY) || "[]");
  } catch {
    return [];
  }
}
function sched_saveLocalSchedules(arr) {
  localStorage.setItem(SCHED_LOCAL_KEY, JSON.stringify(arr));
}

/* ---------- CLASSES (ambil dari DB) ---------- */
async function sched_populateClassesFromDB() {
  const res = await fetch("/api/admin/kelas", { credentials: "include" });
  if (!res.ok) {
    console.error("Gagal memuat kelas untuk scheduler");
    return;
  }
  const d = await res.json();
  // transform to { id, display, name }
  schedData.classes = d.data.map((k) => ({
    id: k.id,
    display:
      k.tingkat && k.section
        ? `${k.tingkat}.${k.section}`
        : k.nama || `K${k.id}`,
    name:
      k.nama ||
      (k.tingkat && k.section ? `${k.tingkat}.${k.section}` : `K${k.id}`),
  }));
  // render checklist in sched_classesList
  sched_classesList.innerHTML = "";
  schedData.classes.forEach((c) => {
    const div = document.createElement("div");
    div.innerHTML = `<label style="display:inline-flex; gap:2px; align-items:center;">
      <input type="checkbox" class="sched-class-checkbox" value="${c.name}" data-id="${c.id}" />
      <span>${c.display}</span>
    </label>`;
    sched_classesList.appendChild(div);
  });

  // re-render subjects (label kelas target bisa berubah jika daftar kelas berubah)
  sched_renderSubjects();
}

/* ---------- toolbar: pilih semua / reset / tampilkan-sembunyikan kelas ---------- */
sched_selectAllKelasBtn?.addEventListener("click", () => {
  document
    .querySelectorAll(".sched-class-checkbox")
    .forEach((cb) => (cb.checked = true));
});

sched_resetKelasBtn?.addEventListener("click", () => {
  document
    .querySelectorAll(".sched-class-checkbox")
    .forEach((cb) => (cb.checked = false));
});

sched_toggleKelasBtn?.addEventListener("click", () => {
  const isHidden = sched_classesList.style.display === "none";
  sched_classesList.style.display = isHidden ? "" : "none";
  sched_toggleKelasBtn.textContent = isHidden ? "Sembunyikan" : "Tampilkan";
});

/* ---------- SUBJECTS (ambil dari DB, otomatis dengan nilai default) ---------- */
async function sched_populateSubjectsFromDB() {
  const res = await fetch("/api/admin/subjects", { credentials: "include" });
  if (!res.ok) {
    console.error("Gagal memuat mata pelajaran untuk scheduler");
    return;
  }
  const d = await res.json();
  schedSubjectsDB = d.data || [];

  // auto-isi konfigurasi jadwal dengan nilai default:
  // 3x sesi/minggu, berlaku untuk semua kelas.
  // Jika sudah ada konfigurasi sebelumnya untuk mapel yang sama (mis. setelah
  // reload data kelas), pertahankan nilai yang sudah di-edit user.
  const prevByName = new Map(schedData.subjects.map((s) => [s.name, s]));
  schedData.subjects = schedSubjectsDB.map((s) => {
    const prev = prevByName.get(s.nama);
    const kode = (s.kode || "").toUpperCase();
    const nama = (s.nama || "").toLowerCase();

    // heuristik default (bisa diubah manual lewat tombol "Edit" tiap mapel):
    // - PAI/PAK/mapel bernama "agama" -> satu grup paralel "agama", supaya
    //   boleh dijadwalkan bersamaan (siswa dipisah kelompok, guru berbeda).
    // - Matematika & Bahasa Indonesia -> ditandai "berat" (maks 1 mapel berat/hari).
    // - PJOK -> dihindari di periode terakhir hari itu.
    const defaultParallelGroup =
      kode === "PAI" || kode === "PAK" || nama.includes("agama")
        ? "agama"
        : undefined;
    const defaultHeavy = nama.includes("matematika");
    const defaultAvoidLast = kode === "PJOK" || nama.includes("jasmani");

    return {
      name: s.nama,
      kode: s.kode,
      freq: prev ? prev.freq : 3,
      classTargets: prev ? prev.classTargets : "__all",
      parallelGroup: prev ? prev.parallelGroup : defaultParallelGroup,
      heavy: prev ? !!prev.heavy : defaultHeavy,
      avoidLastPeriod: prev ? !!prev.avoidLastPeriod : defaultAvoidLast,
    };
  });

  sched_editingSubjectIdx = null;
  sched_renderSubjects();
  sched_refreshTeacherDefaults();
}

function sched_renderSubjects() {
  sched_subjectsList.innerHTML = "";

  if (!schedData.subjects.length) {
    sched_subjectsList.innerHTML = `<div class="empty">Belum ada mata pelajaran di database.</div>`;
    return;
  }

  schedData.subjects.forEach((s, i) => {
    const div = document.createElement("div");
    div.className = "chip subject-chip";

    if (sched_editingSubjectIdx === i) {
      // ---- mode edit inline ----
      const classOptionsHtml = schedData.classes
        .map((cls) => {
          const isSelected =
            s.classTargets !== "__all" && s.classTargets.includes(cls.name);
          return `<option value="${cls.name}" ${isSelected ? "selected" : ""}>${cls.display}</option>`;
        })
        .join("");

      div.innerHTML = `
        <div class="subject-edit-form" style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <strong>${s.kode ? s.kode + " — " : ""}${s.name}</strong>
          <input
            type="number"
            class="edit-freq"
            min="1"
            value="${s.freq}"
            placeholder="Sesi/minggu"
            style="width: 110px"
          />
          <label style="display:inline-flex; align-items:center; gap:4px;">
            <input type="checkbox" class="edit-allclass" ${s.classTargets === "__all" ? "checked" : ""} />
            Semua Kelas
          </label>
          <select
            class="edit-classselect"
            multiple
            style="width: 160px; ${s.classTargets === "__all" ? "display:none" : "display:inline-block"}"
          >${classOptionsHtml}</select>
          <label style="display:inline-flex; align-items:center; gap:4px;" title="Mapel dengan grup paralel yang sama boleh dijadwalkan di slot yang sama (mis. agama Islam & Kristen berjalan bersamaan)">
            Grup paralel:
            <input
              type="text"
              class="edit-parallelgroup"
              value="${s.parallelGroup || ""}"
              placeholder="mis. agama"
              style="width: 90px"
            />
          </label>
          <label style="display:inline-flex; align-items:center; gap:4px;" title="Batasi maks. 1 mapel berat per hari per kelas">
            <input type="checkbox" class="edit-heavy" ${s.heavy ? "checked" : ""} />
            Mapel berat
          </label>
          <label style="display:inline-flex; align-items:center; gap:4px;" title="Hindari penempatan di periode terakhir hari itu (mis. PJOK)">
            <input type="checkbox" class="edit-avoidlast" ${s.avoidLastPeriod ? "checked" : ""} />
            Hindari sesi terakhir
          </label>
          <button type="button" class="ghost edit-save" data-i="${i}">Simpan</button>
          <button type="button" class="ghost edit-cancel">Batal</button>
        </div>
      `;
    } else {
      // ---- mode tampilan biasa ----
      const classLabel =
        s.classTargets === "__all"
          ? "Semua Kelas"
          : s.classTargets
              .map(
                (name) =>
                  schedData.classes.find((c) => c.name === name)?.display ||
                  name,
              )
              .join(", ");
      const flagsLabel = [
        s.parallelGroup ? `paralel:${s.parallelGroup}` : null,
        s.heavy ? "berat" : null,
        s.avoidLastPeriod ? "hindari-sesi-terakhir" : null,
      ]
        .filter(Boolean)
        .join(", ");
      div.innerHTML = `
        <span>${s.kode ? s.kode + " — " : ""}${s.name} | ${s.freq}x/minggu | ${classLabel}${flagsLabel ? ` | <em>${flagsLabel}</em>` : ""}</span>
        <button type="button" class="ghost edit-btn" data-i="${i}">Edit</button>
        <button type="button" class="ghost remove-btn" data-i="${i}">x</button>
      `;
    }

    sched_subjectsList.appendChild(div);
  });

  // tombol "Edit" -> masuk mode edit inline
  sched_subjectsList.querySelectorAll(".edit-btn").forEach((btn) => {
    btn.onclick = (e) => {
      sched_editingSubjectIdx = Number(e.currentTarget.dataset.i);
      sched_renderSubjects();
    };
  });

  // tombol "x" -> keluarkan mapel ini dari konfigurasi jadwal ini
  sched_subjectsList.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.onclick = (e) => {
      const idx = Number(e.currentTarget.dataset.i);
      schedData.subjects.splice(idx, 1);
      sched_editingSubjectIdx = null;
      sched_renderSubjects();
      sched_refreshTeacherDefaults();
    };
  });

  // checkbox "Semua Kelas" di form edit -> tampilkan/sembunyikan pilihan kelas
  sched_subjectsList.querySelectorAll(".edit-allclass").forEach((cb) => {
    cb.onchange = (e) => {
      const form = e.currentTarget.closest(".subject-edit-form");
      const select = form.querySelector(".edit-classselect");
      select.style.display = e.currentTarget.checked ? "none" : "inline-block";
      if (e.currentTarget.checked) {
        Array.from(select.options).forEach((o) => (o.selected = false));
      }
    };
  });

  // tombol "Simpan" di form edit
  sched_subjectsList.querySelectorAll(".edit-save").forEach((btn) => {
    btn.onclick = (e) => {
      const idx = Number(e.currentTarget.dataset.i);
      const form = e.currentTarget.closest(".subject-edit-form");
      const freq = Number(form.querySelector(".edit-freq").value);
      const allClass = form.querySelector(".edit-allclass").checked;
      const selectedClasses = Array.from(
        form.querySelector(".edit-classselect").selectedOptions,
      ).map((o) => o.value);

      if (!freq || freq < 1) {
        warningAlert("Isi sesi/minggu dengan angka valid (minimal 1).");
        return;
      }
      if (!allClass && !selectedClasses.length) {
        warningAlert("Pilih minimal 1 kelas, atau centang Semua Kelas.");
        return;
      }

      const parallelGroup = form
        .querySelector(".edit-parallelgroup")
        .value.trim();
      const heavy = form.querySelector(".edit-heavy").checked;
      const avoidLastPeriod = form.querySelector(".edit-avoidlast").checked;

      schedData.subjects[idx].freq = freq;
      schedData.subjects[idx].classTargets = allClass
        ? "__all"
        : selectedClasses;
      schedData.subjects[idx].parallelGroup = parallelGroup || undefined;
      schedData.subjects[idx].heavy = heavy;
      schedData.subjects[idx].avoidLastPeriod = avoidLastPeriod;

      sched_editingSubjectIdx = null;
      sched_renderSubjects();
      sched_refreshTeacherDefaults();
    };
  });

  // tombol "Batal" di form edit
  sched_subjectsList.querySelectorAll(".edit-cancel").forEach((btn) => {
    btn.onclick = () => {
      sched_editingSubjectIdx = null;
      sched_renderSubjects();
    };
  });
}

/* ---------- TEACHERS (ambil dari DB, otomatis dengan mapel yang diampu) ---------- */

/* hitung default max sesi/minggu untuk seorang guru berdasarkan konfigurasi
   mata pelajaran saat ini (freq per mapel yang benar-benar dia ampu) */
function sched_computeTeacherMaxAllowed(role, subjectNames, classId) {
  let total = 0;
  schedData.subjects.forEach((s) => {
    if (!subjectNames.includes(s.name)) return;
    if (role === "kelas") {
      if (s.classTargets === "__all" || s.classTargets.includes(classId))
        total += s.freq;
    } else {
      total += s.freq;
    }
  });
  return total;
}

/* setiap kali konfigurasi mata pelajaran berubah, refresh nilai default
   max sesi/minggu guru — kecuali guru yang max-nya sudah di-edit manual */
function sched_refreshTeacherDefaults() {
  schedData.teachers.forEach((t) => {
    if (!t.maxLoadEdited) {
      t.maxLoad = sched_computeTeacherMaxAllowed(t.role, t.subjects, t.classId);
    }
  });
  sched_renderTeachers();
}

async function sched_populateTeachersFromDB() {
  const res = await fetch("/api/admin/guru-jadwal", { credentials: "include" });
  if (!res.ok) {
    console.error("Gagal memuat guru untuk scheduler");
    return;
  }
  const d = await res.json();
  const teachersDB = d.data || [];

  // pertahankan max sesi/minggu yang sudah di-edit user sebelumnya
  const prevByName = new Map(schedData.teachers.map((t) => [t.name, t]));

  // PENTING: sebelumnya guru tanpa baris di teacher_subjects (mis. guru kelas
  // yang belum di-assign mapel apapun) DIBUANG total dari daftar ini, sehingga
  // hilang tanpa jejak dari hasil penjadwalan. Sekarang guru tetap dipertahankan
  // (dengan subjects: []) supaya kelihatan di UI dan bisa diperbaiki lewat
  // tombol "Kelola Mapel" (id.subjects.length === 0 -> tampilkan warning).
  schedData.teachers = teachersDB.map((t) => {
    const role = t.teacher_type === "kelas" ? "kelas" : "mapel";
    const classId = role === "kelas" ? t.kelas_nama || "" : "__all";
    const prev = prevByName.get(t.nama);
    return {
      id: t.id,
      name: t.nama,
      role,
      subjects: Array.isArray(t.subjects) ? t.subjects : [],
      classId,
      maxLoad: prev
        ? prev.maxLoad
        : sched_computeTeacherMaxAllowed(role, t.subjects || [], classId),
      maxLoadEdited: prev ? prev.maxLoadEdited : false,
    };
  });

  sched_renderTeachers();
  sched_renderPrefTeacherSelect();
}

function sched_renderTeachers() {
  sched_teachersList.innerHTML = "";

  if (!schedData.teachers.length) {
    sched_teachersList.innerHTML = `<div class="empty">Belum ada guru dengan mata pelajaran yang diampu di database (cek tabel teacher_subjects).</div>`;
    return;
  }

  schedData.teachers.forEach((t, i) => {
    const div = document.createElement("div");
    div.className = "chip teacher-chip";

    const roleLabel =
      t.role === "kelas" ? `Guru Kelas ${t.classId}` : "Guru Mapel";

    if (sched_editingTeacherIdx === i) {
      div.innerHTML = `
        <div class="teacher-edit-form" style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <strong>${t.name}</strong>
          <span>${roleLabel} | ${t.subjects.join(", ")}</span>
          <label style="display:inline-flex; align-items:center; gap:4px;">
            Max sesi/mgg:
            <input
              type="number"
              class="edit-maxload"
              min="1"
              value="${t.maxLoad}"
              style="width: 90px"
            />
          </label>
          <button type="button" class="ghost edit-save" data-i="${i}">Simpan</button>
          <button type="button" class="ghost edit-cancel">Batal</button>
        </div>
      `;
    } else if (!t.subjects.length) {
      div.style.border = "1px solid #dc2626";
      div.innerHTML = `
        <span style="color:#dc2626">
          ⚠ ${t.name} | ${roleLabel} | belum ada mapel diampu (teacher_subjects kosong) —
          guru ini TIDAK akan pernah dapat jadwal sampai mapelnya di-set.
        </span>
        <button type="button" class="ghost fix-mapel-btn" data-id="${t.id || ""}" data-nama="${t.name}">
          Kelola Mapel
        </button>
        <button type="button" class="ghost remove-btn" data-i="${i}">x</button>
      `;
    } else {
      div.innerHTML = `
        <span>• ${t.name} | ${roleLabel} | ${t.subjects.join(", ")} | max ${t.maxLoad} sesi/mgg</span>
        <button type="button" class="ghost edit-btn" data-i="${i}">Edit</button>
        <button type="button" class="ghost remove-btn" data-i="${i}">x</button>
      `;
    }

    sched_teachersList.appendChild(div);
  });

  sched_teachersList.querySelectorAll(".fix-mapel-btn").forEach((btn) => {
    btn.onclick = () => {
      if (!btn.dataset.id) {
        warningAlert(
          "ID guru tidak ditemukan (data lama). Buka halaman Data Guru untuk mengelola mapel guru ini.",
        );
        return;
      }
      openMapelModal(btn.dataset.id, btn.dataset.nama);
    };
  });

  sched_teachersList.querySelectorAll(".edit-btn").forEach((btn) => {
    btn.onclick = (e) => {
      sched_editingTeacherIdx = Number(e.currentTarget.dataset.i);
      sched_renderTeachers();
    };
  });

  sched_teachersList.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.onclick = (e) => {
      const idx = Number(e.currentTarget.dataset.i);
      schedData.teachers.splice(idx, 1);
      sched_editingTeacherIdx = null;
      sched_renderTeachers();
      sched_renderPrefTeacherSelect();
    };
  });

  sched_teachersList.querySelectorAll(".edit-save").forEach((btn) => {
    btn.onclick = (e) => {
      const idx = Number(e.currentTarget.dataset.i);
      const form = e.currentTarget.closest(".teacher-edit-form");
      const maxLoad = Number(form.querySelector(".edit-maxload").value);
      if (!maxLoad || maxLoad < 1) {
        warningAlert("Isi max sesi/minggu dengan angka valid (minimal 1).");
        return;
      }
      schedData.teachers[idx].maxLoad = maxLoad;
      schedData.teachers[idx].maxLoadEdited = true;
      sched_editingTeacherIdx = null;
      sched_renderTeachers();
    };
  });

  sched_teachersList.querySelectorAll(".edit-cancel").forEach((btn) => {
    btn.onclick = () => {
      sched_editingTeacherIdx = null;
      sched_renderTeachers();
    };
  });
}

/* ---------- PREFERENCES ---------- */
function sched_renderPrefTeacherSelect() {
  sched_prefTeacherSelect.innerHTML = `<option value="">Pilih guru...</option>`;
  schedData.teachers.forEach((t, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = t.name;
    sched_prefTeacherSelect.appendChild(opt);
  });
}

/* render checkbox periode 1..periodsPerDay (jumlahnya mengikuti input
   "Jam Pelajaran per Hari" agar selalu sinkron) */
function sched_renderPrefPeriodsCheckboxes() {
  const total = Number(schedPeriodsPerDay.value) || 8;
  sched_prefPeriodsCheckboxes.innerHTML = "";
  for (let p = 0; p < total; p++) {
    const label = document.createElement("label");
    label.style.cssText =
      "display:inline-flex; align-items:center; gap:2px; font-size:13px;";
    label.innerHTML = `<input type="checkbox" class="sched_prefPeriodCb" value="${p}" /> ${p + 1}`;
    sched_prefPeriodsCheckboxes.appendChild(label);
  }
}
schedPeriodsPerDay?.addEventListener(
  "change",
  sched_renderPrefPeriodsCheckboxes,
);

/* tambah 1 slot (hari + periode yang dicentang) ke daftar sementara */
sched_addPrefSlotBtn?.addEventListener("click", () => {
  const day = Number(sched_prefDaySelect.value);
  const periods = Array.from(
    sched_prefPeriodsCheckboxes.querySelectorAll(".sched_prefPeriodCb:checked"),
  ).map((cb) => Number(cb.value));

  if (!periods.length)
    return warningAlert("Pilih minimal 1 periode untuk hari ini.");

  // gabungkan kalau hari yang sama sudah pernah ditambahkan sebelumnya
  const existing = sched_prefCurrentSlots.find((s) => s.day === day);
  if (existing) {
    existing.periods = Array.from(
      new Set([...existing.periods, ...periods]),
    ).sort((a, b) => a - b);
  } else {
    sched_prefCurrentSlots.push({
      day,
      periods: [...periods].sort((a, b) => a - b),
    });
  }

  sched_prefPeriodsCheckboxes
    .querySelectorAll(".sched_prefPeriodCb")
    .forEach((cb) => (cb.checked = false));

  sched_renderPrefSlotsPreview();
});

function sched_renderPrefSlotsPreview() {
  sched_prefSlotsPreview.innerHTML = "";
  if (!sched_prefCurrentSlots.length) {
    sched_prefSlotsPreview.innerHTML = `<div class="empty">Belum ada slot ditambahkan.</div>`;
    return;
  }
  sched_prefCurrentSlots.forEach((slot, i) => {
    const div = document.createElement("div");
    div.className = "chip";
    div.innerHTML = `
      <span>${DAY_LABELS[slot.day] || slot.day} : sesi ${slot.periods.map((p) => p + 1).join(", ")}</span>
      <button type="button" class="ghost" data-i="${i}">x</button>
    `;
    sched_prefSlotsPreview.appendChild(div);
  });
  sched_prefSlotsPreview.querySelectorAll("[data-i]").forEach((btn) => {
    btn.onclick = (e) => {
      sched_prefCurrentSlots.splice(Number(e.currentTarget.dataset.i), 1);
      sched_renderPrefSlotsPreview();
    };
  });
}

const SCHED_PREF_TYPE_LABEL = {
  tidak_tersedia: "Tidak Tersedia",
  kurang_disukai: "Kurang Disukai",
};

function sched_renderPreferences() {
  sched_preferencesList.innerHTML = "";

  if (!schedData.preferences.length) {
    sched_preferencesList.innerHTML = `<div class="empty">Belum ada preferensi guru.</div>`;
    return;
  }

  schedData.preferences.forEach((p, i) => {
    const div = document.createElement("div");
    div.className = "chip";
    const slotsLabel = (p.slots || [])
      .map(
        (s) =>
          `${DAY_LABELS[s.day] || s.day}: sesi ${s.periods.map((n) => n + 1).join(",")}`,
      )
      .join(" | ");
    const typeLabel = SCHED_PREF_TYPE_LABEL[p.type] || p.type;
    div.innerHTML = `
      <span>• ${p.teacherName} | ${typeLabel} (prioritas ${p.priority}) | ${slotsLabel}</span>
      <button class="ghost" data-i="${i}">x</button>
    `;
    sched_preferencesList.appendChild(div);
  });
  sched_preferencesList.querySelectorAll("[data-i]").forEach((btn) => {
    btn.onclick = (e) => {
      schedData.preferences.splice(Number(e.currentTarget.dataset.i), 1);
      sched_renderPreferences();
    };
  });
}

sched_savePrefBtn.onclick = () => {
  const teacherIdx = sched_prefTeacherSelect.value;
  if (teacherIdx === "") return warningAlert("Pilih guru untuk preferensi");
  const teacher = schedData.teachers[teacherIdx];
  if (!teacher) return warningAlert("Guru tidak ditemukan");
  if (!sched_prefCurrentSlots.length)
    return warningAlert(
      "Tambahkan minimal 1 slot hari & periode sebelum menyimpan.",
    );

  const pref = {
    teacherName: teacher.name,
    type:
      sched_prefType.value === "kurang_disukai"
        ? "kurang_disukai"
        : "tidak_tersedia",
    priority: Number(sched_prefPriority.value) || 5,
    slots: sched_prefCurrentSlots.map((s) => ({
      day: s.day,
      periods: [...s.periods],
    })),
  };
  schedData.preferences.push(pref);

  // reset form
  sched_prefCurrentSlots = [];
  sched_renderPrefSlotsPreview();
  sched_prefTeacherSelect.value = "";
  sched_prefType.value = "tidak_tersedia";
  sched_prefPriority.value = "5";
  sched_prefPeriodsCheckboxes
    .querySelectorAll(".sched_prefPeriodCb")
    .forEach((cb) => (cb.checked = false));

  sched_renderPreferences();
};

/* ---------- render saved local schedules (list) ---------- */
function sched_renderAllLocalSchedules() {
  const items = sched_loadLocalSchedules();
  sched_schedulesWrap.innerHTML = "";
  if (!items.length) {
    sched_schedulesWrap.innerHTML = `<div class="empty">Belum ada jadwal lokal. Buat jadwal baru.</div>`;
    return;
  }
  const list = document.createElement("div");
  list.className = "list";
  items.forEach((s, idx) => {
    const saved = !!s._savedId;
    const el = document.createElement("div");
    el.className = "schedule-item";
    el.innerHTML = `
      <div>
        <strong>${escapeHtml(s.name)}</strong>
        <div class="meta">${s.academic || ""} • ${s.classes?.length || 0} kelas • ${s.periodsPerDay || 0} periode/hari</div>
      </div>
      <div class="controls">
        <button class="ghost" data-view="${idx}">Lihat</button>
        ${saved ? `<button class="ghost" disabled>✔ Tersimpan</button>` : `<button class="ghost" data-save="${idx}">Simpan ke DB</button>`}
        <button class="ghost" data-del="${idx}">Hapus</button>
      </div>
    `;
    list.appendChild(el);
  });
  sched_schedulesWrap.appendChild(list);

  // view buttons
  sched_schedulesWrap.querySelectorAll("[data-view]").forEach((btn) => {
    btn.onclick = (e) => {
      const idx = Number(e.currentTarget.dataset.view);
      sched_renderScheduleDetail(sched_loadLocalSchedules()[idx]);
    };
  });

  // delete buttons
  sched_schedulesWrap.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = async (e) => {
      const idx = Number(e.currentTarget.dataset.del);
      const arr = sched_loadLocalSchedules();
      if (
        !(await confirmDelete(
          `Jadwal "${arr[idx].name}" akan dihapus secara permanen.`,
        ))
      )
        return;
      arr.splice(idx, 1);
      sched_saveLocalSchedules(arr);
      sched_renderAllLocalSchedules();
    };
  });

  // save-to-db buttons
  sched_schedulesWrap.querySelectorAll("[data-save]").forEach((btn) => {
    btn.onclick = async (e) => {
      const idx = Number(e.currentTarget.dataset.save);
      const arr = sched_loadLocalSchedules();
      const payload = arr[idx];
      try {
        const res = await fetch("/api/admin/jadwal", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        // Try parse response as JSON (server returns JSON on success)
        const text = await res.text();
        let json = null;
        try {
          json = text ? JSON.parse(text) : {};
        } catch (err) {
          // non-json response
        }

        if (!res.ok) {
          // prefer server message (json.error) else show raw text/status
          const msg = (json && json.error) || text || res.status;
          errorAlert("Simpan ke DB gagal — server returned: " + msg);
          return;
        }

        // success: update local copy to mark as saved and update name if server changed it
        const finalName = (json && json.name) || payload.name;
        const idSaved = (json && json.id) || null;

        arr[idx]._savedId = idSaved;
        arr[idx].name = finalName;
        // persist local changes
        sched_saveLocalSchedules(arr);
        // re-render list so button becomes 'Tersimpan'
        sched_renderAllLocalSchedules();

        successAlert(
          `Jadwal disimpan ke database sebagai "${finalName}" (id=${idSaved})`,
        );
      } catch (err) {
        console.error(err);
        errorAlert(
          "Gagal menghubungi server untuk menyimpan jadwal. Endpoint /api/admin/jadwal mungkin belum dibuat.",
        );
      }
    };
  });
}

/* small helper to avoid XSS when rendering names coming from localStorage */
function escapeHtml(str) {
  if (!str && str !== 0) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------- render schedule detail (table) ---------- */
const DAY_LABELS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
// Default index sesi istirahat (0-based). HARUS konsisten dengan
// BREAK_SESSION_INDEXES di src/services/scheduler.ts. Sesi ke-4 = index 3,
// sesi ke-8 = index 7. Sebelumnya di sini cuma ada 1 nilai (index 3) sehingga
// sesi ke-8 tidak pernah ditandai "Istirahat" walau backend GA sudah
// menghindarinya -> tampil sebagai sel kosong yang membingungkan.
const SCHED_BREAK_SESSION_INDEXES_DEFAULT = [3, 7];
const SCHED_BREAK_DURATION = 30;

function formatHM(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function sched_renderScheduleDetail(schedule) {
  if (!schedule) return;
  sched_scheduleDetail.innerHTML = `
    <h2>${schedule.name}</h2>
    <p class="meta">${schedule.academic || ""}</p>
  `;
  const daysPerWeek = schedule.daysPerWeek;
  const periodsPerDay = schedule.periodsPerDay;
  const periodDuration = schedule.periodDuration;
  const assignments =
    schedule.generated?.assignments || schedule.assignments || [];
  const breakIndexes =
    Array.isArray(schedule.breakSessionIndexes) &&
    schedule.breakSessionIndexes.length
      ? schedule.breakSessionIndexes
      : SCHED_BREAK_SESSION_INDEXES_DEFAULT;

  const DAY_START_MINUTES = 7 * 60;
  const startTimes = new Array(periodsPerDay);
  const endTimes = new Array(periodsPerDay);
  let cur = DAY_START_MINUTES;
  for (let p = 0; p < periodsPerDay; p++) {
    if (breakIndexes.includes(p)) {
      startTimes[p] = cur;
      cur += SCHED_BREAK_DURATION;
      endTimes[p] = cur;
      continue;
    }
    startTimes[p] = cur;
    cur += periodDuration;
    endTimes[p] = cur;
  }

  schedule.classes.forEach((cls, classIdx) => {
    let html = `<h3 class="class-title">Kelas ${cls.display}</h3>`;
    html += `<table class="schedule-table"><thead><tr><th>Sesi (Waktu)</th>`;
    html += DAY_LABELS.slice(0, daysPerWeek)
      .map((d) => `<th>${d}</th>`)
      .join("");
    html += `</tr></thead><tbody>`;

    for (let p = 0; p < periodsPerDay; p++) {
      const isBreak = breakIndexes.includes(p);
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
    sched_scheduleDetail.insertAdjacentHTML("beforeend", html);
  });
}

/* cek tiap kombinasi (kelas, mapel) yang ditarget punya minimal 1 guru
   pengampu yang valid. Meniru persis logika candidateTeachers di
   scheduler.ts, supaya "silent skip" di backend bisa dideteksi & diperlihatkan
   ke admin SEBELUM generate, bukan cuma muncul sebagai slot kosong. */
function sched_findMissingCoverage(classesPayload) {
  const missing = [];
  schedData.subjects.forEach((sub) => {
    classesPayload.forEach((cls) => {
      const targeted =
        sub.classTargets === "__all" || sub.classTargets.includes(cls.name);
      if (!targeted) return;
      const hasCandidate = schedData.teachers.some(
        (t) =>
          t.subjects.includes(sub.name) &&
          (t.classId === "__all" || t.classId === cls.name),
      );
      if (!hasCandidate) missing.push(`${cls.display} — ${sub.name}`);
    });
  });
  return missing;
}

/* ---------- submit generate / save draft ---------- */
schedForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  // collect selected classes
  const checked = Array.from(
    document.querySelectorAll(".sched-class-checkbox:checked"),
  );
  if (!checked.length)
    return warningAlert("Pilih minimal 1 kelas untuk jadwal");
  const classesPayload = checked.map((c) => {
    const name = c.value;
    const display = (c.closest("label")?.textContent || name).trim();
    // ambil data-id yang sudah diset pada checkbox saat populate
    const id = c.dataset.id ? Number(c.dataset.id) : null;
    return { id, name, display };
  });

  if (!schedData.subjects.length)
    return warningAlert("Tambahkan minimal 1 mata pelajaran");
  if (!schedData.teachers.length)
    return warningAlert("Tambahkan minimal 1 guru");

  const missingCoverage = sched_findMissingCoverage(classesPayload);
  if (missingCoverage.length) {
    const proceed = await confirmAction(
      "Kombinasi kelas-mapel berikut TIDAK punya guru pengampu yang valid, " +
        "dan akan otomatis dilewati (slot kosong) oleh algoritma genetika:\n\n" +
        missingCoverage.join("\n") +
        '\n\nPerbaiki dulu lewat tombol "Kelola Mapel" di daftar guru. ' +
        "Tetap lanjutkan generate walau ada yang kosong?",
      "Ada kombinasi kelas-mapel tanpa guru",
    );
    if (!proceed) return;
  }

  const payload = {
    name: schedName.value.trim() || "Jadwal",
    academic: schedAcademic.value.trim() || "",
    daysPerWeek: Number(schedDaysPerWeek.value),
    periodsPerDay: Number(schedPeriodsPerDay.value),
    periodDuration: Number(schedPeriodDuration.value),
    classes: classesPayload,
    subjects: schedData.subjects,
    teachers: schedData.teachers,
    // schedData.preferences sudah berbentuk TeacherPreference baru
    // ({ teacherName, type, priority, slots }), kirim langsung tanpa transformasi
    preferences: schedData.preferences,
    // dikirim eksplisit supaya konsisten antara backend (GA) & frontend (render tabel)
    breakSessionIndexes: SCHED_BREAK_SESSION_INDEXES_DEFAULT,
  };

  // POST to /api/generate
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text();
      errorAlert("Generate gagal — server returned: " + (txt || res.status));
      return;
    }
    const json = await res.json();
    if (!json.ok) {
      errorAlert("Generate gagal");
      return;
    }
    // attach generated result
    payload.generated = json.data;
    payload.assignments = json.data.assignments;
    payload.fitness = json.data.fitness;
    // save to local scheduler storage (unique name enforcement)
    const arr = sched_loadLocalSchedules();
    // ensure unique name: append (1),(2),...
    const base = payload.name;
    let name = base;
    let i = 1;
    while (arr.some((x) => x.name === name)) {
      i++;
      name = `${base} (${i - 1})`;
    }
    payload.name = name;
    arr.push(payload);
    sched_saveLocalSchedules(arr);
    successAlert(`Generate sukses 🎉 | Fitness: ${payload.fitness}`);
    // refresh list and detail
    sched_renderAllLocalSchedules();
    sched_renderScheduleDetail(payload);
  } catch (err) {
    console.error(err);
    errorAlert("Terjadi kesalahan saat generate. Cek console.");
  }
});

sched_saveDraftBtn?.addEventListener("click", () => {
  const draft = {
    name: schedName.value,
    academic: schedAcademic.value,
    daysPerWeek: Number(schedDaysPerWeek.value),
    periodsPerDay: Number(schedPeriodsPerDay.value),
    periodDuration: Number(sched_periodDuration.value),
    classes: schedData.classes,
    subjects: schedData.subjects,
    teachers: schedData.teachers,
    preferences: schedData.preferences,
    savedAt: Date.now(),
  };
  localStorage.setItem("sd_sched_draft_v1", JSON.stringify(draft));
  successAlert("Draft penjadwalan disimpan");
});

/* ---------- initial scheduler load ---------- */
(async function sched_init() {
  // populate kelas & mapel dulu (mapel dibutuhkan untuk hitung default max sesi/minggu guru)
  await sched_populateClassesFromDB();
  await sched_populateSubjectsFromDB();
  // baru ambil daftar guru (otomatis, lengkap dengan mapel yang diampu)
  await sched_populateTeachersFromDB();
  sched_renderPrefPeriodsCheckboxes();
  sched_renderPrefSlotsPreview();
  sched_renderPreferences();
  sched_renderAllLocalSchedules();
})();
