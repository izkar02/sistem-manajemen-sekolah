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

  document.getElementById("info").textContent = `Halo, ${user.displayName}`;
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
      if (page === "staff") {
        loadStaff();
        populateStaffJabatanFilter();
      }
      if (page === "sarana") {
        loadSarana();
        loadSaranaStats();
        populateSaranaCategories();
        populateSaranaLocations();
      }

      if (page === "prasarana") {
        loadPrasarana();
        loadPrasaranaStats();
        populatePrasaranaTypes();
      }
      if (page === "ekstrakurikuler") {
        loadEkstrakurikulerStats();
        loadEkstrakurikuler();
        populateEkstrakurikulerTeachers();
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

/* ========================================================= 
GENERIC FORM MODAL HELPERS
 ========================================================= 
 Satu sistem untuk: 
 - tombol X 
 - tombol Batal 
 - klik area luar modal 
 - tombol ESC 
 ========================================================= */
function openFormModal(overlayId) {
  const overlay = document.getElementById(overlayId);
  if (!overlay) {
    console.warn("Modal tidak ditemukan:", overlayId);
    return;
  }
  overlay.style.display = "flex";
  document.body.classList.add("modal-open");
}
function closeFormModal(overlayId) {
  const overlay = document.getElementById(overlayId);
  if (!overlay) {
    console.warn("Modal tidak ditemukan:", overlayId);
    return;
  }
  const form = overlay.querySelector("form");
  if (form) {
    try {
      form.reset();
    } catch (err) {
      console.warn("Gagal reset form:", err);
    }
    delete form.dataset.editId;
  }
  overlay.style.display = "none";
  document.body.classList.remove("modal-open");
}
/* * Tutup modal dengan klik area gelap. * Event delegation dipakai agar tetap bekerja * walaupun isi modal berubah/dibuat ulang. */ document.addEventListener(
  "click",
  (e) => {
    const overlay = e.target.closest(".form-modal-overlay");
    if (!overlay) return;
    /* * Hanya tutup jika yang diklik adalah overlay, * bukan isi/kotak form. */ if (
      e.target === overlay
    ) {
      closeFormModal(overlay.id);
    }
  },
);
/* * Semua tombol yang memiliki: * * data-close-modal="guruForm" * * akan mencari form tersebut dan modalnya. * * Jika pola ID standar: * guruForm * guruFormModalOverlay * * maka otomatis ditemukan. * * Untuk modal yang nama wrapper-nya berbeda, * gunakan data-close-overlay. */ document.addEventListener(
  "click",
  (e) => {
    const button = e.target.closest("[data-close-modal]");
    if (!button) return;
    e.preventDefault();
    e.stopPropagation();
    const formId = button.dataset.closeModal;
    if (!formId) return;
    /* * Cari modal berdasarkan form. * Ini lebih aman daripada hanya mengandalkan * nama ID wrapper. */ const form =
      document.getElementById(formId);
    if (form) {
      const overlay = form.closest(".form-modal-overlay");
      if (overlay) {
        closeFormModal(overlay.id);
        return;
      }
    }
    /* * Fallback untuk pola: * guruForm -> guruFormModalOverlay */ const standardOverlayId = `${formId}ModalOverlay`;
    const standardOverlay = document.getElementById(standardOverlayId);
    if (standardOverlay) {
      closeFormModal(standardOverlay.id);
      return;
    }
    /* * Fallback tambahan untuk pola lama: * guruForm -> guruFormModalOverlay */ const oldOverlayId = `${formId}FormModalOverlay`;
    const oldOverlay = document.getElementById(oldOverlayId);
    if (oldOverlay) {
      closeFormModal(oldOverlay.id);
      return;
    }
    console.warn("Tidak menemukan modal untuk data-close-modal:", formId);
  },
);
/* * Untuk modal dengan wrapper ID yang tidak mengikuti * pola nama form, gunakan: * * data-close-overlay="facilityMaintenanceFormWrapper" */ document.addEventListener(
  "click",
  (e) => {
    const button = e.target.closest("[data-close-overlay]");
    if (!button) return;
    e.preventDefault();
    e.stopPropagation();
    const overlayId = button.dataset.closeOverlay;
    if (!overlayId) return;
    closeFormModal(overlayId);
  },
);
/* * ESC = tutup modal yang sedang terbuka. */ document.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Escape") return;
    const openedModals = document.querySelectorAll(".form-modal-overlay");
    openedModals.forEach((overlay) => {
      const style = window.getComputedStyle(overlay);
      if (style.display !== "none" && style.visibility !== "hidden") {
        closeFormModal(overlay.id);
      }
    });
  },
);

/* ---- GURU: tombol tambah ---- */
document.getElementById("guruAddBtn")?.addEventListener("click", () => {
  const f = document.getElementById("guruForm");
  f.reset();
  delete f.dataset.editId;
  document.getElementById("guruFormModalTitle").textContent = "Tambah Guru";
  openFormModal("guruFormModalOverlay");
});

/* ---- STAFF: tombol tambah ---- */
document.getElementById("staffAddBtn")?.addEventListener("click", () => {
  const f = document.getElementById("staffForm");
  f.reset();
  delete f.dataset.editId;
  document.getElementById("staffFormModalTitle").textContent = "Tambah Staff";
  openFormModal("staffFormModalOverlay");
});

/* ---- SISWA: tombol tambah ---- */
document.getElementById("siswaAddBtn")?.addEventListener("click", () => {
  const f = document.getElementById("siswaForm");
  f.reset();
  delete f.dataset.editId;
  document.getElementById("siswaFormModalTitle").textContent = "Tambah Siswa";
  openFormModal("siswaFormModalOverlay");
});

/* ---- KELAS: tombol tambah ---- */
document.getElementById("kelasAddBtn")?.addEventListener("click", () => {
  const f = document.getElementById("kelasForm");
  f.reset();
  delete f.dataset.editId;
  document.getElementById("kelasFormModalTitle").textContent = "Tambah Kelas";
  populateWaliGuru();
  openFormModal("kelasFormModalOverlay");
});

/* ---- SARANA: tombol tambah ---- */
document.getElementById("saranaAddBtn")?.addEventListener("click", () => {
  const f = document.getElementById("saranaForm");
  f.reset();
  delete f.dataset.editId;
  document.getElementById("saranaFormModalTitle").textContent = "Tambah Sarana";
  populateSaranaCategories();
  openFormModal("saranaFormModalOverlay");
});

/* ---- PRASARANA: tombol tambah ---- */
document.getElementById("prasaranaAddBtn")?.addEventListener("click", () => {
  const f = document.getElementById("prasaranaForm");
  f.reset();
  delete f.dataset.editId;
  document.getElementById("prasaranaFormModalTitle").textContent =
    "Tambah Prasarana";
  openFormModal("prasaranaFormModalOverlay");
});

/* ---- EKSTRAKURIKULER: tombol tambah anggota ---- */
document
  .getElementById("ekstrakurikulerMemberAddBtn")
  ?.addEventListener("click", () => {
    const f = document.getElementById("ekstrakurikulerMemberForm");
    f.reset();
    const joinDate = document.getElementById("ekskulJoinDate");
    if (joinDate) joinDate.value = new Date().toISOString().slice(0, 10);
    openFormModal("ekstrakurikulerMemberFormModalOverlay");
  });

document.getElementById("logoutBtn").onclick = async () => {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
  window.location.href = "/login.html";
};

document
  .getElementById("addFacilityMaintenanceBtn")
  ?.addEventListener("click", () => {
    openFacilityMaintenanceCreateForm();
  });

document
  .getElementById("facilityMaintenanceForm")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!currentFacilityDetailId) {
      errorAlert("Sarana belum dipilih");
      return;
    }

    const form = e.target;

    const body = {
      maintenance_date: form.maintenance_date.value,
      issue_description: form.issue_description.value.trim(),
      action_taken: form.action_taken.value.trim(),
      cost: form.cost.value || 0,
      status: form.status.value,
      notes: form.notes.value.trim(),
    };

    const isEdit = !!form.dataset.editId;

    const url = isEdit
      ? `/api/admin/facility-maintenance/${form.dataset.editId}`
      : `/api/admin/facilities/${currentFacilityDetailId}/maintenance`;

    const method = isEdit ? "PUT" : "POST";

    const submitButton = form.querySelector('button[type="submit"]');

    if (submitButton) {
      submitButton.disabled = true;
    }

    try {
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        errorAlert(json.error || "Gagal menyimpan riwayat pemeliharaan");
        return;
      }

      successAlert(json.message || "Riwayat pemeliharaan berhasil disimpan");

      form.reset();
      delete form.dataset.editId;

      document.getElementById("facilityMaintenanceFormWrapper").style.display =
        "none";

      await loadFacilityMaintenance(currentFacilityDetailId);
    } catch (err) {
      console.error("facilityMaintenanceForm submit:", err);
      errorAlert("Terjadi kesalahan saat menyimpan riwayat pemeliharaan");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });

