// src/services/scheduler.ts
import { ScheduleRequest } from "../models/schedule";
import { Chromosome, Gene, GAResult } from "../models/ga";

/* =============================
   PARAMETER GA
============================= */
const POPULATION_SIZE = 60;
const GENERATIONS = 300;
const MUTATION_RATE = 0.12;

/* =============================
   HELPERS
============================= */
function randInt(max: number) {
  return Math.floor(Math.random() * max);
}
function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function cloneChromosome(c: Chromosome): Chromosome {
  return {
    fitness: c.fitness,
    genes: c.genes.map((g) => ({ ...g })),
  };
}

/* =============================
   GA CONSTRAINT HELPERS
   - BREAK_SESSION_INDEXES harus konsisten dengan frontend
   - sesi ke-4 dan ke-8 (0-based: index 3 dan 7) WAJIB istirahat
============================= */
const BREAK_SESSION_INDEXES_DEFAULT = [3, 7];
const BREAK_DURATION = 30; // menit (dipakai frontend)

function getBreakIndexes(req: ScheduleRequest): number[] {
  return req.breakSessionIndexes && req.breakSessionIndexes.length
    ? req.breakSessionIndexes
    : BREAK_SESSION_INDEXES_DEFAULT;
}

function isBreakSession(period: number, breakIndexes: number[]): boolean {
  return breakIndexes.includes(period);
}

/**
 * Pecah frekuensi sesi/minggu menjadi blok-blok sesi berurutan sesuai aturan:
 * - maksimal 3 sesi berurutan per blok
 * - TIDAK PERNAH menyisakan blok berukuran 1 jika freq > 3
 *   (freq <= 3 boleh 1 blok utuh sebesar freq itu sendiri, termasuk freq=1)
 *
 * Implementasi lama (`Math.min(3, remaining)` berulang) bisa menghasilkan sisa 1
 * sesi ketika freq % 3 === 1 (mis. freq=4 -> [3,1], freq=7 -> [3,3,1]).
 * Versi ini menangani kasus tsb secara eksplisit -> freq=4 -> [2,2], freq=7 -> [3,2,2].
 */
function splitIntoChunks(freq: number): number[] {
  if (freq <= 0) return [];
  if (freq <= 3) return [freq];

  const chunks: number[] = [];
  let remaining = freq;
  while (remaining > 0) {
    if (remaining === 4) {
      chunks.push(2, 2);
      remaining = 0;
    } else if (remaining <= 3) {
      chunks.push(remaining);
      remaining = 0;
    } else if (remaining === 1) {
      // safety net — seharusnya tidak pernah tercapai karena kasus di atas,
      // tapi jaga-jaga: gabungkan ke blok sebelumnya alih-alih membiarkan blok tunggal.
      if (chunks.length && chunks[chunks.length - 1] < 3) {
        chunks[chunks.length - 1] += 1;
      } else {
        chunks.push(1);
      }
      remaining = 0;
    } else {
      chunks.push(3);
      remaining -= 3;
    }
  }
  return chunks;
}

/**
 * Hitung "peta kurikulum": untuk tiap kombinasi (kelas, mapel) yang seharusnya ada
 * di jadwal ini, berapa total sesi/minggu yang wajib dipenuhi (sub.freq).
 * Kombinasi yang tidak punya guru pengampu sama sekali (candidateTeachers kosong)
 * DIABAIKAN dari peta ini, karena target itu memang mustahil dipenuhi GA —
 * kalau tetap dimasukkan, GA akan selalu terkena penalti besar tanpa jalan keluar.
 */
export function buildExpectedSessionsMap(
  req: ScheduleRequest,
): Map<string, number> {
  const map = new Map<string, number>();
  req.classes.forEach((cls, classIdx) => {
    req.subjects.forEach((sub) => {
      if (sub.classTargets !== "__all" && !sub.classTargets.includes(cls.name))
        return;

      const candidateTeachers = req.teachers.filter(
        (t) =>
          t.subjects.includes(sub.name) &&
          (t.classId === "__all" || t.classId === cls.name),
      );
      if (!candidateTeachers.length) return;

      map.set(`${classIdx}|${sub.name}`, sub.freq);
    });
  });
  return map;
}

