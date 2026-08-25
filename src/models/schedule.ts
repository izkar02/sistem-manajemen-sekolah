// src/models/schedule.ts
export interface Class {
  id: number;
  name: string;
  display: string;
}

export interface Subject {
  kode: string;
  name: string;
  freq: number; // sesi per minggu
  classTargets: "__all" | string[]; // "__all" = semua kelas, atau daftar nama kelas spesifik

  // ============================================================
  // Field opsional tambahan (constraint khusus SD) — semuanya optional
  // supaya payload lama tanpa field ini tetap kompatibel (default aman).
  // ============================================================

  // Mapel dengan parallelGroup yang SAMA boleh dijadwalkan di slot (hari+periode)
  // yang SAMA untuk kelas yang sama, tanpa dianggap "kelas double-booking".
  // Contoh nyata: "Pendidikan Agama Islam" & "Pendidikan Agama Kristen" berjalan
  // bersamaan (siswa dipisah kelompok, guru berbeda, ruang berbeda).
  parallelGroup?: string;

  // Mapel "berat" secara kognitif (mis. Matematika, Bahasa Indonesia).
  // Dipakai untuk membatasi jumlah blok mapel berat per hari per kelas.
  heavy?: boolean;

  // Mapel yang sebaiknya TIDAK dijadwalkan di periode terakhir hari itu
  // (mis. PJOK, supaya siswa tidak pulang dalam kondisi berkeringat/kotor).
  avoidLastPeriod?: boolean;
}

export interface Teacher {
  id: number;
  name: string;
  role: "kelas" | "mapel";
  subjects: string[];
  classId: string; // "__all" | nama kelas
  maxLoad: number;

  // Batas maksimal sesi per HARI untuk guru ini (soft constraint tambahan).
  // Opsional — kalau tidak diisi, tidak ada batas harian (hanya batas mingguan/maxLoad).
  maxLoadPerDay?: number;
  maxLoadEdited: boolean;
}

export interface PreferenceSlot {
  day: number; // 0-based (0=Senin, dst)
  periods: number[]; // 0-based, periode yang berlaku untuk hari ini
}

export interface TeacherPreference {
  teacherName: string;
  // "tidak_tersedia" = guru benar-benar tidak bisa mengajar (mendekati hard constraint,
  // penalti tinggi). "kurang_disukai" = guru lebih suka menghindari, tapi masih bisa
  // dipaksakan kalau kondisi lain mengharuskan (soft constraint, penalti ringan).
  type: "tidak_tersedia" | "kurang_disukai";
  slots: PreferenceSlot[]; // satu guru bisa punya beberapa slot hari+periode berbeda
  priority: number; // 1-10, memperberat penalti sesuai seberapa penting preferensi ini
}

export interface ScheduleRequest {
  name: string;
  academic: string;
  daysPerWeek: number;
  periodsPerDay: number;
  periodDuration: number;
  classes: Class[];
  subjects: Subject[];
  teachers: Teacher[];
  preferences: TeacherPreference[];

  // index periode (0-based) yang merupakan sesi istirahat.
  // Opsional — kalau tidak dikirim, fallback ke default [3, 7] (sesi ke-4 & ke-8)
  // supaya kompatibel dengan payload lama.
  breakSessionIndexes?: number[];
}