/* DASHBOARD */

// Set nilai kartu ke "…" (loading) supaya beda dari "0" (memang kosong)
// dan dari error (ditandai lewat #dashboard-error).
function setDashboardCardsLoading() {
  const ids = [
    "count-guru",
    "count-siswa",
    "count-kelas",
    "count-staff",
    "count-sarana",
    "count-prasarana",
    "count-ekskul",
    "count-jadwal",
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = "…";
  });
  const pesertaEl = document.getElementById("count-ekskul-peserta");
  if (pesertaEl) pesertaEl.textContent = "…";
}

function showDashboardError(show, message) {
  const box = document.getElementById("dashboard-error");
  if (!box) return;
  box.style.display = show ? "block" : "none";
  if (show) {
    box.textContent = message || "Gagal memuat data dashboard. Coba lagi.";
  }
}

function renderEkskulHampirPenuh(list) {
  const box = document.getElementById("insight-ekskul-penuh");
  if (!box) return;
  if (!list || !list.length) {
    box.innerHTML = `<p class="insight-empty">Tidak ada ekstrakurikuler yang mendekati kapasitas.</p>`;
    return;
  }
  box.innerHTML = list
    .map((e) => {
      const pct = e.max_members
        ? Math.round((e.active_members / e.max_members) * 100)
        : 0;
      return `
        <div class="insight-item">
          <span>${e.name}</span>
          <span class="insight-badge">${e.active_members}/${e.max_members} (${pct}%)</span>
        </div>`;
    })
    .join("");
}

function renderGuruBelumLengkap(list) {
  const box = document.getElementById("insight-guru-belum-lengkap");
  if (!box) return;
  if (!list || !list.length) {
    box.innerHTML = `<p class="insight-empty">Semua guru sudah punya mapel/kelas diampu.</p>`;
    return;
  }
  box.innerHTML = list
    .map(
      (g) => `
        <div class="insight-item">
          <span>${g.nama}</span>
          <span class="insight-badge insight-badge-warn">${g.issue}</span>
        </div>`,
    )
    .join("");
}

function renderSiswaBelumAkun(data) {
  const box = document.getElementById("insight-siswa-belum-akun");
  if (!box) return;
  const count = data?.count || 0;
  if (!count) {
    box.innerHTML = `<p class="insight-empty">Semua siswa sudah punya akun login ter-link.</p>`;
    return;
  }
  const sampleHtml = (data.sample || [])
    .map(
      (s) => `
        <div class="insight-item">
          <span>${s.nama}</span>
          <span class="insight-badge insight-badge-warn">NIS ${s.nis || "-"}</span>
        </div>`,
    )
    .join("");
  const more =
    count > (data.sample || []).length
      ? `<p class="insight-more">+${count - data.sample.length} siswa lainnya</p>`
      : "";
  box.innerHTML = `
    <p class="insight-summary">${count} siswa belum punya akun login.</p>
    ${sampleHtml}
    ${more}
  `;
}

