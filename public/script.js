/* =========================================================
   DOM REFERENCES (FIX: semua element harus dideklarasikan)
========================================================= */
const view = document.getElementById("view");
const formView = document.getElementById("formView");
const detailView = document.getElementById("detailView");

const schedulesWrap = document.getElementById("schedulesWrap");
const scheduleTableWrap = document.getElementById("scheduleTableWrap");

const scheduleForm = document.getElementById("scheduleForm");
const scheduleName = document.getElementById("scheduleName");
const academic = document.getElementById("academic");
const daysPerWeek = document.getElementById("daysPerWeek");
const periodsPerDay = document.getElementById("periodsPerDay");
const periodDuration = document.getElementById("periodDuration");

const classesList = document.getElementById("classesList");
const subjectsList = document.getElementById("subjectsList");
const teachersList = document.getElementById("teachersList");

const classInput = document.getElementById("classInput");
const subjectName = document.getElementById("subjectName");
const subjectFreq = document.getElementById("subjectFreq");
const subjectClassSelect = document.getElementById("subjectClassSelect");

const teacherName = document.getElementById("teacherName");
const teacherMaxLoad = document.getElementById("teacherMaxLoad");
const teacherRole = document.getElementById("teacherRole");
const teacherClassSelect = document.getElementById("teacherClassSelect");
const teacherSubjectsSelect = document.getElementById("teacherSubjectsSelect");

const prefTeacherSelect = document.getElementById("prefTeacherSelect");
const prefPeriods = document.getElementById("prefPeriods");
const prefUnavailable = document.getElementById("prefUnavailable");
const prefPriority = document.getElementById("prefPriority");
const savePrefBtn = document.getElementById("savePrefBtn");
const preferencesList = document.getElementById("preferencesList");

const addClassBtn = document.getElementById("addClassBtn");
const addSubjectBtn = document.getElementById("addSubjectBtn");
const addTeacherBtn = document.getElementById("addTeacherBtn");
const saveDraftBtn = document.getElementById("saveDraft");

/* =========================================================
   SPA NAVIGATION
========================================================= */
function showView() {
  view.style.display = "block";
  formView.style.display = "none";
  detailView.style.display = "none";
  renderSchedules();
}

function showForm() {
  view.style.display = "none";
  formView.style.display = "block";
  detailView.style.display = "none";
  renderTeacherSubjectOptions();
  renderSubjectClassOptions();
}

function showDetail() {
  view.style.display = "none";
  formView.style.display = "none";
  detailView.style.display = "block";
}

document.getElementById("btn-view").onclick = showView;
document.getElementById("btn-add").onclick = showForm;
document.getElementById("add-btn-top").onclick = showForm;
document.getElementById("backBtn").onclick = showView;
document.getElementById("backToList").onclick = showView;

/* =========================================================
   STORAGE
========================================================= */
const STORAGE_KEY = "sd_schedules_v1";
const DRAFT_KEY = "sd_schedule_draft_v1";

function loadSchedules() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveSchedules(arr) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}

function saveDraftSchedule() {
  const draft = {
    name: scheduleName.value,
    academic: academic.value,
    daysPerWeek: Number(daysPerWeek.value),
    periodsPerDay: Number(periodsPerDay.value),
    periodDuration: Number(periodDuration.value),
    classes: structuredClone(dataModel.classes),
    subjects: structuredClone(dataModel.subjects),
    teachers: structuredClone(dataModel.teachers),
    savedAt: Date.now(),
  };

  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  alert("Draft berhasil disimpan 💾");
}

saveDraftBtn.onclick = saveDraftSchedule;