/**
 * Selisih multiset sederhana antara dua daftar angka (dipakai untuk membandingkan
 * pola blok/run aktual terhadap pola blok ideal dari splitIntoChunks).
 * Mengembalikan jumlah elemen yang "tidak match" di kedua sisi.
 */
function multisetDiff(actual: number[], ideal: number[]): number {
  const idealCopy = [...ideal];
  let diff = 0;
  actual.forEach((v) => {
    const idx = idealCopy.indexOf(v);
    if (idx >= 0) idealCopy.splice(idx, 1);
    else diff++;
  });
  diff += idealCopy.length;
  return diff;
}

/* =============================
   CREATE RANDOM CHROMOSOME
   - place each subject as blocks (chunks) of consecutive sessions
   - avoid assigning into sesi istirahat (BREAK_SESSION_INDEXES)
   - try to avoid teacher double-booking during initialization
============================= */
function createRandomChromosome(req: ScheduleRequest): Chromosome {
  const genes: Gene[] = [];
  const breakIndexes = getBreakIndexes(req);

  function classSlotOccupied(classIdx: number, day: number, period: number) {
    return genes.some(
      (g) => g.classIdx === classIdx && g.day === day && g.period === period,
    );
  }
  function teacherSlotOccupied(
    teacherName: string,
    day: number,
    period: number,
  ) {
    return genes.some(
      (g) =>
        g.teacherName === teacherName && g.day === day && g.period === period,
    );
  }

  req.classes.forEach((cls, classIdx) => {
    req.subjects.forEach((sub) => {
      if (sub.classTargets !== "__all" && !sub.classTargets.includes(cls.name))
        return;

      const chunks = splitIntoChunks(sub.freq);

      chunks.forEach((chunkLen) => {
        const candidateTeachers = req.teachers.filter(
          (t) =>
            t.subjects.includes(sub.name) &&
            (t.classId === "__all" || t.classId === cls.name),
        );

        if (!candidateTeachers.length) return;

        let placed = false;
        for (let attempt = 0; attempt < 80 && !placed; attempt++) {
          const day = randInt(req.daysPerWeek);
          const possibleStarts: number[] = [];
          for (let s = 0; s <= req.periodsPerDay - chunkLen; s++) {
            let ok = true;
            for (let off = 0; off < chunkLen; off++) {
              if (isBreakSession(s + off, breakIndexes)) {
                ok = false;
                break;
              }
            }
            if (!ok) continue;
            possibleStarts.push(s);
          }

          if (!possibleStarts.length) break;

          const start = rand(possibleStarts);

          let chosenTeacher: string | null = null;
          // acak urutan kandidat supaya guru co-teacher (mapel dg >1 guru)
          // punya kesempatan yang setara terpilih (berselang-seling), bukan selalu
          // guru pertama di daftar yang menang.
          const shuffledCandidates = [...candidateTeachers].sort(
            () => Math.random() - 0.5,
          );
          for (const t of shuffledCandidates) {
            let free = true;
            for (let off = 0; off < chunkLen; off++) {
              if (
                teacherSlotOccupied(t.name, day, start + off) ||
                classSlotOccupied(classIdx, day, start + off)
              ) {
                free = false;
                break;
              }
            }
            if (free) {
              chosenTeacher = t.name;
              break;
            }
          }

          if (!chosenTeacher) continue;

          for (let off = 0; off < chunkLen; off++) {
            genes.push({
              classIdx,
              subjectName: sub.name,
              teacherName: chosenTeacher,
              day,
              period: start + off,
            });
          }
          placed = true;
        }

        // fallback: kalau blok penuh gagal ditempatkan, coba sesi individual
        // (tetap menghindari sesi istirahat) supaya total sesi tetap mendekati freq
        if (!placed) {
          let remaining = chunkLen;
          let tries = 0;
          while (remaining > 0 && tries < 200) {
            tries++;
            const day = randInt(req.daysPerWeek);
            const p = randInt(req.periodsPerDay);
            if (isBreakSession(p, breakIndexes)) continue;
            const teachers = req.teachers.filter(
              (t) =>
                t.subjects.includes(sub.name) &&
                (t.classId === "__all" || t.classId === cls.name) &&
                !teacherSlotOccupied(t.name, day, p),
            );
            if (!teachers.length) continue;
            if (classSlotOccupied(classIdx, day, p)) continue;

            genes.push({
              classIdx,
              subjectName: sub.name,
              teacherName: rand(teachers).name,
              day,
              period: p,
            });
            remaining--;
          }
        }
      });
    });
  });

  return { genes, fitness: 0 };
}