async function loadDashboard() {
  showDashboardError(false);
  setDashboardCardsLoading();

  let res;
  try {
    res = await fetch("/api/admin/dashboard", { credentials: "include" });
  } catch (err) {
    console.error("loadDashboard fetch error:", err);
    showDashboardError(true, "Tidak bisa terhubung ke server.");
    return;
  }

  if (!res.ok) {
    let msg = `Gagal memuat data dashboard (HTTP ${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson?.error) msg = errJson.error;
    } catch {
      // respons bukan JSON, pakai pesan default di atas
    }
    showDashboardError(true, msg);
    errorAlert(msg, "Gagal Memuat Dashboard");
    return;
  }

  const d = await res.json();

  document.getElementById("count-guru").textContent = d.guru ?? 0;
  document.getElementById("count-siswa").textContent = d.siswa ?? 0;
  document.getElementById("count-kelas").textContent = d.kelas ?? 0;
  document.getElementById("count-staff").textContent = d.staff ?? 0;
  document.getElementById("count-sarana").textContent = d.sarana ?? 0;
  document.getElementById("count-prasarana").textContent = d.prasarana ?? 0;

  const ekskul = d.ekstrakurikuler || {};
  document.getElementById("count-ekskul").textContent = ekskul.aktif ?? 0;
  const pesertaEl = document.getElementById("count-ekskul-peserta");
  if (pesertaEl) {
    pesertaEl.textContent = `${ekskul.total_peserta ?? 0} peserta aktif`;
  }

  document.getElementById("count-jadwal").textContent = d.jadwal_generated ?? 0;

  const insights = d.insights || {};
  renderEkskulHampirPenuh(insights.ekskul_hampir_penuh);
  renderGuruBelumLengkap(insights.guru_belum_lengkap);
  renderSiswaBelumAkun(insights.siswa_belum_akun);
}

/* Kartu dashboard yang clickable -> pindah ke halaman terkait, memakai
   tombol sidebar yang sudah ada supaya logic switch-page tetap satu jalur. */
document.querySelectorAll(".card[data-page]").forEach((card) => {
  card.style.cursor = "pointer";
  card.addEventListener("click", () => {
    const page = card.dataset.page;
    const btn = document.querySelector(`.sidebar button[data-page="${page}"]`);
    if (btn) btn.click();
  });
});

document.getElementById("dashboard-retry")?.addEventListener("click", () => {
  loadDashboard();
});

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
      document.getElementById("guruFormModalTitle").textContent = "Edit Guru";
      openFormModal("guruFormModalOverlay");
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

  // Validasi nomor HP Indonesia
  const hp = f.hp.value.trim();

  if (!/^(08|628)[0-9]{8,13}$/.test(hp)) {
    return errorAlert(
      "Nomor HP tidak valid. Gunakan format 08xxxxxxxxxx atau 628xxxxxxxxxx",
    );
  }

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
  closeFormModal("guruFormModalOverlay");
  loadGuru();
};

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
        <button class="edit-staff" data-id="${s.id}">Edit</button>
        <button class="detail-staff" data-id="${s.id}">Detail</button>
        <button class="delete-staff" data-id="${s.id}">Hapus</button>
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
      document.getElementById("staffFormModalTitle").textContent = "Edit Staff";
      openFormModal("staffFormModalOverlay");
    };
  });

  document.querySelectorAll(".detail-staff").forEach((b) => {
    b.onclick = () => showStaffDetail(b.dataset.id);
  });

  document.querySelectorAll(".delete-staff").forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.id;

      const yakin = confirm(
        "Apakah Anda yakin ingin menghapus data staff ini?",
      );

      if (!yakin) return;

      try {
        const res = await fetch("/api/admin/staff/" + id, {
          method: "DELETE",
          credentials: "include",
        });

        const result = await res.json();

        if (!res.ok) {
          alert(result.error || "Gagal menghapus data staff");
          return;
        }

        alert(result.message || "Data staff berhasil dihapus");

        // Muat ulang tabel
        loadStaff();
      } catch (err) {
        console.error("delete staff error:", err);
        alert("Terjadi kesalahan saat menghapus data staff");
      }
    };
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

document.getElementById("staffForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;

  const noHp = f.no_hp.value.trim();
  if (noHp && !/^(08|628)[0-9]{8,13}$/.test(noHp)) {
    return errorAlert(
      "Nomor HP tidak valid. Gunakan format 08xxxxxxxxxx atau 628xxxxxxxxxx",
    );
  }

  const body = {
    nik: f.nik.value,
    nama_lengkap: f.nama_lengkap.value,
    jenis_kelamin: f.jenis_kelamin.value,
    agama: f.agama.value,
    tempat_lahir: f.tempat_lahir.value,
    tanggal_lahir: f.tanggal_lahir.value,
    alamat: f.alamat.value,
    no_hp: f.no_hp.value,
    email: f.email.value,
    jabatan: f.jabatan.value,
    status_kepegawaian: f.status_kepegawaian.value,
    tanggal_mulai: f.tanggal_mulai.value,
    status: f.status.value,
    keterangan: f.keterangan.value,
  };
  const url = f.dataset.editId
    ? "/api/admin/staff/" + f.dataset.editId
    : "/api/admin/staff";
  const method = f.dataset.editId ? "PUT" : "POST";

  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    return errorAlert(errData.error || "Gagal menyimpan data staff");
  }

  delete f.dataset.editId;
  f.reset();
  closeFormModal("staffFormModalOverlay");
  successAlert("Data staff berhasil disimpan");
  loadStaff();
  populateStaffJabatanFilter();
};

document.getElementById("staffSearchNama").oninput = () => loadStaff();
document.getElementById("staffFilterJabatan").onchange = () => loadStaff();
document.getElementById("staffFilterStatus").onchange = () => loadStaff();

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
      document.getElementById("kelasFormModalTitle").textContent = "Edit Kelas";
      openFormModal("kelasFormModalOverlay");
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
  closeFormModal("kelasFormModalOverlay");
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
      document.getElementById("siswaFormModalTitle").textContent = "Edit Siswa";
      openFormModal("siswaFormModalOverlay");
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
    closeFormModal("siswaFormModalOverlay");
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

/* =========================================================
   SARANA
========================================================= */

const conditionLabel = {
  baik: "Baik",
  rusak_ringan: "Rusak Ringan",
  rusak_berat: "Rusak Berat",
};

const statusLabel = {
  aktif: "Aktif",
  nonaktif: "Nonaktif",
};

function escapeHtml(value) {
  if (value === null || value === undefined) return "-";

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadSaranaStats() {
  try {
    const res = await fetch("/api/admin/facilities/stats", {
      credentials: "include",
    });

    if (!res.ok) throw new Error();

    const d = await res.json();
    const stats = d.data || {};

    document.getElementById("saranaStatTotal").textContent = stats.total || 0;

    document.getElementById("saranaStatBaik").textContent = stats.baik || 0;

    document.getElementById("saranaStatRusakRingan").textContent =
      stats.rusak_ringan || 0;

    document.getElementById("saranaStatRusakBerat").textContent =
      stats.rusak_berat || 0;
  } catch (err) {
    console.error("loadSaranaStats:", err);
  }
}

async function populateSaranaCategories() {
  const selects = [
    document.getElementById("saranaCategoryId"),
    document.getElementById("saranaFilterCategory"),
  ].filter(Boolean);

  try {
    const res = await fetch("/api/admin/facility-categories", {
      credentials: "include",
    });

    if (!res.ok) return;

    const d = await res.json();
    const data = d.data || [];

    selects.forEach((select, index) => {
      const currentValue = select.value;

      select.innerHTML =
        index === 0
          ? `<option value="">-- Pilih Kategori --</option>`
          : `<option value="">Semua Kategori</option>`;

      data.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.name;
        select.appendChild(option);
      });

      select.value = currentValue;
    });
  } catch (err) {
    console.error("populateSaranaCategories:", err);
  }
}

async function populateSaranaLocations() {
  const select = document.getElementById("saranaFilterLocation");
  if (!select) return;

  try {
    const res = await fetch("/api/admin/facilities/locations", {
      credentials: "include",
    });

    if (!res.ok) return;

    const d = await res.json();
    const locations = d.data || [];
    const currentValue = select.value;

    select.innerHTML = `<option value="">Semua Lokasi</option>`;

    locations.forEach((location) => {
      const option = document.createElement("option");
      option.value = location;
      option.textContent = location;
      select.appendChild(option);
    });

    select.value = currentValue;
  } catch (err) {
    console.error("populateSaranaLocations:", err);
  }
}

async function loadSarana() {
  const search = document.getElementById("saranaSearch")?.value.trim() || "";

  const categoryId =
    document.getElementById("saranaFilterCategory")?.value || "";

  const condition =
    document.getElementById("saranaFilterCondition")?.value || "";

  const status = document.getElementById("saranaFilterStatus")?.value || "";

  const location = document.getElementById("saranaFilterLocation")?.value || "";

  const params = new URLSearchParams();

  if (search) params.set("search", search);
  if (categoryId) params.set("category_id", categoryId);
  if (condition) params.set("condition_status", condition);
  if (status) params.set("status", status);
  if (location) params.set("location", location);

  try {
    const res = await fetch(`/api/admin/facilities?${params.toString()}`, {
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Gagal memuat data sarana");
    }

    const d = await res.json();
    const data = d.data || [];

    const tbody = document.querySelector("#saranaTable tbody");

    if (!tbody) return;

    if (!data.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="table-empty">
            Data sarana belum tersedia.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = data
      .map(
        (item) => `
        <tr>
          <td>${escapeHtml(item.code)}</td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.category_name)}</td>
          <td>${escapeHtml(item.quantity)}</td>
          <td>${conditionLabel[item.condition_status] || item.condition_status}</td>
          <td>${escapeHtml(item.location)}</td>
          <td>${statusLabel[item.status] || item.status}</td>
          <td>
            <div class="action-buttons">
              <button
                class="btn-detail"
                data-sarana-detail="${item.id}"
              >
                Detail
              </button>

              <button
                class="btn-edit"
                data-sarana-edit="${item.id}"
              >
                Edit
              </button>

              <button
                class="btn-delete"
                data-sarana-delete="${item.id}"
              >
                Hapus
              </button>
            </div>
          </td>
        </tr>
      `,
      )
      .join("");

    tbody.querySelectorAll("[data-sarana-detail]").forEach((btn) => {
      btn.onclick = () => showSaranaDetail(btn.dataset.saranaDetail);
    });

    tbody.querySelectorAll("[data-sarana-edit]").forEach((btn) => {
      btn.onclick = () => editSarana(btn.dataset.saranaEdit);
    });

    tbody.querySelectorAll("[data-sarana-delete]").forEach((btn) => {
      btn.onclick = () => deleteSarana(btn.dataset.saranaDelete);
    });
  } catch (err) {
    console.error("loadSarana:", err);
    errorAlert("Gagal memuat data sarana");
  }
}

function formatMaintenanceStatus(status) {
  const labels = {
    dilaporkan: "Dilaporkan",
    diproses: "Diproses",
    selesai: "Selesai",
  };

  return labels[status] || status || "-";
}

function formatMaintenanceDate(value) {
  if (!value) return "-";

  return String(value).slice(0, 10);
}

function formatMaintenanceCost(value) {
  return `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
}