savePrefBtn.onclick = () => {
  const teacherIdx = prefTeacherSelect.value;
  if (teacherIdx === "") return;

  const teacher = dataModel.teachers[teacherIdx];
  if (!teacher) return;

  const pref = {
    teacherName: teacher.name,
    periods: parsePeriods(prefPeriods.value),
    unavailable: parseUnavailable(prefUnavailable.value),
    priority: Number(prefPriority.value) || 0,
  };

  dataModel.preferences = dataModel.preferences.filter(
    (p) => p.teacherName !== teacher.name,
  );
  dataModel.preferences.push(pref);

  // reset input preferensi
  prefTeacherSelect.value = "";
  prefPeriods.value = "";
  prefUnavailable.value = "";
  prefPriority.value = "";

  renderPreferences();
};

/* =========================================================
   RENDER LIST JADWAL
========================================================= */
function renderSchedules() {
  const items = loadSchedules();
  schedulesWrap.innerHTML = "";

  if (!items.length) {
    schedulesWrap.innerHTML = `
      <div class="empty">
        Belum ada jadwal. Klik <b>Tambah Jadwal</b> untuk membuat baru.
      </div>`;
    return;
  }

  const list = document.createElement("div");
  list.className = "list";

  items.forEach((s, idx) => {
    const el = document.createElement("div");
    el.className = "schedule-item";
    el.innerHTML = `
      <div>
        <strong>${s.name}</strong>
        <div class="meta">
          ${s.academic} • ${s.classes.length} kelas • ${s.periodsPerDay} periode/hari
        </div>
      </div>
      <div class="controls">
        <button class="ghost" data-view="${idx}">Lihat</button>
        <button class="ghost" data-del="${idx}">Hapus</button>
      </div>
    `;
    list.appendChild(el);
  });

  schedulesWrap.appendChild(list);

  schedulesWrap.querySelectorAll("[data-view]").forEach((btn) => {
    btn.onclick = (e) => {
      const idx = Number(e.currentTarget.dataset.view);
      renderScheduleDetail(loadSchedules()[idx]);
    };
  });

  schedulesWrap.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = (e) => {
      const idx = Number(e.currentTarget.dataset.del);
      const arr = loadSchedules();
      arr.splice(idx, 1);
      saveSchedules(arr);
      renderSchedules();
    };
  });
}

/* =========================================================
   DETAIL VIEW
========================================================= */
const DAY_LABELS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BREAK_SESSION_INDEX = 3; // sesi ke-4 (0-based)
const BREAK_DURATION = 30; // menit

