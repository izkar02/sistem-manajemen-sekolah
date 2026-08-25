// src/routes/studentSelf.ts
//
// Endpoint self-service untuk siswa yang sedang login:
//   - GET /api/siswa/profile           -> data profil siswa (utk Dashboard)
//   - GET /api/siswa/attendance/history -> riwayat absensi milik sendiri
//
// Keduanya memakai getCurrentStudent (services/currentStudent.ts), helper
// yang sama dipakai endpoint "/api/public/jadwal/mine" (lihat routes/adminData.ts).
// getCurrentStudent sudah menjamin: token valid, role === "siswa", dan data
// siswa diambil FRESH dari tabel students (bukan dari payload JWT) — jadi
// kalau admin mengubah data siswa (misal pindah kelas) setelah siswa login,
// data yang tampil di sini tetap akurat tanpa siswa harus login ulang.
import { Elysia } from "elysia";
import { db } from "../db";
import { getCurrentStudent } from "../services/currentStudent";

export const studentSelfRouter = new Elysia({ prefix: "/api/siswa" })

  // ==========================================================
  // PROFIL / DASHBOARD SISWA
  // ==========================================================
  // Data siswa yang login (nama, NIS, kelas, dll). Sengaja dibuat
  // "tipis" — cuma meneruskan apa yang sudah dikembalikan getCurrentStudent,
  // tanpa data tambahan, supaya konsisten persis dengan yang dipakai
  // endpoint riwayat absensi di bawah.
  .get("/profile", async ({ headers, set }) => {
    try {
      const current = await getCurrentStudent(headers);

      if (!current) {
        set.status = 401;

        return {
          error: "Unauthorized",
        };
      }

      return {
        ok: true,
        student: current.student,
      };
    } catch (err) {
      console.error(err);

      set.status = 500;

      return {
        error: "Internal Server Error",
      };
    }
  })

  // ==========================================================
  // RIWAYAT ABSENSI SISWA (MILIK SENDIRI)
  // ==========================================================
  // Query & shape response sengaja dibuat mirror dari endpoint guru
  // "GET /api/guru/attendance/student/:id/history" (routes/attendance.ts),
  // bedanya di sini student_id diambil dari sesi login (getCurrentStudent),
  // bukan dari :id URL — jadi siswa tidak bisa lihat riwayat siswa lain.
  //
  // Tidak difilter status ('draft' vs 'selesai') — sama seperti endpoint
  // guru yang jadi acuannya — supaya sesi yang baru saja diisi guru tetap
  // langsung terlihat oleh siswa walau belum di-finalisasi.
  .get("/attendance/history", async ({ headers, set }) => {
    try {
      const current = await getCurrentStudent(headers);

      if (!current) {
        set.status = 401;

        return {
          error: "Unauthorized",
        };
      }

      const studentId = current.student.id;

      const [rows]: any = await db.query(
        `SELECT
           ad.id,
           ad.status,
           ad.keterangan,
           DATE_FORMAT(s.tanggal, '%Y-%m-%d') AS tanggal,
           s.session_type,
           s.materi,
           sub.nama AS subject_name,
           t.nama AS teacher_name
         FROM attendance_details ad
         JOIN attendance_sessions s ON s.id = ad.session_id
         LEFT JOIN subjects sub ON sub.id = s.subject_id
         JOIN teachers t ON t.id = s.teacher_id
         WHERE ad.student_id = ?
         ORDER BY s.tanggal DESC`,
        [studentId],
      );

      return {
        ok: true,
        student: current.student,
        total_records: rows.length,
        history: rows,
      };
    } catch (err) {
      console.error(err);

      set.status = 500;

      return {
        error: "Internal Server Error",
      };
    }
  });