function renderFacilityMaintenance(rows) {
  const tbody = document.querySelector("#facilityMaintenanceTable tbody");

  if (!tbody) return;

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="maintenance-empty">
          Belum ada riwayat pemeliharaan.
        </td>
      </tr>
    `;

    return;
  }

  tbody.innerHTML = rows
    .map(
      (item) => `
        <tr>
          <td>${formatMaintenanceDate(item.maintenance_date)}</td>

          <td>${escapeHtml(item.issue_description || "-")}</td>

          <td>${escapeHtml(item.action_taken || "-")}</td>

          <td>${formatMaintenanceCost(item.cost)}</td>

          <td>${formatMaintenanceStatus(item.status)}</td>

          <td>${escapeHtml(item.notes || "-")}</td>

          <td>
            <button
              type="button"
              class="edit-facility-maintenance"
              data-id="${item.id}"
            >
              Edit
            </button>

            <button
              type="button"
              class="del-facility-maintenance"
              data-id="${item.id}"
            >
              Hapus
            </button>
          </td>
        </tr>
      `,
    )
    .join("");

  attachFacilityMaintenanceActions();
}
async function loadFacilityMaintenance(facilityId) {
  const tbody = document.querySelector("#facilityMaintenanceTable tbody");

  if (!tbody || !facilityId) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="7" style="text-align:center">
        Memuat riwayat pemeliharaan...
      </td>
    </tr>
  `;

  try {
    const res = await fetch(`/api/admin/facilities/${facilityId}/maintenance`, {
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Gagal memuat riwayat pemeliharaan");
    }

    const json = await res.json();

    renderFacilityMaintenance(json.data || []);
  } catch (err) {
    console.error("loadFacilityMaintenance:", err);

    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;color:#dc2626">
          Gagal memuat riwayat pemeliharaan.
        </td>
      </tr>
    `;
  }
}

async function showSaranaDetail(id) {
  currentFacilityDetailId = Number(id);
  try {
    const res = await fetch(`/api/admin/facilities/${id}`, {
      credentials: "include",
    });

    if (!res.ok) {
      return errorAlert("Detail sarana tidak ditemukan");
    }

    const d = await res.json();
    const item = d.data;

    const content = document.getElementById("saranaDetailContent");

    content.innerHTML = `
      <div class="detail-card">
        <table>
          <tbody>
            <tr><th>Kode</th><td>${escapeHtml(item.code)}</td></tr>
            <tr><th>Nama</th><td>${escapeHtml(item.name)}</td></tr>
            <tr><th>Kategori</th><td>${escapeHtml(item.category_name)}</td></tr>
            <tr><th>Jumlah</th><td>${escapeHtml(item.quantity)}</td></tr>
            <tr><th>Kondisi</th><td>${conditionLabel[item.condition_status] || item.condition_status}</td></tr>
            <tr><th>Lokasi</th><td>${escapeHtml(item.location)}</td></tr>
            <tr><th>Tanggal Pengadaan</th><td>${escapeHtml(item.procurement_date)}</td></tr>
            <tr><th>Sumber Dana</th><td>${escapeHtml(item.funding_source)}</td></tr>
            <tr><th>Status</th><td>${statusLabel[item.status] || item.status}</td></tr>
            <tr><th>Deskripsi</th><td>${escapeHtml(item.description)}</td></tr>
          </tbody>
        </table>
      </div>
    `;

    const maintenanceBody = document.querySelector(
      "#facilityMaintenanceTable tbody",
    );

    const maintenance = d.maintenance || [];

    if (!maintenance.length) {
      maintenanceBody.innerHTML = `
        <tr>
          <td colspan="6" class="maintenance-empty">
            Belum ada riwayat pemeliharaan.
          </td>
        </tr>
      `;
    } else {
      maintenanceBody.innerHTML = maintenance
        .map(
          (m) => `
          <tr>
            <td>${escapeHtml(m.maintenance_date)}</td>
            <td>${escapeHtml(m.issue_description)}</td>
            <td>${escapeHtml(m.action_taken)}</td>
            <td>Rp ${Number(m.cost || 0).toLocaleString("id-ID")}</td>
            <td>${escapeHtml(m.status)}</td>
            <td>${escapeHtml(m.notes)}</td>
          </tr>
        `,
        )
        .join("");
    }

    showAdminPage("sarana-detail");
    await loadFacilityMaintenance(id);
  } catch (err) {
    console.error("showSaranaDetail:", err);
    errorAlert("Gagal memuat detail sarana");
  }
}

function openFacilityMaintenanceCreateForm() {
  if (!currentFacilityDetailId) {
    errorAlert("Sarana belum dipilih");
    return;
  }

  const wrapper = document.getElementById("facilityMaintenanceFormWrapper");

  const form = document.getElementById("facilityMaintenanceForm");

  const title = document.getElementById("facilityMaintenanceFormTitle");

  form.reset();
  delete form.dataset.editId;

  title.textContent = "Tambah Riwayat Pemeliharaan";

  form.maintenance_date.value = new Date().toISOString().slice(0, 10);

  form.status.value = "dilaporkan";
  form.cost.value = "0";

  wrapper.style.display = "flex";
}
async function editFacilityMaintenance(id) {
  try {
    const res = await fetch(`/api/admin/facility-maintenance/${id}`, {
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Gagal memuat data pemeliharaan");
    }

    const json = await res.json();
    const item = json.data;

    const wrapper = document.getElementById("facilityMaintenanceFormWrapper");

    const form = document.getElementById("facilityMaintenanceForm");

    const title = document.getElementById("facilityMaintenanceFormTitle");

    form.reset();

    form.dataset.editId = item.id;

    form.maintenance_date.value = item.maintenance_date
      ? String(item.maintenance_date).slice(0, 10)
      : "";

    form.issue_description.value = item.issue_description || "";

    form.action_taken.value = item.action_taken || "";

    form.cost.value = item.cost ?? 0;

    form.status.value = item.status || "dilaporkan";

    form.notes.value = item.notes || "";

    title.textContent = "Edit Riwayat Pemeliharaan";

    wrapper.style.display = "flex";
  } catch (err) {
    console.error("editFacilityMaintenance:", err);
    errorAlert("Gagal memuat data riwayat pemeliharaan");
  }
}
async function deleteFacilityMaintenance(id) {
  const confirmed = await confirmDelete(
    "Riwayat pemeliharaan ini akan dihapus secara permanen.",
  );

  if (!confirmed) return;

  try {
    const res = await fetch(`/api/admin/facility-maintenance/${id}`, {
      method: "DELETE",
      credentials: "include",
    });

    const json = await res.json();

    if (!res.ok || !json.ok) {
      errorAlert(json.error || "Gagal menghapus riwayat pemeliharaan");
      return;
    }

    successAlert(json.message || "Riwayat pemeliharaan berhasil dihapus");

    await loadFacilityMaintenance(currentFacilityDetailId);
  } catch (err) {
    console.error("deleteFacilityMaintenance:", err);
    errorAlert("Terjadi kesalahan saat menghapus riwayat");
  }
}
function attachFacilityMaintenanceActions() {
  document.querySelectorAll(".edit-facility-maintenance").forEach((button) => {
    button.onclick = () => {
      editFacilityMaintenance(button.dataset.id);
    };
  });

  document.querySelectorAll(".del-facility-maintenance").forEach((button) => {
    button.onclick = () => {
      deleteFacilityMaintenance(button.dataset.id);
    };
  });
}

async function editSarana(id) {
  try {
    const res = await fetch(`/api/admin/facilities/${id}`, {
      credentials: "include",
    });

    if (!res.ok) {
      return errorAlert("Data sarana tidak ditemukan");
    }

    const d = await res.json();
    const item = d.data;
    const form = document.getElementById("saranaForm");

    await populateSaranaCategories();

    form.category_id.value = item.category_id;
    form.code.value = item.code || "";
    form.name.value = item.name || "";
    form.quantity.value = item.quantity || 1;
    form.condition_status.value = item.condition_status || "baik";
    form.location.value = item.location || "";
    form.procurement_date.value = item.procurement_date
      ? String(item.procurement_date).slice(0, 10)
      : "";
    form.funding_source.value = item.funding_source || "";
    form.status.value = item.status || "aktif";
    form.description.value = item.description || "";

    form.dataset.editId = id;

    document.getElementById("saranaFormModalTitle").textContent = "Edit Sarana";
    openFormModal("saranaFormModalOverlay");
  } catch (err) {
    console.error("editSarana:", err);
    errorAlert("Gagal memuat data sarana");
  }
}

async function deleteSarana(id) {
  const confirmed = await confirmDelete(
    "Data sarana dan riwayat pemeliharaannya akan dihapus.",
  );

  if (!confirmed) return;

  try {
    const res = await fetch(`/api/admin/facilities/${id}`, {
      method: "DELETE",
      credentials: "include",
    });

    const d = await res.json().catch(() => ({}));

    if (!res.ok || !d.ok) {
      return errorAlert(d.error || "Gagal menghapus sarana");
    }

    successAlert("Data sarana berhasil dihapus");
    loadSarana();
    loadSaranaStats();
    populateSaranaLocations();
  } catch (err) {
    console.error("deleteSarana:", err);
    errorAlert("Gagal menghapus sarana");
  }
}

document.getElementById("saranaForm").onsubmit = async (e) => {
  e.preventDefault();

  const form = e.target;

  const body = {
    category_id: Number(form.category_id.value),
    code: form.code.value.trim(),
    name: form.name.value.trim(),
    quantity: Number(form.quantity.value || 1),
    condition_status: form.condition_status.value,
    location: form.location.value.trim() || null,
    procurement_date: form.procurement_date.value || null,
    funding_source: form.funding_source.value.trim() || null,
    status: form.status.value,
    description: form.description.value.trim() || null,
  };

  const editId = form.dataset.editId;

  const url = editId
    ? `/api/admin/facilities/${editId}`
    : "/api/admin/facilities";

  const method = editId ? "PUT" : "POST";

  try {
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const d = await res.json().catch(() => ({}));

    if (!res.ok || !d.ok) {
      return errorAlert(d.error || "Gagal menyimpan data sarana");
    }

    successAlert(
      editId
        ? "Data sarana berhasil diperbarui"
        : "Data sarana berhasil ditambahkan",
    );

    delete form.dataset.editId;
    form.reset();

    closeFormModal("saranaFormModalOverlay");

    loadSarana();
    loadSaranaStats();
    populateSaranaLocations();
  } catch (err) {
    console.error("submit sarana:", err);
    errorAlert("Terjadi kesalahan saat menyimpan sarana");
  }
};

document.getElementById("saranaCancelEdit").onclick = () => {
  const form = document.getElementById("saranaForm");

  delete form.dataset.editId;
  form.reset();

  closeFormModal("saranaFormModalOverlay");
};

document.getElementById("saranaDetailBack").onclick = () => {
  showAdminPage("sarana");
  loadSarana();
};

[
  "saranaSearch",
  "saranaFilterCategory",
  "saranaFilterCondition",
  "saranaFilterStatus",
  "saranaFilterLocation",
].forEach((id) => {
  const element = document.getElementById(id);

  if (!element) return;

  element.addEventListener(id === "saranaSearch" ? "input" : "change", () =>
    loadSarana(),
  );
});

/* =========================================================
   PRASARANA
========================================================= */

function showAdminPage(pageName) {
  document
    .querySelectorAll(".page")
    .forEach((page) => page.classList.remove("active"));

  const page = document.getElementById(`page-${pageName}`);

  if (page) page.classList.add("active");
}

async function loadPrasaranaStats() {
  try {
    const res = await fetch("/api/admin/infrastructure/stats", {
      credentials: "include",
    });

    if (!res.ok) throw new Error();

    const d = await res.json();
    const stats = d.data || {};

    document.getElementById("prasaranaStatTotal").textContent =
      stats.total || 0;

    document.getElementById("prasaranaStatBaik").textContent = stats.baik || 0;

    document.getElementById("prasaranaStatRusakRingan").textContent =
      stats.rusak_ringan || 0;

    document.getElementById("prasaranaStatRusakBerat").textContent =
      stats.rusak_berat || 0;
  } catch (err) {
    console.error("loadPrasaranaStats:", err);
  }
}

async function populatePrasaranaTypes() {
  const select = document.getElementById("prasaranaFilterType");

  if (!select) return;

  try {
    const res = await fetch("/api/admin/infrastructure/types", {
      credentials: "include",
    });

    if (!res.ok) return;

    const d = await res.json();
    const types = d.data || [];
    const currentValue = select.value;

    select.innerHTML = `<option value="">Semua Jenis</option>`;

    types.forEach((type) => {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      select.appendChild(option);
    });

    select.value = currentValue;
  } catch (err) {
    console.error("populatePrasaranaTypes:", err);
  }
}

async function loadPrasarana() {
  const search = document.getElementById("prasaranaSearch")?.value.trim() || "";

  const type = document.getElementById("prasaranaFilterType")?.value || "";

  const condition =
    document.getElementById("prasaranaFilterCondition")?.value || "";

  const status = document.getElementById("prasaranaFilterStatus")?.value || "";

  const params = new URLSearchParams();

  if (search) params.set("search", search);
  if (type) params.set("type", type);
  if (condition) params.set("condition_status", condition);
  if (status) params.set("status", status);

  try {
    const res = await fetch(`/api/admin/infrastructure?${params.toString()}`, {
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Gagal memuat prasarana");
    }

    const d = await res.json();
    const data = d.data || [];

    const tbody = document.querySelector("#prasaranaTable tbody");

    if (!tbody) return;

    if (!data.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="table-empty">
            Data prasarana belum tersedia.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = data
      .map(
        (item) => `
        <tr>
          <td>${escapeHtml(item.code)}</td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.type)}</td>
          <td>${escapeHtml(item.capacity)}</td>
          <td>${escapeHtml(item.area_size)}</td>
          <td>${escapeHtml(item.location)}</td>
          <td>${conditionLabel[item.condition_status] || item.condition_status}</td>
          <td>${statusLabel[item.status] || item.status}</td>
          <td>
            <div class="action-buttons">
              <button
                class="btn-detail"
                data-prasarana-detail="${item.id}"
              >
                Detail
              </button>

              <button
                class="btn-edit"
                data-prasarana-edit="${item.id}"
              >
                Edit
              </button>

              <button
                class="btn-delete"
                data-prasarana-delete="${item.id}"
              >
                Hapus
              </button>
            </div>
          </td>
        </tr>
      `,
      )
      .join("");

    tbody.querySelectorAll("[data-prasarana-detail]").forEach((btn) => {
      btn.onclick = () => showPrasaranaDetail(btn.dataset.prasaranaDetail);
    });

    tbody.querySelectorAll("[data-prasarana-edit]").forEach((btn) => {
      btn.onclick = () => editPrasarana(btn.dataset.prasaranaEdit);
    });

    tbody.querySelectorAll("[data-prasarana-delete]").forEach((btn) => {
      btn.onclick = () => deletePrasarana(btn.dataset.prasaranaDelete);
    });
  } catch (err) {
    console.error("loadPrasarana:", err);
    errorAlert("Gagal memuat data prasarana");
  }
}

async function showPrasaranaDetail(id) {
  try {
    const res = await fetch(`/api/admin/infrastructure/${id}`, {
      credentials: "include",
    });

    if (!res.ok) {
      return errorAlert("Detail prasarana tidak ditemukan");
    }

    const d = await res.json();
    const item = d.data;

    document.getElementById("prasaranaDetailContent").innerHTML = `
      <div class="detail-card">
        <table>
          <tbody>
            <tr><th>Kode</th><td>${escapeHtml(item.code)}</td></tr>
            <tr><th>Nama</th><td>${escapeHtml(item.name)}</td></tr>
            <tr><th>Jenis</th><td>${escapeHtml(item.type)}</td></tr>
            <tr><th>Kapasitas</th><td>${escapeHtml(item.capacity)}</td></tr>
            <tr><th>Luas</th><td>${escapeHtml(item.area_size)} m²</td></tr>
            <tr><th>Lokasi</th><td>${escapeHtml(item.location)}</td></tr>
            <tr><th>Kondisi</th><td>${conditionLabel[item.condition_status] || item.condition_status}</td></tr>
            <tr><th>Status</th><td>${statusLabel[item.status] || item.status}</td></tr>
            <tr><th>Deskripsi</th><td>${escapeHtml(item.description)}</td></tr>
          </tbody>
        </table>
      </div>
    `;

    showAdminPage("prasarana-detail");
  } catch (err) {
    console.error("showPrasaranaDetail:", err);
    errorAlert("Gagal memuat detail prasarana");
  }
}

async function editPrasarana(id) {
  try {
    const res = await fetch(`/api/admin/infrastructure/${id}`, {
      credentials: "include",
    });

    if (!res.ok) {
      return errorAlert("Data prasarana tidak ditemukan");
    }

    const d = await res.json();
    const item = d.data;
    const form = document.getElementById("prasaranaForm");

    form.code.value = item.code || "";
    form.name.value = item.name || "";
    form.type.value = item.type || "";
    form.capacity.value = item.capacity ?? "";
    form.area_size.value = item.area_size ?? "";
    form.location.value = item.location || "";
    form.condition_status.value = item.condition_status || "baik";
    form.status.value = item.status || "aktif";
    form.description.value = item.description || "";

    form.dataset.editId = id;

    document.getElementById("prasaranaFormModalTitle").textContent =
      "Edit Prasarana";
    openFormModal("prasaranaFormModalOverlay");
  } catch (err) {
    console.error("editPrasarana:", err);
    errorAlert("Gagal memuat data prasarana");
  }
}

async function deletePrasarana(id) {
  const confirmed = await confirmDelete("Data prasarana akan dihapus.");

  if (!confirmed) return;

  try {
    const res = await fetch(`/api/admin/infrastructure/${id}`, {
      method: "DELETE",
      credentials: "include",
    });

    const d = await res.json().catch(() => ({}));

    if (!res.ok || !d.ok) {
      return errorAlert(d.error || "Gagal menghapus prasarana");
    }

    successAlert("Data prasarana berhasil dihapus");

    loadPrasarana();
    loadPrasaranaStats();
    populatePrasaranaTypes();
  } catch (err) {
    console.error("deletePrasarana:", err);
    errorAlert("Gagal menghapus prasarana");
  }
}

document.getElementById("prasaranaForm").onsubmit = async (e) => {
  e.preventDefault();

  const form = e.target;

  const body = {
    code: form.code.value.trim(),
    name: form.name.value.trim(),
    type: form.type.value.trim(),
    capacity: form.capacity.value === "" ? null : Number(form.capacity.value),
    area_size:
      form.area_size.value === "" ? null : Number(form.area_size.value),
    location: form.location.value.trim() || null,
    condition_status: form.condition_status.value,
    status: form.status.value,
    description: form.description.value.trim() || null,
  };

  const editId = form.dataset.editId;

  const url = editId
    ? `/api/admin/infrastructure/${editId}`
    : "/api/admin/infrastructure";

  const method = editId ? "PUT" : "POST";

  try {
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const d = await res.json().catch(() => ({}));

    if (!res.ok || !d.ok) {
      return errorAlert(d.error || "Gagal menyimpan prasarana");
    }

    successAlert(
      editId
        ? "Data prasarana berhasil diperbarui"
        : "Data prasarana berhasil ditambahkan",
    );

    delete form.dataset.editId;
    form.reset();

    closeFormModal("prasaranaFormModalOverlay");

    loadPrasarana();
    loadPrasaranaStats();
    populatePrasaranaTypes();
  } catch (err) {
    console.error("submit prasarana:", err);
    errorAlert("Terjadi kesalahan saat menyimpan prasarana");
  }
};

document.getElementById("prasaranaCancelEdit").onclick = () => {
  const form = document.getElementById("prasaranaForm");

  delete form.dataset.editId;
  form.reset();

  closeFormModal("prasaranaFormModalOverlay");
};

document.getElementById("prasaranaDetailBack").onclick = () => {
  showAdminPage("prasarana");
  loadPrasarana();
};

[
  "prasaranaSearch",
  "prasaranaFilterType",
  "prasaranaFilterCondition",
  "prasaranaFilterStatus",
].forEach((id) => {
  const element = document.getElementById(id);

  if (!element) return;

  element.addEventListener(id === "prasaranaSearch" ? "input" : "change", () =>
    loadPrasarana(),
  );
});

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
  loadStaff();
  populateStaffJabatanFilter();
  await populateSaranaCategories();
  populateSaranaLocations();
  populatePrasaranaTypes();
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

let currentFacilityDetailId = null;

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
        <button class="ghost" data-download="${idx}">Download json</button>
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

  // download buttons
  sched_schedulesWrap.querySelectorAll("[data-download]").forEach((btn) => {
    btn.onclick = (e) => {
      const idx = Number(e.currentTarget.dataset.download);
      const data = sched_loadLocalSchedules()[idx];
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeName = (data.name || "jadwal").replace(/[^a-z0-9_\-]+/gi, "_");
      a.href = url;
      a.download = `${safeName}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
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

/* ---------- render schedule detail (table) ---------- */
const DAY_LABELS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
// Default index sesi istirahat (0-based). HARUS konsisten dengan
// BREAK_SESSION_INDEXES di src/services/scheduler.ts. Sesi ke-4 = index 3,
// sesi ke-8 = index 7. Sebelumnya di sini cuma ada 1 nilai (index 3) sehingga
// sesi ke-8 tidak pernah ditandai "Istirahat" walau backend GA sudah
// menghindarinya -> tampil sebagai sel kosong yang membingungkan.
const SCHED_BREAK_SESSIONS = [3, 7];
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
      : SCHED_BREAK_SESSIONS;

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
    breakSessionIndexes: SCHED_BREAK_SESSIONS,
  };

  // Tampilkan loading (overlay + tombol) selama proses generate berlangsung.
  // Kalau proses sebelumnya masih berjalan (klik ganda), hentikan di sini.
  if (!beforeScheduleGenerate()) return;

  const scheduleGenerateStartedAt = performance.now();

  // POST to /api/generate
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text();
      afterScheduleGenerateError();
      errorAlert("Generate gagal — server returned: " + (txt || res.status));
      return;
    }
    const json = await res.json();
    if (!json.ok) {
      afterScheduleGenerateError();
      errorAlert("Generate gagal");
      return;
    }

    // proses generate di server sudah selesai & sukses
    afterScheduleGenerateSuccess();

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
    const scheduleGenerateSeconds = (
      (performance.now() - scheduleGenerateStartedAt) /
      1000
    ).toFixed(1);
    successAlert(
      `Generate sukses 🎉 | Fitness: ${payload.fitness} | Waktu proses: ${scheduleGenerateSeconds} detik`,
    );
    // refresh list and detail
    sched_renderAllLocalSchedules();
    sched_renderScheduleDetail(payload);
  } catch (err) {
    console.error(err);
    afterScheduleGenerateError();
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

/* ========================================================= LOADING PENJADWALAN ========================================================= */ const scheduleLoadingOverlay =
  document.getElementById("scheduleLoadingOverlay");
const scheduleLoadingText = document.getElementById("scheduleLoadingText");
const scheduleGenerateBtn = document.getElementById("scheduleGenerateBtn");
/** * Aktifkan loading penjadwalan */ function startScheduleLoading() {
  if (scheduleLoadingOverlay) {
    scheduleLoadingOverlay.classList.add("show");
    scheduleLoadingOverlay.setAttribute("aria-hidden", "false");
  }
  if (scheduleLoadingText) {
    scheduleLoadingText.textContent =
      "Mohon tunggu, sistem sedang menghitung jadwal terbaik...";
  }
  if (scheduleGenerateBtn) {
    scheduleGenerateBtn.disabled = true;
    scheduleGenerateBtn.classList.add("schedule-generate-loading");
    scheduleGenerateBtn.innerHTML = ` <span class="schedule-loading-spinner" aria-hidden="true" ></span> <span>Sedang Generate...</span> `;
  }
  /* * Cegah user meninggalkan halaman secara tidak sengaja * menggunakan tombol reload/back ketika proses masih berjalan. */ window.__scheduleGenerating = true;
}
/** * Matikan loading penjadwalan */ function stopScheduleLoading() {
  if (scheduleLoadingOverlay) {
    scheduleLoadingOverlay.classList.remove("show");
    scheduleLoadingOverlay.setAttribute("aria-hidden", "true");
  }
  if (scheduleGenerateBtn) {
    scheduleGenerateBtn.disabled = false;
    scheduleGenerateBtn.classList.remove("schedule-generate-loading");
    scheduleGenerateBtn.innerHTML = ` <span class="schedule-generate-btn-text"> Simpan & Generate </span> `;
  }
  window.__scheduleGenerating = false;
}
/** * Tampilkan pesan loading sesuai tahap proses */ function updateScheduleLoadingText(
  text,
) {
  if (scheduleLoadingText) {
    scheduleLoadingText.textContent = text;
  }
}
/* * Jangan izinkan submit dua kali. */ let scheduleGenerateRunning = false;
/* ========================================================= HELPER UNTUK DIPANGGIL DI HANDLER GENERATE YANG SUDAH ADA ========================================================= */ /* * Panggil ini TEPAT sebelum fetch("/api/generate"). */ function beforeScheduleGenerate() {
  if (scheduleGenerateRunning) {
    return false;
  }
  scheduleGenerateRunning = true;
  startScheduleLoading();
  updateScheduleLoadingText("Tunggu hingga proses selesai...");
  return true;
}
/* * Panggil ini setelah generate berhasil. */ function afterScheduleGenerateSuccess() {
  updateScheduleLoadingText("Jadwal berhasil dibuat. Menyiapkan tampilan...");
  /* * Beri sedikit waktu agar user sempat melihat * pesan sukses sebelum overlay ditutup. */ setTimeout(
    () => {
      stopScheduleLoading();
      scheduleGenerateRunning = false;
    },
    500,
  );
}
/* * Panggil ini ketika generate gagal. */ function afterScheduleGenerateError() {
  stopScheduleLoading();
  scheduleGenerateRunning = false;
}

/* =========================================================
   EKSTRAKURIKULER - ADMIN
========================================================= */

let currentEkstrakurikulerDetailId = null;

const ekskulDayLabel = {
  senin: "Senin",
  selasa: "Selasa",
  rabu: "Rabu",
  kamis: "Kamis",
  jumat: "Jumat",
  sabtu: "Sabtu",
};

const ekskulStatusLabel = {
  aktif: "Aktif",
  nonaktif: "Nonaktif",
  keluar: "Keluar",
};

function formatEkstrakurikulerTime(value) {
  if (!value) return "-";
  return String(value).slice(0, 5);
}

/* =========================================================
   STATISTIK
========================================================= */

async function loadEkstrakurikulerStats() {
  try {
    const res = await fetch("/api/admin/extracurriculars/stats", {
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Gagal memuat statistik ekstrakurikuler");
    }

    const json = await res.json();
    const stats = json.data || {};

    document.getElementById("ekskulStatTotal").textContent = stats.total || 0;

    document.getElementById("ekskulStatAktif").textContent = stats.aktif || 0;

    document.getElementById("ekskulStatPeserta").textContent =
      stats.total_peserta || 0;
  } catch (err) {
    console.error("loadEkstrakurikulerStats:", err);
    errorAlert("Gagal memuat statistik ekstrakurikuler");
  }
}

/* =========================================================
   GURU / PEMBINA
========================================================= */

async function populateEkstrakurikulerTeachers() {
  const select = document.getElementById("ekskulTeacherSelect");

  if (!select) return;

  const currentValue = select.value;

  try {
    const res = await fetch("/api/admin/guru", {
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Gagal memuat guru");
    }

    const json = await res.json();
    const teachers = json.data || [];

    select.innerHTML = `<option value="">-- Pilih Guru / Pembina --</option>`;

    teachers.forEach((teacher) => {
      const option = document.createElement("option");

      option.value = teacher.id;
      option.textContent = `${teacher.nama}${teacher.nip ? ` — ${teacher.nip}` : ""}`;

      select.appendChild(option);
    });

    if (currentValue) {
      select.value = currentValue;
    }
  } catch (err) {
    console.error("populateEkstrakurikulerTeachers:", err);
    errorAlert("Gagal memuat daftar guru");
  }
}

/* =========================================================
   LIST
========================================================= */

async function loadEkstrakurikuler() {
  const tbody = document.querySelector("#ekstrakurikulerTable tbody");

  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="7" style="text-align:center">
        Memuat data ekstrakurikuler...
      </td>
    </tr>
  `;

  try {
    const res = await fetch("/api/admin/extracurriculars/", {
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Gagal memuat ekstrakurikuler");
    }

    const json = await res.json();
    const data = json.data || [];

    if (!data.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center">
            Belum ada data ekstrakurikuler.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = data
      .map(
        (item) => `
        <tr>
          <td>${escapeHtml(item.name)}</td>

          <td>${escapeHtml(item.teacher_name)}</td>

          <td>
            ${escapeHtml(ekskulDayLabel[item.day_of_week] || item.day_of_week)}
          </td>

          <td>
            ${formatEkstrakurikulerTime(item.start_time)}
            -
            ${formatEkstrakurikulerTime(item.end_time)}
          </td>

          <td>
            <strong>${item.active_members}</strong>
            /
            ${item.max_members ?? "-"}
            siswa
          </td>

          <td>
            ${item.status === "aktif" ? "Aktif" : "Nonaktif"}
          </td>

          <td>
            <div class="action-buttons">

              <button
                type="button"
                class="btn-detail"
                data-ekskul-detail="${item.id}"
              >
                Detail
              </button>

              <button
                type="button"
                class="btn-edit"
                data-ekskul-edit="${item.id}"
              >
                Edit
              </button>

              <button
                type="button"
                class="btn-delete"
                data-ekskul-delete="${item.id}"
              >
                Hapus
              </button>

            </div>
          </td>
        </tr>
      `,
      )
      .join("");

    tbody.querySelectorAll("[data-ekskul-detail]").forEach((button) => {
      button.onclick = () =>
        showEkstrakurikulerDetail(button.dataset.ekskulDetail);
    });

    tbody.querySelectorAll("[data-ekskul-edit]").forEach((button) => {
      button.onclick = () => editEkstrakurikuler(button.dataset.ekskulEdit);
    });

    tbody.querySelectorAll("[data-ekskul-delete]").forEach((button) => {
      button.onclick = () => deleteEkstrakurikuler(button.dataset.ekskulDelete);
    });
  } catch (err) {
    console.error("loadEkstrakurikuler:", err);

    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;color:#dc2626">
          Gagal memuat data ekstrakurikuler.
        </td>
      </tr>
    `;
  }
}

/* =========================================================
   FORM TAMBAH / EDIT
========================================================= */

document
  .getElementById("addEkstrakurikulerBtn")
  ?.addEventListener("click", async () => {
    const wrapper = document.getElementById("ekstrakurikulerFormWrapper");

    const form = document.getElementById("ekstrakurikulerForm");

    const title = document.getElementById("ekstrakurikulerFormTitle");

    await populateEkstrakurikulerTeachers();

    form.reset();

    delete form.dataset.editId;

    title.textContent = "Tambah Ekstrakurikuler";

    form.status.value = "aktif";
    form.max_members.value = 40;

    wrapper.style.display = "flex";
  });

document
  .getElementById("cancelEkstrakurikulerBtn")
  ?.addEventListener("click", () => {
    const wrapper = document.getElementById("ekstrakurikulerFormWrapper");

    const form = document.getElementById("ekstrakurikulerForm");

    form.reset();

    delete form.dataset.editId;

    wrapper.style.display = "none";
  });

document
  .getElementById("ekstrakurikulerForm")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const form = e.target;

    const body = {
      name: form.name.value.trim(),
      description: form.description.value.trim() || null,

      teacher_id: Number(form.teacher_id.value),

      day_of_week: form.day_of_week.value,

      start_time: form.start_time.value,
      end_time: form.end_time.value,

      location: form.location.value.trim() || null,

      max_members: Number(form.max_members.value),

      status: form.status.value,
    };

    const editId = form.dataset.editId;

    const url = editId
      ? `/api/admin/extracurriculars/${editId}`
      : "/api/admin/extracurriculars";

    const method = editId ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        return errorAlert(json.error || "Gagal menyimpan ekstrakurikuler");
      }

      successAlert(
        editId
          ? "Ekstrakurikuler berhasil diperbarui"
          : "Ekstrakurikuler berhasil ditambahkan",
      );

      form.reset();

      delete form.dataset.editId;

      document.getElementById("ekstrakurikulerFormWrapper").style.display =
        "none";

      await loadEkstrakurikuler();
      await loadEkstrakurikulerStats();
    } catch (err) {
      console.error("submit ekstrakurikuler:", err);

      errorAlert("Terjadi kesalahan saat menyimpan ekstrakurikuler");
    }
  });