function formatHM(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function renderScheduleDetail(schedule) {
  showDetail();
  scheduleTableWrap.innerHTML = `
    <h2>${schedule.name}</h2>
    <p class="meta">${schedule.academic}</p>
  `;

  const { daysPerWeek, periodsPerDay, periodDuration } = schedule;
  const assignments = schedule.generated?.assignments || [];

  // compute start/end times per period
  // default school start time: 07:00 (change DAY_START_MINUTES to adjust)
  const DAY_START_MINUTES = 7 * 60;
  const startTimes = new Array(periodsPerDay);
  const endTimes = new Array(periodsPerDay);
  let cur = DAY_START_MINUTES;

  for (let p = 0; p < periodsPerDay; p++) {
    if (p === BREAK_SESSION_INDEX) {
      startTimes[p] = cur;
      cur += BREAK_DURATION; // break duration (minutes)
      endTimes[p] = cur;
      continue;
    }
    startTimes[p] = cur;
    cur += periodDuration;
    endTimes[p] = cur;
  }

  schedule.classes.forEach((cls, classIdx) => {
    let html = `<h3>Kelas ${cls.display}</h3>`;
    html += `<table class="schedule-table"><thead><tr><th>Sesi (Waktu)</th>`;
    html += DAY_LABELS.slice(0, daysPerWeek)
      .map((d) => `<th>${d}</th>`)
      .join("");
    html += `</tr></thead><tbody>`;

    for (let p = 0; p < periodsPerDay; p++) {
      const isBreak = p === BREAK_SESSION_INDEX;

      // show time range for this session
      const timeLabel = `${formatHM(startTimes[p])} - ${formatHM(endTimes[p])}`;

      html += `
      <tr>
        <td>
          <strong>Sesi ${p + 1}</strong><br><small>${timeLabel}</small>
          ${isBreak ? "<br><em>Istirahat</em>" : ""}
        </td>
    `;

      for (let d = 0; d < daysPerWeek; d++) {
        if (isBreak) {
          html += `<td class="break-cell">Istirahat</td>`;
          continue;
        }

        const slot = assignments.find(
          (a) => a.classIdx === classIdx && a.day === d && a.period === p,
        );

        html += `<td>${
          slot
            ? `<strong>${slot.subjectName}</strong><br><small>${slot.teacherName}</small>`
            : "-"
        }</td>`;
      }

      html += `</tr>`;
    }

    html += `</tbody></table>`;
    scheduleTableWrap.insertAdjacentHTML("beforeend", html);
  });
}

/* =========================================================
   FORM DATA MODEL
========================================================= */
const dataModel = { classes: [], subjects: [], teachers: [], preferences: [] };

/* =========================================================
   CHIP RENDERER
========================================================= */
function renderChips(container, arr) {
  container.innerHTML = "";
  arr.forEach((it, i) => {
    const d = document.createElement("div");
    d.className = "chip";
    d.innerHTML = `
      <span>${it.display}</span>
      <button class="ghost" data-i="${i}">x</button>
    `;
    container.appendChild(d);
  });

  container.querySelectorAll("[data-i]").forEach((btn) => {
    btn.onclick = (e) => {
      arr.splice(Number(e.currentTarget.dataset.i), 1);
      renderChips(container, arr);
    };
  });
}

/* =========================================================
   RENDER HELPERS
========================================================= */
function renderSubjectClassOptions() {
  subjectClassSelect.innerHTML = `<option value="__all">Semua Kelas</option>`;
  dataModel.classes.forEach((cls) => {
    const opt = document.createElement("option");
    opt.value = cls.name;
    opt.textContent = cls.display;
    subjectClassSelect.appendChild(opt);
  });
}

function renderSubjects() {
  subjectsList.innerHTML = "";

  dataModel.subjects.forEach((s, i) => {
    const classLabel =
      s.classTarget === "__all"
        ? "Semua Kelas"
        : dataModel.classes.find((c) => c.name === s.classTarget)?.display ||
          s.classTarget;

    const div = document.createElement("div");
    div.className = "chip";

    div.innerHTML = `
      <span>
        • ${s.name}
        | ${s.freq}x/minggu
        | ${classLabel}
      </span>
      <button class="ghost" data-i="${i}">x</button>
    `;

    subjectsList.appendChild(div);
  });

  subjectsList.querySelectorAll("[data-i]").forEach(
    (btn) =>
      (btn.onclick = (e) => {
        dataModel.subjects.splice(Number(e.target.dataset.i), 1);
        renderSubjects();
        renderTeacherSubjectOptions();
      }),
  );
}

function renderTeachers() {
  teachersList.innerHTML = "";

  dataModel.teachers.forEach((t, i) => {
    const div = document.createElement("div");
    div.className = "chip";

    div.innerHTML = `
  <span>
    • ${t.name}
    | ${t.role === "kelas" ? "Guru Kelas " + t.classId : "Guru Mapel"}
    | ${t.subjects.join(", ")}
    | max ${t.maxLoad} sesi/minggu
  </span>
  <button class="ghost" data-i="${i}">x</button>
`;

    teachersList.appendChild(div);
  });

  teachersList.querySelectorAll("[data-i]").forEach(
    (btn) =>
      (btn.onclick = (e) => {
        dataModel.teachers.splice(Number(e.target.dataset.i), 1);
        renderTeachers();
      }),
  );
}

function renderTeacherSubjectOptions() {
  teacherSubjectsSelect.innerHTML = "";
  if (!dataModel.subjects.length) {
    const opt = document.createElement("option");
    opt.textContent =
      "Belum ada mata pelajaran. Tambahkan mata pelajaran terlebih dahulu";
    opt.disabled = true;
    teacherSubjectsSelect.appendChild(opt);
    return;
  }

  dataModel.subjects.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.name;
    opt.textContent = s.name;
    teacherSubjectsSelect.appendChild(opt);
  });
}