/* =============================
   FITNESS
============================= */
function calculateFitness(
  chromo: Chromosome,
  req: ScheduleRequest,
  expectedMap: Map<string, number>,
): number {
  let penalty = 0;
  const breakIndexes = getBreakIndexes(req);

  const classSlotMap = new Map<string, Gene[]>();
  const teacherSlotMap = new Map<string, Gene[]>();
  const teacherLoad: Record<string, number> = {};

  function keyClass(cIdx: number, day: number, p: number) {
    return `${cIdx}-${day}-${p}`;
  }
  function keyTeacher(t: string, day: number, p: number) {
    return `${t}-${day}-${p}`;
  }

  chromo.genes.forEach((g) => {
    // HARD: sesi tidak boleh jatuh di sesi istirahat (ke-4 / ke-8)
    if (isBreakSession(g.period, breakIndexes)) {
      penalty += 3500;
    }

    const kc = keyClass(g.classIdx, g.day, g.period);
    const kt = keyTeacher(g.teacherName, g.day, g.period);

    if (!classSlotMap.has(kc)) classSlotMap.set(kc, []);
    classSlotMap.get(kc)!.push(g);

    if (!teacherSlotMap.has(kt)) teacherSlotMap.set(kt, []);
    teacherSlotMap.get(kt)!.push(g);

    teacherLoad[g.teacherName] = (teacherLoad[g.teacherName] || 0) + 1;
  });

  // ==========================================================
  // HARD: kelas tidak boleh double-booking di slot yang sama —
  // KECUALI mapel-mapel yang ditandai `parallelGroup` sama (mis. Pendidikan
  // Agama Islam & Pendidikan Agama Kristen), karena di praktiknya mapel itu
  // memang berjalan BERSAMAAN (siswa dipisah kelompok/ruang, guru berbeda).
  // ==========================================================
  const subjectParallelGroup = new Map<string, string | undefined>();
  req.subjects.forEach((s) =>
    subjectParallelGroup.set(s.name, s.parallelGroup),
  );

  classSlotMap.forEach((arr) => {
    if (arr.length <= 1) return;
    // kelompokkan gen di slot ini: gen dengan parallelGroup yang sama dianggap
    // SATU "penghuni slot" (boleh bertumpuk), gen tanpa parallelGroup tetap
    // dihitung sendiri-sendiri (perilaku lama, tetap konflik).
    const buckets = new Map<string, Gene[]>();
    arr.forEach((g, idx) => {
      const pg = subjectParallelGroup.get(g.subjectName);
      const key = pg ? `PG:${pg}` : `SINGLE:${idx}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(g);
    });
    let occupants = buckets.size;
    // tapi kalau dalam satu grup paralel ada mapel yang SAMA berulang di slot
    // yang sama, itu tetap bukan overlap yang sah -> tetap dihitung konflik.
    buckets.forEach((genesInBucket) => {
      const seen = new Set<string>();
      genesInBucket.forEach((g) => {
        if (seen.has(g.subjectName)) occupants++;
        seen.add(g.subjectName);
      });
    });
    if (occupants > 1) penalty += 3000 * (occupants - 1);
  });

  // HARD: guru tidak boleh double-booking di slot yang sama (lintas kelas manapun)
  teacherSlotMap.forEach((arr) => {
    if (arr.length > 1) penalty += 3000 * (arr.length - 1);
  });

  // ==========================================================
  // HARD: kelengkapan kurikulum — total sesi per (kelas, mapel)
  // harus PERSIS sama dengan target freq yang dikonfigurasi.
  // Ini prioritas tertinggi karena kalau dilanggar, jadwal kehilangan
  // sebagian mata pelajaran suatu kelas walau "kelihatan" valid slot-nya.
  // ==========================================================
  const actualByClassSubject = new Map<string, number>();
  chromo.genes.forEach((g) => {
    const key = `${g.classIdx}|${g.subjectName}`;
    actualByClassSubject.set(key, (actualByClassSubject.get(key) || 0) + 1);
  });

  expectedMap.forEach((expectedFreq, key) => {
    const actual = actualByClassSubject.get(key) || 0;
    const diff = Math.abs(actual - expectedFreq);
    if (diff > 0) penalty += 4000 * diff;
  });
  // sesi "nyasar" — kombinasi kelas-mapel yang sebetulnya tidak seharusnya ada
  // sama sekali (mis. akibat crossover), misalnya mapel tidak ditargetkan ke kelas ini
  actualByClassSubject.forEach((count, key) => {
    if (!expectedMap.has(key)) penalty += 4000 * count;
  });

  // ==========================================================
  // HARD-ish: pola blok berurutan per (kelas, mapel) harus sesuai
  // splitIntoChunks(freq) — mis. freq=5 harus berupa blok {3,2}, bukan {2,2,1}
  // atau 5 sesi terpisah-pisah.
  // ==========================================================
  const byClassDay = new Map<string, Gene[]>();
  chromo.genes.forEach((g) => {
    const k = `${g.classIdx}-${g.day}`;
    if (!byClassDay.has(k)) byClassDay.set(k, []);
    byClassDay.get(k)!.push(g);
  });

  // kumpulkan semua run (blok berurutan) per (kelas, mapel) di seluruh minggu
  const runsByClassSubject = new Map<string, number[]>();
  byClassDay.forEach((arr) => {
    const grouped = arr.reduce<Record<string, number[]>>((acc, g) => {
      const k = `${g.classIdx}|${g.subjectName}`;
      if (!acc[k]) acc[k] = [];
      acc[k].push(g.period);
      return acc;
    }, {});

    Object.keys(grouped).forEach((key) => {
      const periods = grouped[key].sort((a, b) => a - b);
      let runLen = 1;
      for (let i = 1; i <= periods.length; i++) {
        const isConsecutive =
          i < periods.length && periods[i] === periods[i - 1] + 1;
        if (isConsecutive) {
          runLen++;
        } else {
          if (!runsByClassSubject.has(key)) runsByClassSubject.set(key, []);
          runsByClassSubject.get(key)!.push(runLen);
          runLen = 1;
        }
      }
    });
  });

  expectedMap.forEach((expectedFreq, key) => {
    const idealChunks = splitIntoChunks(expectedFreq);
    const actualRuns = runsByClassSubject.get(key) || [];

    // blok tunggal yang lebih dari 3 sesi berurutan -> jelas melanggar aturan
    actualRuns.forEach((len) => {
      if (len > 3) penalty += 2000 * (len - 3);
    });

    // bandingkan pola blok aktual vs ideal (mis. {3,2} vs {2,2,1})
    const diff = multisetDiff(actualRuns, idealChunks);
    if (diff > 0) penalty += 2200 * diff;
  });

  // Guru melebihi maxLoad (soft-medium — bukan salah satu dari 3 aturan wajib,
  // tapi tetap penting supaya beban guru realistis)
  req.teachers.forEach((t) => {
    const load = teacherLoad[t.name] || 0;
    if (load > t.maxLoad) penalty += 700 * (load - t.maxLoad);
  });

  // ==========================================================
  // SOFT: pemerataan guru co-teacher — kalau suatu mapel diampu >1 guru,
  // dorong supaya semua guru pengampu kebagian sesi (berselang-seling),
  // bukan selalu satu guru yang sama yang "menang" terus-menerus.
  // ==========================================================
  const teachersBySubject = new Map<string, Set<string>>();
  req.teachers.forEach((t) => {
    t.subjects.forEach((subName) => {
      if (!teachersBySubject.has(subName))
        teachersBySubject.set(subName, new Set());
      teachersBySubject.get(subName)!.add(t.name);
    });
  });

  teachersBySubject.forEach((teacherSet, subName) => {
    if (teacherSet.size < 2) return; // hanya relevan utk mapel dg >1 guru
    const loads: number[] = [];
    teacherSet.forEach((tName) => {
      const count = chromo.genes.filter(
        (g) => g.subjectName === subName && g.teacherName === tName,
      ).length;
      loads.push(count);
    });
    const total = loads.reduce((a, b) => a + b, 0);
    const anyZero = loads.some((l) => l === 0);
    if (anyZero && total > 0) penalty += 400;
  });

  // ==========================================================
  // SOFT/HARD-ish: preferensi guru — dibedakan berdasarkan tipe.
  // "tidak_tersedia" -> bobot besar (mendekati hard, guru benar2 tak bisa hadir)
  // "kurang_disukai" -> bobot kecil (soft, sekadar preferensi)
  // ==========================================================
  req.preferences.forEach((p) => {
    const teacherGenes = chromo.genes.filter(
      (g) => g.teacherName === p.teacherName,
    );
    p.slots.forEach((slot) => {
      teacherGenes.forEach((g) => {
        if (g.day === slot.day && slot.periods.includes(g.period)) {
          if (p.type === "tidak_tersedia") {
            penalty += 2500 + Number(p.priority || 0) * 50;
          } else {
            penalty += 120 + Number(p.priority || 0) * 20;
          }
        }
      });
    });
  });

  // ==========================================================
  // SOFT: dorong mapel dalam satu `parallelGroup` (mis. Agama Islam & Kristen)
  // benar-benar dijadwalkan di slot (hari+periode) yang SAMA per kelas, supaya
  // tidak boros slot (efisiensi jadwal) — di atas cuma "dibolehkan overlap",
  // bagian ini yang benar-benar mendorong GA mengarah ke sana.
  // ==========================================================
  const parallelGroups = new Set(
    req.subjects.map((s) => s.parallelGroup).filter((x): x is string => !!x),
  );
  parallelGroups.forEach((pg) => {
    const subjNamesInGroup = req.subjects
      .filter((s) => s.parallelGroup === pg)
      .map((s) => s.name);
    if (subjNamesInGroup.length < 2) return;

    req.classes.forEach((cls, classIdx) => {
      const slotsPerSubject = subjNamesInGroup.map((subName) => {
        const slots = new Set<string>();
        chromo.genes.forEach((g) => {
          if (g.classIdx === classIdx && g.subjectName === subName)
            slots.add(`${g.day}-${g.period}`);
        });
        return slots;
      });
      if (slotsPerSubject.every((s) => s.size === 0)) return;

      const unionSlots = new Set<string>();
      slotsPerSubject.forEach((s) => s.forEach((x) => unionSlots.add(x)));
      unionSlots.forEach((slot) => {
        const presentIn = slotsPerSubject.filter((s) => s.has(slot)).length;
        const missing = subjNamesInGroup.length - presentIn;
        if (missing > 0) penalty += missing * 150;
      });
    });
  });

  // ==========================================================
  // SOFT: batasi mapel "berat" (heavy=true, mis. Matematika, Bahasa Indonesia)
  // supaya tidak ada 2 mapel berat BERBEDA di hari yang sama untuk 1 kelas —
  // menghindari kelelahan kognitif siswa SD.
  // ==========================================================
  const heavySubjectNames = new Set(
    req.subjects.filter((s) => s.heavy).map((s) => s.name),
  );
  if (heavySubjectNames.size > 1) {
    const heavyByClassDay = new Map<string, Set<string>>();
    chromo.genes.forEach((g) => {
      if (!heavySubjectNames.has(g.subjectName)) return;
      const key = `${g.classIdx}-${g.day}`;
      if (!heavyByClassDay.has(key)) heavyByClassDay.set(key, new Set());
      heavyByClassDay.get(key)!.add(g.subjectName);
    });
    heavyByClassDay.forEach((set) => {
      if (set.size > 1) penalty += 300 * (set.size - 1);
    });
  }

  // ==========================================================
  // SOFT: mapel avoidLastPeriod (mis. PJOK) sebaiknya tidak di periode
  // terakhir hari itu (siswa pulang dalam kondisi berkeringat/kotor).
  // ==========================================================
  const avoidLastSet = new Set(
    req.subjects.filter((s) => s.avoidLastPeriod).map((s) => s.name),
  );
  if (avoidLastSet.size) {
    let lastPeriodIdx = req.periodsPerDay - 1;
    while (lastPeriodIdx >= 0 && breakIndexes.includes(lastPeriodIdx)) {
      lastPeriodIdx--;
    }
    chromo.genes.forEach((g) => {
      if (avoidLastSet.has(g.subjectName) && g.period === lastPeriodIdx) {
        penalty += 200;
      }
    });
  }

  // ==========================================================
  // SOFT: batas sesi per HARI untuk guru (opsional, per teacher.maxLoadPerDay)
  // — beban mingguan (maxLoad) sudah ada, ini tambahan supaya beban dalam
  // satu hari juga realistis untuk guru kelas SD.
  // ==========================================================
  req.teachers.forEach((t) => {
    if (!t.maxLoadPerDay) return;
    const perDay = new Map<number, number>();
    chromo.genes.forEach((g) => {
      if (g.teacherName !== t.name) return;
      perDay.set(g.day, (perDay.get(g.day) || 0) + 1);
    });
    perDay.forEach((count) => {
      if (count > t.maxLoadPerDay!) penalty += 250 * (count - t.maxLoadPerDay!);
    });
  });

  // ==========================================================
  // SOFT: sebisa mungkin sebar blok/chunk suatu (kelas, mapel) ke hari yang
  // berbeda-beda dalam seminggu (bukan keharusan mutlak), supaya jadwal
  // siswa SD tidak monoton mengulang mapel yang sama tiap hari.
  // ==========================================================
  const daysUsedByClassSubject = new Map<string, Set<number>>();
  chromo.genes.forEach((g) => {
    const key = `${g.classIdx}|${g.subjectName}`;
    if (!daysUsedByClassSubject.has(key))
      daysUsedByClassSubject.set(key, new Set());
    daysUsedByClassSubject.get(key)!.add(g.day);
  });
  expectedMap.forEach((expectedFreq, key) => {
    const idealChunks = splitIntoChunks(expectedFreq);
    const idealDistinctDays = Math.min(idealChunks.length, req.daysPerWeek);
    const actualDays = daysUsedByClassSubject.get(key)?.size || 0;
    if (actualDays < idealDistinctDays) {
      penalty += 150 * (idealDistinctDays - actualDays);
    }
  });

  const base = 1000000;
  const fitness = Math.max(1, base - penalty);
  return fitness;
}

/* =============================
   SELECTION (roulette wheel)
============================= */
function select(pop: Chromosome[]): Chromosome {
  const sum = pop.reduce((a, b) => a + b.fitness, 0);
  let r = Math.random() * sum;

  for (const c of pop) {
    r -= c.fitness;
    if (r <= 0) return c;
  }
  return pop[0];
}

/* =============================
   CROSSOVER (berbasis blok kelas+mapel)
   - Untuk tiap kombinasi (kelas, mapel), ambil SELURUH blok gen dari salah satu
     induk (A atau B) secara acak. Ini menjaga struktur blok tiap mapel tetap utuh
     (urutan sesi & guru dalam satu blok tidak tercampur/rusak), berbeda dari
     one-point crossover lama yang memotong array gen mentah tanpa memperhatikan
     batas blok — rawan menghasilkan kromosom yang kehilangan sebagian mapel
     suatu kelas atau gen yang tidak konsisten.
============================= */
function crossover(
  a: Chromosome,
  b: Chromosome,
  req: ScheduleRequest,
): Chromosome {
  const genes: Gene[] = [];

  req.classes.forEach((cls, classIdx) => {
    req.subjects.forEach((sub) => {
      if (sub.classTargets !== "__all" && !sub.classTargets.includes(cls.name))
        return;

      const source = Math.random() < 0.5 ? a : b;
      const blockGenes = source.genes.filter(
        (g) => g.classIdx === classIdx && g.subjectName === sub.name,
      );
      blockGenes.forEach((g) => genes.push({ ...g }));
    });
  });

  return { genes, fitness: 0 };
}

/* =============================
   MUTATION
============================= */
function mutate(c: Chromosome, req: ScheduleRequest) {
  if (!c.genes.length) return;
  const breakIndexes = getBreakIndexes(req);

  // (1) pindahkan satu blok (kelas+mapel) ke hari/periode lain
  if (Math.random() < MUTATION_RATE) {
    const pivot = c.genes[randInt(c.genes.length)];
    const block = c.genes.filter(
      (g) =>
        g.classIdx === pivot.classIdx && g.subjectName === pivot.subjectName,
    );
    const blockLen = block.length;

    for (let attempt = 0; attempt < 40; attempt++) {
      const day = randInt(req.daysPerWeek);
      const possibleStarts: number[] = [];
      for (let s = 0; s <= req.periodsPerDay - blockLen; s++) {
        let ok = true;
        for (let off = 0; off < blockLen; off++) {
          if (isBreakSession(s + off, breakIndexes)) {
            ok = false;
            break;
          }
        }
        if (ok) possibleStarts.push(s);
      }
      if (!possibleStarts.length) break;
      const start = rand(possibleStarts);

      const teacherName = pivot.teacherName;
      let canPlace = true;
      for (let off = 0; off < blockLen; off++) {
        const day2 = day;
        const period2 = start + off;
        if (
          c.genes.some(
            (g) =>
              g !== pivot &&
              g.day === day2 &&
              g.period === period2 &&
              g.classIdx === pivot.classIdx,
          )
        ) {
          canPlace = false;
          break;
        }
        if (
          c.genes.some(
            (g) =>
              g.teacherName === teacherName &&
              g.day === day2 &&
              g.period === period2 &&
              g.classIdx !== pivot.classIdx,
          )
        ) {
          canPlace = false;
          break;
        }
      }
      if (!canPlace) continue;

      let assigned = 0;
      c.genes.forEach((g) => {
        if (
          g.classIdx === pivot.classIdx &&
          g.subjectName === pivot.subjectName
        ) {
          g.day = day;
          g.period = start + assigned;
          assigned++;
        }
      });
      break;
    }
  }

  // (2) tukar guru antar dua gen acak dari mapel berbeda (kalau sama2 memenuhi syarat)
  if (Math.random() < MUTATION_RATE) {
    const i = randInt(c.genes.length);
    const j = randInt(c.genes.length);
    const g1 = c.genes[i];
    const g2 = c.genes[j];
    if (g1 && g2 && g1.subjectName !== g2.subjectName) {
      const t1Qualified = req.teachers.find(
        (t) => t.name === g1.teacherName && t.subjects.includes(g2.subjectName),
      );
      const t2Qualified = req.teachers.find(
        (t) => t.name === g2.teacherName && t.subjects.includes(g1.subjectName),
      );
      if (t1Qualified && t2Qualified) {
        const conflictAfterSwap =
          c.genes.some(
            (x, idx) =>
              idx !== i &&
              x.teacherName === g2.teacherName &&
              x.day === g1.day &&
              x.period === g1.period,
          ) ||
          c.genes.some(
            (x, idx) =>
              idx !== j &&
              x.teacherName === g1.teacherName &&
              x.day === g2.day &&
              x.period === g2.period,
          );
        if (!conflictAfterSwap) {
          const tmp = g1.teacherName;
          g1.teacherName = g2.teacherName;
          g2.teacherName = tmp;
        }
      }
    }
  }

  // (3) ganti guru satu blok (kelas+mapel) ke guru lain yang juga memenuhi syarat —
  //     terutama berguna untuk mapel dengan >1 guru pengampu (mis. PAI), supaya GA
  //     benar-benar mengeksplorasi variasi guru pengampu (berselang-seling), bukan
  //     terpaku pada guru yang kebetulan terpilih saat inisialisasi.
  if (Math.random() < MUTATION_RATE) {
    const pivot = c.genes[randInt(c.genes.length)];
    const block = c.genes.filter(
      (g) =>
        g.classIdx === pivot.classIdx && g.subjectName === pivot.subjectName,
    );
    const className = req.classes[pivot.classIdx]?.name;
    const candidateTeachers = req.teachers.filter(
      (t) =>
        t.subjects.includes(pivot.subjectName) &&
        (t.classId === "__all" || t.classId === className) &&
        t.name !== pivot.teacherName,
    );
    if (candidateTeachers.length) {
      const newTeacher = rand(candidateTeachers).name;
      const conflict = block.some((g) =>
        c.genes.some(
          (x) =>
            x !== g &&
            x.teacherName === newTeacher &&
            x.day === g.day &&
            x.period === g.period,
        ),
      );
      if (!conflict) {
        block.forEach((g) => (g.teacherName = newTeacher));
      }
    }
  }
}

/* =============================
   MAIN EXPORT
============================= */
export interface GAGenerationLog {
  generation: number;
  bestFitness: number;
}

export interface GAOptions {
  onGeneration?: (log: GAGenerationLog) => void;
}

export function generateScheduleGA(
  req: ScheduleRequest,
  options?: GAOptions,
): GAResult {
  const startTime = Date.now();

  const expectedMap = buildExpectedSessionsMap(req);

  let population: Chromosome[] = Array.from({ length: POPULATION_SIZE }, () =>
    createRandomChromosome(req),
  );

  let best = population[0];

  for (let gen = 0; gen < GENERATIONS; gen++) {
    population.forEach(
      (c) => (c.fitness = calculateFitness(c, req, expectedMap)),
    );

    population.sort((a, b) => b.fitness - a.fitness);
    if (population[0].fitness > best.fitness) {
      best = cloneChromosome(population[0]);
    }

    // >>> TAMBAHAN: catat fitness terbaik generasi ini
    options?.onGeneration?.({ generation: gen, bestFitness: best.fitness });

    const next: Chromosome[] = [cloneChromosome(best)];
    while (next.length < POPULATION_SIZE) {
      const p1 = select(population);
      const p2 = select(population);
      const child = crossover(p1, p2, req);
      mutate(child, req);
      next.push(child);
    }
    population = next;
  }

  best.fitness = calculateFitness(best, req, expectedMap);

  const durationMs = Date.now() - startTime;

  return {
    assignments: best.genes,
    fitness: best.fitness,
    generations: GENERATIONS,
    durationMs,
  };
}
export interface HardConstraintReport {
  breakSessionViolations: number; // sesi jatuh di jam istirahat
  classDoubleBooking: number; // kelas bentrok
  teacherDoubleBooking: number; // guru bentrok
  curriculumMismatch: number; // total sesi != freq target
  totalHardViolations: number;
}

export function evaluateHardConstraints(
  chromo: Chromosome,
  req: ScheduleRequest,
  expectedMap: Map<string, number>,
): HardConstraintReport {
  const breakIndexes = getBreakIndexes(req);
  let breakSessionViolations = 0;
  let classDoubleBooking = 0;
  let teacherDoubleBooking = 0;
  let curriculumMismatch = 0;

  const classSlotMap = new Map<string, Gene[]>();
  const teacherSlotMap = new Map<string, Gene[]>();

  chromo.genes.forEach((g) => {
    if (isBreakSession(g.period, breakIndexes)) breakSessionViolations++;

    const kc = `${g.classIdx}-${g.day}-${g.period}`;
    const kt = `${g.teacherName}-${g.day}-${g.period}`;
    if (!classSlotMap.has(kc)) classSlotMap.set(kc, []);
    classSlotMap.get(kc)!.push(g);
    if (!teacherSlotMap.has(kt)) teacherSlotMap.set(kt, []);
    teacherSlotMap.get(kt)!.push(g);
  });

  const subjectParallelGroup = new Map<string, string | undefined>();
  req.subjects.forEach((s) =>
    subjectParallelGroup.set(s.name, s.parallelGroup),
  );

  classSlotMap.forEach((arr) => {
    if (arr.length <= 1) return;
    const buckets = new Map<string, Gene[]>();
    arr.forEach((g, idx) => {
      const pg = subjectParallelGroup.get(g.subjectName);
      const key = pg ? `PG:${pg}` : `SINGLE:${idx}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(g);
    });
    let occupants = buckets.size;
    buckets.forEach((genesInBucket) => {
      const seen = new Set<string>();
      genesInBucket.forEach((g) => {
        if (seen.has(g.subjectName)) occupants++;
        seen.add(g.subjectName);
      });
    });
    if (occupants > 1) classDoubleBooking += occupants - 1;
  });

  teacherSlotMap.forEach((arr) => {
    if (arr.length > 1) teacherDoubleBooking += arr.length - 1;
  });

  const actualByClassSubject = new Map<string, number>();
  chromo.genes.forEach((g) => {
    const key = `${g.classIdx}|${g.subjectName}`;
    actualByClassSubject.set(key, (actualByClassSubject.get(key) || 0) + 1);
  });
  expectedMap.forEach((expectedFreq, key) => {
    const actual = actualByClassSubject.get(key) || 0;
    curriculumMismatch += Math.abs(actual - expectedFreq);
  });
  actualByClassSubject.forEach((count, key) => {
    if (!expectedMap.has(key)) curriculumMismatch += count;
  });

  return {
    breakSessionViolations,
    classDoubleBooking,
    teacherDoubleBooking,
    curriculumMismatch,
    totalHardViolations:
      breakSessionViolations +
      classDoubleBooking +
      teacherDoubleBooking +
      curriculumMismatch,
  };
}