/* =========================================================
   EDIT
========================================================= */

async function editEkstrakurikuler(id) {
  try {
    const res = await fetch(`/api/admin/extracurriculars/${id}`, {
      credentials: "include",
    });

    const json = await res.json();

    if (!res.ok || !json.ok) {
      return errorAlert(json.error || "Data ekstrakurikuler tidak ditemukan");
    }

    const item = json.data;

    await populateEkstrakurikulerTeachers();

    const form = document.getElementById("ekstrakurikulerForm");

    form.name.value = item.name || "";
    form.description.value = item.description || "";

    form.teacher_id.value = item.teacher_id || "";

    form.day_of_week.value = item.day_of_week || "";

    form.start_time.value = formatEkstrakurikulerTime(item.start_time);

    form.end_time.value = formatEkstrakurikulerTime(item.end_time);

    form.location.value = item.location || "";

    form.max_members.value = item.max_members ?? "";

    form.status.value = item.status || "aktif";

    form.dataset.editId = id;

    document.getElementById("ekstrakurikulerFormTitle").textContent =
      "Edit Ekstrakurikuler";

    document.getElementById("ekstrakurikulerFormWrapper").style.display =
      "flex";
  } catch (err) {
    console.error("editEkstrakurikuler:", err);

    errorAlert("Gagal memuat data ekstrakurikuler");
  }
}