function renderTeacherClassOptions() {
  teacherClassSelect.innerHTML = `<option value="">Pilih kelas...</option>`;
  dataModel.classes.forEach((cls) => {
    const opt = document.createElement("option");
    opt.value = cls.name;
    opt.textContent = cls.display;
    teacherClassSelect.appendChild(opt);
  });
}

function renderPrefTeacherSelect() {
  prefTeacherSelect.innerHTML = '<option value="">Pilih guru...</option>';
  dataModel.teachers.forEach((t, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = t.name;
    prefTeacherSelect.appendChild(opt);
  });
}

function renderPreferences() {
  preferencesList.innerHTML = "";

  dataModel.preferences.forEach((p, i) => {
    const div = document.createElement("div");
    div.className = "chip";

    div.innerHTML = `
      <span>
        • ${p.teacherName}
        | Prioritas: ${p.priority || "-"}
        | Prefer periode: ${p.periods.map((x) => x + 1).join(", ") || "-"}
        | Tidak tersedia: ${Object.keys(p.unavailable).length ? "Ada" : "-"}
      </span>
      <button class="ghost" data-i="${i}">x</button>
    `;

    preferencesList.appendChild(div);
  });

  preferencesList.querySelectorAll("[data-i]").forEach((btn) => {
    btn.onclick = (e) => {
      dataModel.preferences.splice(Number(e.target.dataset.i), 1);
      renderPreferences();
    };
  });
}

/* =========================================================
   PARSER
========================================================= */
function parsePeriods(str) {
  if (!str) return [];
  return str
    .split(",")
    .map((n) => Number(n.trim()) - 1)
    .filter((n) => n >= 0 && n !== BREAK_SESSION_INDEX);
}

function parseUnavailable(str) {
  const mapDay = {
    senin: 0,
    selasa: 1,
    rabu: 2,
    kamis: 3,
    jumat: 4,
    sabtu: 5,
  };

  const result = {};
  if (!str) return result;

  // Format input yang diharapkan: "Senin:1, Kamis:3" atau "senin:1"
  str.split(",").forEach((part) => {
    const [dayRaw, periodRaw] = (part || "")
      .split(":")
      .map((s) => (s || "").trim().toLowerCase());
    if (!dayRaw) return;
    if (!(dayRaw in mapDay)) return;

    const p = Number(periodRaw) - 1;
    // Abaikan nilai non-numerik, negatif, atau sesi istirahat
    if (isNaN(p) || p < 0 || p === BREAK_SESSION_INDEX) return;

    const d = mapDay[dayRaw];
    if (!result[d]) result[d] = [];
    // Hindari duplikat
    if (!result[d].includes(p)) result[d].push(p);
  });

  return result;
}

teacherRole.onchange = () => {
  if (teacherRole.value === "kelas") {
    teacherClassSelect.style.display = "block";
    teacherSubjectsSelect.multiple = true;
    renderTeacherClassOptions();
    // pastikan pengguna bisa memilih >1 mapel untuk guru kelas
  } else if (teacherRole.value === "mapel") {
    teacherClassSelect.style.display = "none";
    teacherSubjectsSelect.multiple = false; // hanya 1 mapel untuk guru mapel
    // reset pilihan yang tidak valid (jika ada)
    Array.from(teacherSubjectsSelect.options).forEach(
      (opt) => (opt.selected = false),
    );
  } else {
    // default safe state
    teacherClassSelect.style.display = "none";
    teacherSubjectsSelect.multiple = true;
  }
};

/* =========================================================
   ADD ITEM BUTTONS
========================================================= */
addClassBtn.onclick = () => {
  const v = classInput.value.trim();
  if (!v) return;
  dataModel.classes.push({ display: v, name: v });
  classInput.value = "";
  renderChips(classesList, dataModel.classes);
  renderTeacherClassOptions();
  renderSubjectClassOptions();
};

