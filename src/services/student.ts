// src/services/student.ts
import { db } from "../db";

/**
 * Ambil data siswa berdasarkan user_id (fresh dari DB, bukan dari JWT).
 * Dipakai oleh getCurrentStudent agar kelas_id yang dipakai selalu
 * data terbaru — bukan nilai lama yang ikut ter-bake di dalam token
 * saat siswa login.
 */
export async function getStudentByUserId(userId: number) {
  const [rows] = await db.query(
    `
    SELECT
      s.id,
      s.nis,
      s.nama,
      s.jk,
      s.agama,
      s.kelas_id,
      s.hp_ortu,
      s.user_id,
      c.nama AS kelas_nama,
      c.tingkat,
      c.section
    FROM students s
    LEFT JOIN classes c ON c.id = s.kelas_id
    WHERE s.user_id = ?
    LIMIT 1
    `,
    [userId],
  );

  return (rows as any[])[0] ?? null;
}

/**
 * Fallback: cari siswa berdasarkan NIS = username akun.
 *
 * Beberapa akun siswa (biasanya hasil import massal lewat
 * `student_account_exports`) punya baris di `students` yang belum
 * di-set `user_id`-nya, walau akun `users` untuk siswa itu sudah ada
 * dan usernamenya = NIS siswa. `loginUser` (services/auth.ts) sudah
 * menangani kasus ini dengan fallback serupa saat menentukan kelas_id
 * di JWT — fungsi ini meniru pola yang sama supaya getCurrentStudent
 * (dan endpoint apa pun yang bergantung padanya: jadwal, riwayat
 * absensi, dashboard profil) tidak ikut gagal untuk akun-akun ini.
 */
export async function getStudentByNis(nis: string) {
  const [rows] = await db.query(
    `
    SELECT
      s.id,
      s.nis,
      s.nama,
      s.jk,
      s.agama,
      s.kelas_id,
      s.hp_ortu,
      s.user_id,
      c.nama AS kelas_nama,
      c.tingkat,
      c.section
    FROM students s
    LEFT JOIN classes c ON c.id = s.kelas_id
    WHERE s.nis = ?
    LIMIT 1
    `,
    [nis],
  );

  return (rows as any[])[0] ?? null;
}