/* =========================================================
   DELETE EKSTRAKURIKULER
========================================================= */

async function deleteEkstrakurikuler(id) {
  const confirmed = await confirmDelete(
    "Ekstrakurikuler dan seluruh data anggotanya akan dihapus.",
  );

  if (!confirmed) return;

  try {
    const res = await fetch(`/api/admin/extracurriculars/${id}`, {
      method: "DELETE",
      credentials: "include",
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || !json.ok) {
      return errorAlert(json.error || "Gagal menghapus ekstrakurikuler");
    }

    successAlert("Ekstrakurikuler berhasil dihapus");

    await loadEkstrakurikuler();
    await loadEkstrakurikulerStats();
  } catch (err) {
    console.error("deleteEkstrakurikuler:", err);

    errorAlert("Gagal menghapus ekstrakurikuler");
  }
}

/* =========================================================
   DETAIL
========================================================= */

async function showEkstrakurikulerDetail(id) {
  currentEkstrakurikulerDetailId = Number(id);

  try {
    const res = await fetch(`/api/admin/extracurriculars/${id}`, {
      credentials: "include",
    });

    const json = await res.json();

    if (!res.ok || !json.ok) {
      return errorAlert(json.error || "Detail ekstrakurikuler tidak ditemukan");
    }

    const item = json.data;

    document.getElementById("ekstrakurikulerDetailContent").innerHTML = `
      <div class="detail-card">

        <h2>${escapeHtml(item.name)}</h2>

        <table>
          <tbody>
            <tr>
              <th>Pembina</th>
              <td>${escapeHtml(item.teacher_name)}</td>
            </tr>

            <tr>
              <th>Hari</th>
              <td>
                ${escapeHtml(
                  ekskulDayLabel[item.day_of_week] || item.day_of_week,
                )}
              </td>
            </tr>

            <tr>
              <th>Waktu</th>
              <td>
                ${formatEkstrakurikulerTime(item.start_time)}
                -
                ${formatEkstrakurikulerTime(item.end_time)}
              </td>
            </tr>

            <tr>
              <th>Lokasi</th>
              <td>${escapeHtml(item.location)}</td>
            </tr>

            <tr>
              <th>Peserta</th>
              <td>
                <strong>${item.active_members}</strong>
                /
                ${item.max_members ?? "-"}
                siswa
              </td>
            </tr>

            <tr>
              <th>Status</th>
              <td>
                ${item.status === "aktif" ? "Aktif" : "Nonaktif"}
              </td>
            </tr>
          </tbody>
        </table>

        <div style="margin-top: 20px">
          <h3>Deskripsi</h3>
          <p>
            ${escapeHtml(item.description || "-")}
          </p>
        </div>

      </div>
    `;

    await populateEkstrakurikulerStudents();
    await loadEkstrakurikulerMembers(id);

    const joinDate = document.getElementById("ekskulJoinDate");

    if (joinDate) {
      joinDate.value = new Date().toISOString().slice(0, 10);
    }

    showAdminPage("ekstrakurikuler-detail");
  } catch (err) {
    console.error("showEkstrakurikulerDetail:", err);

    errorAlert("Gagal memuat detail ekstrakurikuler");
  }
}

/* =========================================================
   DAFTAR SISWA UNTUK TAMBAH ANGGOTA
========================================================= */

async function populateEkstrakurikulerStudents() {
  const select = document.getElementById("ekskulStudentSelect");

  if (!select) return;

  try {
    const res = await fetch("/api/admin/siswa", {
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Gagal memuat siswa");
    }

    const json = await res.json();

    const students = json.data || [];

    select.innerHTML = `<option value="">-- Pilih Siswa --</option>`;

    students.forEach((student) => {
      const option = document.createElement("option");

      option.value = student.id;

      option.textContent =
        `${student.nis} — ${student.nama}` +
        `${student.kelas_nama ? ` (${student.kelas_nama})` : ""}`;

      select.appendChild(option);
    });
  } catch (err) {
    console.error("populateEkstrakurikulerStudents:", err);

    errorAlert("Gagal memuat daftar siswa");
  }
}

/* =========================================================
   TAMBAH ANGGOTA
========================================================= */

document
  .getElementById("ekstrakurikulerMemberForm")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!currentEkstrakurikulerDetailId) {
      return errorAlert("Ekstrakurikuler belum dipilih");
    }

    const form = e.target;

    const body = {
      student_id: Number(form.student_id.value),

      join_date: form.join_date.value,

      status: form.status.value,
    };

    try {
      const res = await fetch(
        `/api/admin/extracurriculars/${currentEkstrakurikulerDetailId}/members`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );

      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        return errorAlert(json.error || "Gagal menambahkan anggota");
      }

      successAlert(json.message || "Anggota berhasil ditambahkan");

      form.reset();

      form.join_date.value = new Date().toISOString().slice(0, 10);

      form.status.value = "aktif";

      closeFormModal("ekstrakurikulerMemberFormModalOverlay");

      await loadEkstrakurikulerMembers(currentEkstrakurikulerDetailId);

      await loadEkstrakurikulerStats();

      // Refresh detail karena angka peserta berubah.
      await showEkstrakurikulerDetail(currentEkstrakurikulerDetailId);
    } catch (err) {
      console.error("tambah anggota:", err);

      errorAlert("Terjadi kesalahan saat menambahkan anggota");
    }
  });