addSubjectBtn.onclick = () => {
  const name = subjectName.value.trim();
  const freq = Number(subjectFreq.value);
  const classTarget = subjectClassSelect.value;
  if (!name || !freq) return;

  dataModel.subjects.push({ name, freq, classTarget });
  subjectName.value = "";
  subjectFreq.value = "";
  subjectClassSelect.value = "__all";
  renderSubjects();
  renderTeacherSubjectOptions();
};

addTeacherBtn.onclick = () => {
  const name = teacherName.value.trim();
  const maxLoad = Number(teacherMaxLoad.value);
  const role = teacherRole.value;
  const subs = Array.from(teacherSubjectsSelect.selectedOptions).map(
    (o) => o.value,
  );
  const classId = teacherClassSelect.value;

  if (!role) {
    alert("Pilih peran guru (Guru Kelas / Guru Mapel)");
    return;
  }

  if (role === "kelas" && !classId) {
    alert("Guru kelas wajib memilih kelas");
    return;
  }

  if (!name || !role || !subs.length || !maxLoad) return;

  if (role === "mapel" && subs.length !== 1) {
    alert("Guru mapel hanya boleh mengampu 1 mata pelajaran");
    return;
  }

  if (role === "kelas" && !subs.length) {
    alert("Guru kelas minimal mengampu 1 mata pelajaran");
    return;
  }

  const subjectFreqMap = {};
  dataModel.subjects.forEach((s) => {
    subjectFreqMap[s.name] = s.freq;
  });

  // hitung total sesi yg mungkin diampu guru
  let maxAllowed = 0;

  dataModel.subjects.forEach((s) => {
    if (!subs.includes(s.name)) return;

    // guru kelas → hanya hitung mapel untuk kelasnya
    if (role === "kelas") {
      if (s.classTarget === "__all" || s.classTarget === classId) {
        maxAllowed += s.freq;
      }
    }

    // guru mapel → global
    if (role === "mapel") {
      maxAllowed += s.freq;
    }
  });

  if (maxLoad > maxAllowed) {
    alert(
      `Max sesi guru (${maxLoad}) melebihi total sesi mapel (${maxAllowed})`,
    );
    return;
  }

  dataModel.teachers.push({
    name,
    role,
    subjects: subs,
    classId: role === "kelas" ? classId : "__all",
    maxLoad,
  });

  teacherName.value = "";
  teacherMaxLoad.value = "";
  teacherRole.value = "";
  teacherClassSelect.style.display = "none";
  renderTeachers();
  renderPrefTeacherSelect();
};

/* =========================================================
   SUBMIT
========================================================= */
scheduleForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!dataModel.classes.length)
    return alert("Minimal 1 kelas harus ditambahkan");
  if (!dataModel.subjects.length) return alert("Minimal 1 mata pelajaran");
  if (!dataModel.teachers.length) return alert("Minimal 1 guru");

  const payload = {
    name: scheduleName.value,
    academic: academic.value,
    daysPerWeek: Number(daysPerWeek.value),
    periodsPerDay: Number(periodsPerDay.value),
    periodDuration: Number(periodDuration.value),
    classes: dataModel.classes,
    subjects: dataModel.subjects,
    teachers: dataModel.teachers,
    preferences: dataModel.preferences,
  };

  const res = await fetch("http://localhost:3000/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = await res.json();
  if (!json.ok) throw new Error("Generate gagal");

  const arr = loadSchedules();
  arr.push({ ...payload, generated: json.data, createdAt: Date.now() });
  saveSchedules(arr);

  alert("Generate sukses 🎉 | Fitness: " + json.data.fitness);
  showView();
});

/* =========================================================
   INIT
========================================================= */
showView();
renderTeachers();
renderPrefTeacherSelect();
renderPreferences();