/* =========================================================
   DAFTAR ANGGOTA
========================================================= */

async function loadEkstrakurikulerMembers(extracurricularId) {
  const tbody = document.querySelector("#ekstrakurikulerMemberTable tbody");

  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="7" style="text-align:center">
        Memuat anggota...
      </td>
    </tr>
  `;

  try {
    const res = await fetch(
      `/api/admin/extracurriculars/${extracurricularId}/members`,
      {
        credentials: "include",
      },
    );

    const json = await res.json();

    if (!res.ok || !json.ok) {
      throw new Error(json.error || "Gagal memuat anggota");
    }

    const members = json.data || [];

    if (!members.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center">
            Belum ada anggota.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = members
      .map(
        (member, index) => `
        <tr>

          <td>${index + 1}</td>

          <td>${escapeHtml(member.nis)}</td>

          <td>${escapeHtml(member.student_name)}</td>

          <td>${escapeHtml(member.kelas_nama)}</td>

          <td>
            ${escapeHtml(String(member.join_date || "").slice(0, 10))}
          </td>

          <td>
            ${ekskulStatusLabel[member.status] || member.status}
          </td>

          <td>
            ${
              member.status === "aktif"
                ? `
                  <button
                    type="button"
                    class="btn-delete"
                    data-ekskul-member-out="${member.id}"
                  >
                    Keluarkan
                  </button>
                `
                : `
                  <button
                    type="button"
                    class="ghost"
                    data-ekskul-member-reactivate="${member.id}"
                  >
                    Aktifkan Lagi
                  </button>
                `
            }
          </td>

        </tr>
      `,
      )
      .join("");

    tbody.querySelectorAll("[data-ekskul-member-out]").forEach((button) => {
      button.onclick = () =>
        updateEkstrakurikulerMemberStatus(
          button.dataset.ekskulMemberOut,
          "keluar",
        );
    });

    tbody
      .querySelectorAll("[data-ekskul-member-reactivate]")
      .forEach((button) => {
        button.onclick = () =>
          updateEkstrakurikulerMemberStatus(
            button.dataset.ekskulMemberReactivate,
            "aktif",
          );
      });
  } catch (err) {
    console.error("loadEkstrakurikulerMembers:", err);

    tbody.innerHTML = `
      <tr>
        <td
          colspan="7"
          style="text-align:center;color:#dc2626"
        >
          Gagal memuat daftar anggota.
        </td>
      </tr>
    `;
  }
}

/* =========================================================
   UBAH STATUS ANGGOTA
   AKTIF -> KELUAR
   KELUAR -> AKTIF
========================================================= */

async function updateEkstrakurikulerMemberStatus(memberId, status) {
  const actionText =
    status === "keluar"
      ? "Anggota akan ditandai sebagai keluar, bukan dihapus."
      : "Anggota akan diaktifkan kembali.";

  const confirmed = await confirmAction(
    actionText,
    status === "keluar" ? "Keluarkan anggota?" : "Aktifkan kembali anggota?",
  );

  if (!confirmed) return;

  try {
    const res = await fetch(
      `/api/admin/extracurricular-members/${memberId}/status`,
      {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status,
        }),
      },
    );

    const json = await res.json().catch(() => ({}));

    if (!res.ok || !json.ok) {
      return errorAlert(json.error || "Gagal mengubah status anggota");
    }

    successAlert(
      status === "keluar"
        ? "Anggota telah ditandai sebagai keluar"
        : "Anggota berhasil diaktifkan kembali",
    );

    await loadEkstrakurikulerMembers(currentEkstrakurikulerDetailId);

    await loadEkstrakurikulerStats();
  } catch (err) {
    console.error("updateEkstrakurikulerMemberStatus:", err);

    errorAlert("Gagal mengubah status anggota");
  }
}

/* =========================================================
   BACK DETAIL
========================================================= */

document
  .getElementById("ekstrakurikulerDetailBack")
  ?.addEventListener("click", async () => {
    currentEkstrakurikulerDetailId = null;

    showAdminPage("ekstrakurikuler");

    await loadEkstrakurikuler();
    await loadEkstrakurikulerStats();
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
