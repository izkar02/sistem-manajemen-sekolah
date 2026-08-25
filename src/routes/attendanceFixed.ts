//src/routes/attendance.ts
import { Elysia } from "elysia";
import { db } from "../db";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import { getCurrentTeacher } from "../services/currentTeacher";

// Berapa hari sesi absensi boleh diedit/dihapus & tetap berstatus draft
const ATTENDANCE_EDIT_WINDOW_DAYS = 3;

// Auto-finalize: sesi yang masih 'draft' tapi tanggalnya sudah lebih dari
// ATTENDANCE_EDIT_WINDOW_DAYS hari yang lalu otomatis dikunci jadi 'selesai'.
// Dipanggil lazy di endpoint-endpoint baca data (tidak ada cron job di sistem ini).
async function autoFinalizeExpiredDrafts() {
  await db.query(
    `
    UPDATE attendance_sessions
    SET status = 'selesai'
    WHERE status = 'draft'
      AND tanggal <= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    `,
    [ATTENDANCE_EDIT_WINDOW_DAYS],
  );
}

// Apakah sebuah sesi (berdasarkan tanggal) masih dalam jendela waktu edit/hapus
function isWithinEditWindow(tanggal: string | Date): boolean {
  const sessionDate = new Date(tanggal);
  const today = new Date();

  sessionDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  const diffDays = Math.round(
    (today.getTime() - sessionDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  return diffDays >= 0 && diffDays <= ATTENDANCE_EDIT_WINDOW_DAYS;
}

export const attendanceRouter = new Elysia({
  prefix: "/api/guru/attendance",
})

  // 1. API (identifikasi info akun guru: id, nama, tipe, dan kelas/mapel yg diampu)
  .get("/context", async ({ headers, set }) => {
    try {
      const current = await getCurrentTeacher(headers);

      if (!current) {
        set.status = 401;

        return {
          error: "Unauthorized",
        };
      }

      const teacher = current.teacher;

      // ========================
      // GURU KELAS
      // ========================

      if (teacher.teacher_type === "kelas") {
        const [rows] = await db.query(
          "SELECT id, nama, tingkat, section FROM classes WHERE wali_id = ? ORDER BY tingkat, section",
          [teacher.id],
        );

        return {
          teacher,
          classes: rows,
        };
      }

      // ========================
      // GURU MAPEL
      // ========================

      const [subjects] = await db.query(
        "SELECT s.id, s.kode, s.nama FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id WHERE ts.teacher_id = ? ORDER BY s.nama",
        [teacher.id],
      );

      return {
        teacher,
        subjects,
      };
    } catch (err) {
      console.error(err);

      set.status = 500;

      return {
        error: "Internal Server Error",
      };
    }
  })

  // 2. API tampilkan daftar siswa per kelas
  .get("/class/:id/students", async ({ params, headers, set }) => {
    try {
      const current = await getCurrentTeacher(headers);

      if (!current) {
        set.status = 401;

        return {
          error: "Unauthorized",
        };
      }

      const classId = Number(params.id);

      if (!classId) {
        set.status = 400;

        return {
          error: "Class ID tidak valid",
        };
      }

      const teacher = current.teacher;

      let allowed = false;

      // ======================
      // GURU KELAS
      // ======================

      if (teacher.teacher_type === "kelas") {
        const [rows] = await db.query(
          "SELECT id FROM classes WHERE id = ? AND wali_id = ? LIMIT 1",
          [classId, teacher.id],
        );

        allowed = (rows as any[]).length > 0;
      }

      // ======================
      // GURU MAPEL
      // ======================
      // Catatan: guru mapel mengajar di SEMUA kelas (bukan terikat 1 kelas
      // seperti wali kelas), jadi tidak divalidasi lewat schedule_details
      // (tabel jadwal otomatis yang saat ini masih kosong/belum stabil).
      // Akses kelas untuk guru mapel selalu diizinkan.

      if (teacher.teacher_type === "mapel") {
        allowed = true;
      }

      if (!allowed) {
        set.status = 403;

        return {
          error: "Anda tidak memiliki akses ke kelas ini",
        };
      }

      const [classRows] = await db.query(
        "SELECT id, nama, tingkat, section FROM classes WHERE id = ? LIMIT 1",
        [classId],
      );

      const kelas = (classRows as any[])[0];

      if (!kelas) {
        set.status = 404;

        return {
          error: "Kelas tidak ditemukan",
        };
      }

      const [studentRows] = await db.query(
        "SELECT id, nis, nama, jk FROM students WHERE kelas_id = ? ORDER BY nama ASC",
        [classId],
      );

      return {
        class: kelas,
        students: studentRows,
      };
    } catch (err) {
      console.error(err);

      set.status = 500;

      return {
        error: "Internal Server Error",
      };
    }
  })

  // 3. API membuat sesi absensi
  .post("/session", async ({ body, headers, set }) => {
    try {
      const current = await getCurrentTeacher(headers);

      if (!current) {
        set.status = 401;

        return {
          error: "Unauthorized",
        };
      }

      const teacher = current.teacher;

      const { class_id, subject_id, tanggal, materi } = body as {
        class_id?: number;
        subject_id?: number | null;
        tanggal?: string;
        materi?: string;
      };

      if (!class_id || !tanggal) {
        set.status = 400;

        return {
          error: "class_id dan tanggal wajib diisi",
        };
      }

      // ==================================
      // AMBIL SEMESTER AKTIF
      // ==================================

      const [periodRows]: any = await db.query(
        `
        SELECT id
        FROM academic_periods
        WHERE is_active = 1
        LIMIT 1
        `,
      );

      if (!periodRows.length) {
        set.status = 400;

        return {
          error: "Belum ada semester aktif",
        };
      }

      const academicPeriodId = periodRows[0].id;

      // ==================================
      // VALIDASI GURU KELAS
      // ==================================

      if (teacher.teacher_type === "kelas") {
        const [kelas]: any = await db.query(
          "SELECT id FROM classes WHERE id = ? AND wali_id = ? LIMIT 1",
          [class_id, teacher.id],
        );

        if (!kelas.length) {
          set.status = 403;

          return {
            error: "Anda bukan wali kelas ini",
          };
        }

        // hanya boleh 1 absensi per hari

        const [existing]: any = await db.query(
          "SELECT id FROM attendance_sessions WHERE class_id = ? AND tanggal = ? AND session_type = 'harian' LIMIT 1",
          [class_id, tanggal],
        );

        if (existing.length) {
          set.status = 409;

          return {
            error: "Absensi harian sudah dibuat untuk tanggal tersebut",
          };
        }

        const [result]: any = await db.query(
          "INSERT INTO attendance_sessions (class_id, teacher_id, subject_id, tanggal, materi, session_type, status, academic_period_id) VALUES (?, ?, ?, ?, ?, 'harian', 'draft', ?)",
          [
            class_id,
            teacher.id,
            subject_id,
            tanggal,
            materi ?? null,
            academicPeriodId,
          ],
        );

        return {
          success: true,
          session_id: result.insertId,
        };
      }

      // ==================================
      // VALIDASI GURU MAPEL
      // ==================================

      if (!subject_id) {
        set.status = 400;

        return {
          error: "subject_id wajib diisi untuk guru mapel",
        };
      }

      const [allowedSubject]: any = await db.query(
        "SELECT id FROM teacher_subjects WHERE teacher_id = ? AND subject_id = ? LIMIT 1",
        [teacher.id, subject_id],
      );

      if (!allowedSubject.length) {
        set.status = 403;

        return {
          error: "Mata pelajaran tidak sesuai dengan guru",
        };
      }

      // hanya boleh 1 sesi absensi per kelas per hari untuk guru mapel ini
      // (kelas lain tetap boleh dibuat sesi baru di hari yang sama)

      const [existingMapel]: any = await db.query(
        "SELECT id FROM attendance_sessions WHERE class_id = ? AND teacher_id = ? AND tanggal = ? AND session_type = 'mapel' LIMIT 1",
        [class_id, teacher.id, tanggal],
      );

      if (existingMapel.length) {
        set.status = 409;

        return {
          error: "Anda sudah membuat sesi absensi untuk kelas ini hari ini",
        };
      }

      const [result]: any = await db.query(
        "INSERT INTO attendance_sessions (class_id, teacher_id, subject_id, tanggal, materi, session_type, status, academic_period_id) VALUES (?, ?, ?, ?, ?, 'mapel', 'draft', ?)",
        [
          class_id,
          teacher.id,
          subject_id,
          tanggal,
          materi ?? null,
          academicPeriodId,
        ],
      );

      return {
        success: true,
        session_id: result.insertId,
      };
    } catch (err) {
      console.error(err);

      set.status = 500;

      return {
        error: "Internal Server Error",
      };
    }
  })

  // 4. API absen murid
  .post("/session/:id/details", async ({ params, body, headers, set }) => {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const current = await getCurrentTeacher(headers);

      if (!current) {
        set.status = 401;

        return {
          error: "Unauthorized",
        };
      }

      const teacher = current.teacher;

      const sessionId = Number(params.id);

      if (!sessionId) {
        set.status = 400;

        return {
          error: "Session tidak valid",
        };
      }

      const { details } = body as {
        details?: {
          student_id: number;
          status: "hadir" | "izin" | "sakit" | "alpha";
          keterangan?: string;
        }[];
      };

      if (!details || !Array.isArray(details) || !details.length) {
        set.status = 400;

        return {
          error: "Data absensi kosong",
        };
      }

      // ==========================
      // Ambil session
      // ==========================

      const [sessionRows]: any = await db.query(
        "SELECT * FROM attendance_sessions WHERE id = ? LIMIT 1",
        [sessionId],
      );

      if (!sessionRows.length) {
        set.status = 404;

        return {
          error: "Session tidak ditemukan",
        };
      }

      const session = sessionRows[0];

      // ==========================
      // Pastikan session milik guru
      // ==========================

      if (session.teacher_id !== teacher.id) {
        set.status = 403;

        return {
          error: "Bukan session milik anda",
        };
      }

      // ==========================
      // Tidak boleh submit dua kali (gunakan endpoint edit untuk ubah data)
      // ==========================

      if (session.status === "selesai") {
        set.status = 409;

        return {
          error:
            "Absensi untuk sesi ini sudah selesai/terkunci. Gunakan fitur edit jika masih dalam jendela waktu yang diizinkan",
        };
      }

      const [existingDetails]: any = await db.query(
        "SELECT id FROM attendance_details WHERE session_id = ? LIMIT 1",
        [sessionId],
      );

      if (existingDetails.length) {
        set.status = 409;

        return {
          error:
            "Absensi untuk sesi ini sudah pernah disimpan. Gunakan fitur edit untuk mengubah data",
        };
      }

      // ==========================
      // Ambil daftar siswa kelas
      // ==========================

      const [students]: any = await db.query(
        "SELECT id FROM students WHERE kelas_id = ?",
        [session.class_id],
      );

      const validStudentIds = new Set(students.map((s: any) => s.id));

      // ==========================
      // Validasi siswa
      // ==========================

      for (const item of details) {
        if (!validStudentIds.has(item.student_id)) {
          set.status = 400;

          return {
            error: `Siswa ${item.student_id} bukan anggota kelas`,
          };
        }
      }

      // ==========================
      // Insert attendance_details
      // ==========================

      for (const item of details) {
        await conn.query(
          "INSERT INTO attendance_details (session_id, student_id, status, keterangan) VALUES (?, ?, ?, ?)",
          [sessionId, item.student_id, item.status, item.keterangan ?? null],
        );
      }

      await conn.commit();
      return {
        success: true,
        saved: details.length,
      };
    } catch (err) {
      await conn.rollback();
      console.error(err);

      set.status = 500;

      return {
        error: "Internal Server Error",
      };
    } finally {
      conn.release();
    }
  })

  // 5. API lihat histori absen
  .get("/history", async ({ headers, query, set }) => {
    try {
      const current = await getCurrentTeacher(headers);

      if (!current) {
        set.status = 401;

        return {
          error: "Unauthorized",
        };
      }

      const teacher = current.teacher;

      await autoFinalizeExpiredDrafts();

      const classId = query.class_id ? Number(query.class_id) : null;

      const tanggal = query.tanggal ?? null;

      const periodId = query.period_id ? Number(query.period_id) : null;

      const activePeriod = query.active_period === "1";

      let sql = `
      SELECT
        a.id,
        a.tanggal,
        a.session_type,
        a.status,
        a.pertemuan_ke,
        a.materi,

        c.id AS class_id,
        c.nama AS class_name,

        s.id AS subject_id,
        s.nama AS subject_name,

        ap.id AS period_id,
        ap.nama AS period_name,
        ap.semester,
        
        (
          SELECT COUNT(*)
          FROM attendance_details d
          WHERE d.session_id = a.id
        ) AS total_siswa,

        (
          SELECT COUNT(*)
          FROM attendance_details d
          WHERE d.session_id = a.id
          AND d.status = 'hadir'
        ) AS hadir,

        (
          SELECT COUNT(*)
          FROM attendance_details d
          WHERE d.session_id = a.id
          AND d.status = 'izin'
        ) AS izin,

        (
          SELECT COUNT(*)
          FROM attendance_details d
          WHERE d.session_id = a.id
          AND d.status = 'sakit'
        ) AS sakit,

        (
          SELECT COUNT(*)
          FROM attendance_details d
          WHERE d.session_id = a.id
          AND d.status = 'alpha'
        ) AS alpha

      FROM attendance_sessions a

      JOIN classes c
        ON c.id = a.class_id

      LEFT JOIN academic_periods ap
        ON ap.id = a.academic_period_id

      LEFT JOIN subjects s
        ON s.id = a.subject_id

      WHERE a.teacher_id = ?
    `;

      const params: any[] = [teacher.id];

      if (classId) {
        sql += ` AND a.class_id = ? `;
        params.push(classId);
      }

      if (tanggal) {
        sql += ` AND a.tanggal = ? `;
        params.push(tanggal);
      }

      // ==================================
      // FILTER SEMESTER TERTENTU
      // ==================================

      if (periodId) {
        sql += ` AND a.academic_period_id = ? `;
        params.push(periodId);
      }

      // ==================================
      // FILTER SEMESTER AKTIF
      // ==================================

      if (activePeriod) {
        sql += `
    AND a.academic_period_id = (
      SELECT id
      FROM academic_periods
      WHERE is_active = 1
      LIMIT 1
    )
  `;
      }

      sql += `
      ORDER BY a.tanggal DESC,
               a.created_at DESC
    `;

      const [rows] = await db.query(sql, params);

      return {
        success: true,
        data: rows,
      };
    } catch (err) {
      console.error(err);

      set.status = 500;

      return {
        error: "Internal Server Error",
      };
    }
  })

  // 6. API rekap absensi per semester
  .get("/semester-summary", async ({ query, headers, set }) => {
    try {
      const current = await getCurrentTeacher(headers);

      if (!current) {
        set.status = 401;

        return {
          error: "Unauthorized",
        };
      }

      const teacher = current.teacher;

      await autoFinalizeExpiredDrafts();

      const classId = Number(query.class_id);

      if (!classId) {
        set.status = 400;

        return {
          error: "class_id wajib diisi",
        };
      }

      // ==========================
      // Validasi Hak Akses
      // ==========================

      if (teacher.teacher_type === "kelas") {
        const [rows]: any = await db.query(
          "SELECT id FROM classes WHERE id = ? AND wali_id = ? LIMIT 1",
          [classId, teacher.id],
        );

        if (!rows.length) {
          set.status = 403;

          return {
            error: "Bukan kelas wali Anda",
          };
        }
      }

      // ==========================
      // Rekap Semester
      // ==========================

      const [summary]: any = await db.query(
        `
      SELECT
        s.id,
        s.nis,
        s.nama,

        SUM(
          CASE
            WHEN ad.status = 'hadir'
            THEN 1
            ELSE 0
          END
        ) AS hadir,

        SUM(
          CASE
            WHEN ad.status = 'izin'
            THEN 1
            ELSE 0
          END
        ) AS izin,

        SUM(
          CASE
            WHEN ad.status = 'sakit'
            THEN 1
            ELSE 0
          END
        ) AS sakit,

        SUM(
          CASE
            WHEN ad.status = 'alpha'
            THEN 1
            ELSE 0
          END
        ) AS alpha

      FROM students s

      LEFT JOIN attendance_details ad
        ON ad.student_id = s.id

      LEFT JOIN attendance_sessions ats
        ON ats.id = ad.session_id
       AND ats.class_id = s.kelas_id

      WHERE s.kelas_id = ?

      GROUP BY
        s.id,
        s.nis,
        s.nama

      ORDER BY s.nama
      `,
        [classId],
      );

      return {
        class_id: classId,
        students: summary,
      };
    } catch (err) {
      console.error(err);

      set.status = 500;

      return {
        error: "Internal Server Error",
      };
    }
  })

  // 7. API lihat absensi per siswa
  .get("/student/:id/history", async ({ params, headers, query, set }) => {
    try {
      const current = await getCurrentTeacher(headers);

      if (!current) {
        set.status = 401;

        return {
          error: "Unauthorized",
        };
      }

      const studentId = Number(params.id);

      if (!studentId) {
        set.status = 400;

        return {
          error: "Student ID tidak valid",
        };
      }

      const teacher = current.teacher;

      await autoFinalizeExpiredDrafts();

      // ==========================
      // Ambil data siswa
      // ==========================

      const [studentRows]: any = await db.query(
        "SELECT s.id, s.nis, s.nama, s.kelas_id, c.nama AS kelas_nama, c.wali_id FROM students s JOIN classes c ON c.id = s.kelas_id WHERE s.id = ? LIMIT 1",
        [studentId],
      );

      if (!studentRows.length) {
        set.status = 404;

        return {
          error: "Siswa tidak ditemukan",
        };
      }

      const student = studentRows[0];

      // ==========================
      // Validasi akses guru kelas
      // ==========================

      if (teacher.teacher_type === "kelas" && student.wali_id !== teacher.id) {
        set.status = 403;

        return {
          error: "Bukan siswa kelas Anda",
        };
      }

      const semester = Number(query.semester || 1);

      // ==========================
      // Riwayat absensi
      // ==========================

      const [rows]: any = await db.query(
        "SELECT ad.id, ad.status, ad.keterangan, s.tanggal, s.session_type, s.materi, sub.nama AS subject_name, t.nama AS teacher_name FROM attendance_details ad JOIN attendance_sessions s ON s.id = ad.session_id LEFT JOIN subjects sub ON sub.id = s.subject_id JOIN teachers t ON t.id = s.teacher_id WHERE ad.student_id = ? ORDER BY s.tanggal ASC",
        [studentId],
      );

      return {
        student: {
          id: student.id,
          nis: student.nis,
          nama: student.nama,
          kelas_id: student.kelas_id,
          kelas_nama: student.kelas_nama,
        },

        semester,

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
  })

  // 8. API export absensi
  .get("/export/semester", async ({ query, headers, set }) => {
    try {
      const current = await getCurrentTeacher(headers);

      const semesterId = Number(query.academic_period_id);
      if (!semesterId) {
        set.status = 400;

        return {
          error: "academic_period_id wajib diisi",
        };
      }

      if (!current) {
        set.status = 401;

        return {
          error: "Unauthorized",
        };
      }

      const teacher = current.teacher;

      const classId = Number(query.class_id);

      if (!classId) {
        set.status = 400;

        return {
          error: "class_id wajib diisi",
        };
      }

      // ==========================
      // VALIDASI SEMESTER
      // ==========================

      const [periodRows]: any = await db.query(
        `
  SELECT
    id,
    nama,
    semester
  FROM academic_periods
  WHERE id = ?
  LIMIT 1
  `,
        [semesterId],
      );

      if (!periodRows.length) {
        set.status = 404;

        return {
          error: "Semester tidak ditemukan",
        };
      }

      const period = periodRows[0];

      // ==========================
      // Validasi guru kelas
      // ==========================

      if (teacher.teacher_type === "kelas") {
        const [classRows]: any = await db.query(
          `
        SELECT id
        FROM classes
        WHERE id = ?
          AND wali_id = ?
        LIMIT 1
        `,
          [classId, teacher.id],
        );

        if (!classRows.length) {
          set.status = 403;

          return {
            error: "Bukan kelas yang Anda ampu",
          };
        }
      }

      // ==========================
      // Data kelas
      // ==========================

      const [classRows]: any = await db.query(
        `
      SELECT
        id,
        nama,
        tingkat,
        section
      FROM classes
      WHERE id = ?
      LIMIT 1
      `,
        [classId],
      );

      if (!classRows.length) {
        set.status = 404;

        return {
          error: "Kelas tidak ditemukan",
        };
      }

      const kelas = classRows[0];

      // ==========================
      // Rekap per siswa
      // ==========================

      const [rows]: any = await db.query(
        `
  SELECT
    st.id,
    st.nis,
    st.nama,

    SUM(CASE WHEN ad.status='hadir' THEN 1 ELSE 0 END) AS hadir,
    SUM(CASE WHEN ad.status='sakit' THEN 1 ELSE 0 END) AS sakit,
    SUM(CASE WHEN ad.status='izin' THEN 1 ELSE 0 END) AS izin,
    SUM(CASE WHEN ad.status='alpha' THEN 1 ELSE 0 END) AS alpha,

    COUNT(ad.id) AS total

  FROM students st

  LEFT JOIN attendance_details ad
    ON ad.student_id = st.id

  LEFT JOIN attendance_sessions ats
    ON ats.id = ad.session_id

  WHERE st.kelas_id = ?
    AND ats.academic_period_id = ?
    AND ats.status = 'selesai'

  GROUP BY
    st.id,
    st.nis,
    st.nama

  ORDER BY st.nama
  `,
        [classId, semesterId],
      );

      return {
        kelas,
        total_siswa: rows.length,
        rekap: rows,
      };
    } catch (err) {
      console.error(err);

      set.status = 500;

      return {
        error: "Internal Server Error",
      };
    }
  })

  // 9. API export excel/xlsx
  .get("/export/semester/xlsx", async ({ query, headers, set }) => {
    try {
      const current = await getCurrentTeacher(headers);

      if (!current) {
        set.status = 401;

        return {
          error: "Unauthorized",
        };
      }

      const teacher = current.teacher;

      const classId = Number(query.class_id);
      const semesterId = Number(query.academic_period_id);

      if (!classId) {
        set.status = 400;

        return {
          error: "class_id wajib diisi",
        };
      }

      if (!semesterId) {
        set.status = 400;

        return {
          error: "academic_period_id wajib diisi",
        };
      }

      // ==========================
      // VALIDASI SEMESTER
      // ==========================

      const [periodRows]: any = await db.query(
        `
      SELECT *
      FROM academic_periods
      WHERE id = ?
      LIMIT 1
      `,
        [semesterId],
      );

      if (!periodRows.length) {
        set.status = 404;

        return {
          error: "Semester tidak ditemukan",
        };
      }

      const semester = periodRows[0];

      // ==========================
      // VALIDASI AKSES GURU KELAS
      // ==========================

      if (teacher.teacher_type === "kelas") {
        const [classRows]: any = await db.query(
          `
        SELECT id
        FROM classes
        WHERE id = ?
          AND wali_id = ?
        LIMIT 1
        `,
          [classId, teacher.id],
        );

        if (!classRows.length) {
          set.status = 403;

          return {
            error: "Bukan kelas yang Anda ampu",
          };
        }
      }

      // ==========================
      // DATA KELAS
      // ==========================

      const [classRows]: any = await db.query(
        `
      SELECT *
      FROM classes
      WHERE id = ?
      LIMIT 1
      `,
        [classId],
      );

      if (!classRows.length) {
        set.status = 404;

        return {
          error: "Kelas tidak ditemukan",
        };
      }

      const kelas = classRows[0];

      // ==========================
      // DATA SISWA
      // ==========================

      const [students]: any = await db.query(
        `
      SELECT
        id,
        nis,
        nama,
        jk,
        agama
      FROM students
      WHERE kelas_id = ?
      ORDER BY nama
      `,
        [classId],
      );

      // ==========================
      // DATA ABSENSI
      // Difilter berdasarkan teacher_id guru yang sedang login
      // supaya rekap guru kelas dan guru mapel tidak tercampur.
      // ==========================

      const [details]: any = await db.query(
        `
      SELECT
        ad.student_id,
        ats.tanggal,
        ad.status

      FROM attendance_details ad

      JOIN attendance_sessions ats
        ON ats.id = ad.session_id

      WHERE ats.class_id = ?
        AND ats.teacher_id = ?
        AND ats.academic_period_id = ?
        AND ats.status = 'selesai'
      `,
        [classId, teacher.id, semesterId],
      );

      const workbook = new ExcelJS.Workbook();

      workbook.creator = "Sistem Manajemen Sekolah";

      // ==========================
      // GROUP PER BULAN
      // ==========================

      const monthMap = new Map<string, any[]>();

      for (const row of details) {
        const date = new Date(row.tanggal);

        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

        if (!monthMap.has(key)) {
          monthMap.set(key, []);
        }

        monthMap.get(key)?.push(row);
      }

      // ==========================
      // SHEET PER BULAN
      // ==========================

      for (const [monthKey, records] of monthMap) {
        const [year, month] = monthKey.split("-").map(Number);

        const daysInMonth = new Date(year, month, 0).getDate();

        const sheet = workbook.addWorksheet(monthKey);

        // ==========================
        // JUDUL
        // ==========================

        sheet.mergeCells("A1:G1");

        sheet.getCell("A1").value = `Rekap Absensi ${kelas.nama} - ${monthKey}`;

        sheet.getCell("A1").font = {
          bold: true,
          size: 14,
        };

        // ==========================
        // HEADER BARIS 3
        // ==========================

        const header = ["Nama Siswa", "JK", "Agama"];

        for (let d = 1; d <= daysInMonth; d++) {
          header.push(String(d));
        }

        header.push("H");
        header.push("I");
        header.push("S");
        header.push("A");

        sheet.addRow([]);
        sheet.addRow(header);

        // ==========================
        // MAP ABSENSI
        // ==========================

        const attendanceMap = new Map();

        for (const item of records) {
          const date = new Date(item.tanggal);

          const key = `${item.student_id}-${date.toISOString().slice(0, 10)}`;

          attendanceMap.set(key, item.status);
        }

        // ==========================
        // DATA SISWA
        // ==========================

        for (const student of students) {
          const row: any[] = [student.nama, student.jk, student.agama ?? "-"];

          let hadir = 0;
          let izin = 0;
          let sakit = 0;
          let alpha = 0;

          for (let d = 1; d <= daysInMonth; d++) {
            const dateString = `${monthKey}-${String(d).padStart(2, "0")}`;

            const status = attendanceMap.get(`${student.id}-${dateString}`);

            let code = "";

            if (status === "hadir") {
              code = "H";
              hadir++;
            }

            if (status === "izin") {
              code = "I";
              izin++;
            }

            if (status === "sakit") {
              code = "S";
              sakit++;
            }

            if (status === "alpha") {
              code = "A";
              alpha++;
            }

            row.push(code);
          }

          row.push(hadir);
          row.push(izin);
          row.push(sakit);
          row.push(alpha);

          sheet.addRow(row);
        }

        // ==========================
        // AUTO WIDTH
        // ==========================

        sheet.columns.forEach((column) => {
          column.width = 12;
        });

        sheet.getColumn(1).width = 35;
        sheet.getColumn(2).width = 8;
        sheet.getColumn(3).width = 15;
      }

      // ==========================
      // SIMPAN FILE SEMENTARA
      // ==========================

      const exportDir = path.join(process.cwd(), "exports");

      fs.mkdirSync(exportDir, {
        recursive: true,
      });

      const fileName = `rekap_absensi_${kelas.nama}_semester_${semester.semester}.xlsx`;

      const filePath = path.join(exportDir, fileName);

      await workbook.xlsx.writeFile(filePath);

      set.headers["Content-Type"] =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

      set.headers["Content-Disposition"] = `attachment; filename="${fileName}"`;

      return Bun.file(filePath);
    } catch (err) {
      console.error(err);

      set.status = 500;

      return {
        error: "Internal Server Error",
      };
    }
  })

  // 10. API lihat sesi absensi
  .get("/session/:id", async ({ params, headers, set }) => {
    try {
      const current = await getCurrentTeacher(headers);

      if (!current) {
        set.status = 401;
        return {
          error: "Unauthorized",
        };
      }

      const sessionId = Number(params.id);

      await autoFinalizeExpiredDrafts();

      const [sessionRows]: any = await db.query(
        "SELECT a.*, c.nama AS class_name, s.nama AS subject_name FROM attendance_sessions a JOIN classes c ON c.id = a.class_id LEFT JOIN subjects s ON s.id = a.subject_id WHERE a.id = ? LIMIT 1",
        [sessionId],
      );

      if (!sessionRows.length) {
        set.status = 404;

        return {
          error: "Session tidak ditemukan",
        };
      }

      const session = sessionRows[0];

      const [details]: any = await db.query(
        "SELECT ad.id, ad.student_id, st.nis, st.nama, ad.status, ad.keterangan FROM attendance_details ad JOIN students st ON st.id = ad.student_id WHERE ad.session_id = ? ORDER BY st.nama",
        [sessionId],
      );

      return {
        session,
        students: details,
      };
    } catch (err) {
      console.error(err);

      set.status = 500;

      return {
        error: "Internal Server Error",
      };
    }
  })

  // 11. API edit/update absensi
  .put("/session/:id/details", async ({ params, body, headers, set }) => {
    try {
      const current = await getCurrentTeacher(headers);

      if (!current) {
        set.status = 401;

        return {
          error: "Unauthorized",
        };
      }

      const sessionId = Number(params.id);

      const { details } = body as {
        details: {
          student_id: number;
          status: string;
          keterangan?: string;
        }[];
      };

      if (!Array.isArray(details)) {
        set.status = 400;

        return {
          error: "details wajib array",
        };
      }

      // ========================
      // CEK SESSION
      // ========================

      const [sessionRows]: any = await db.query(
        "SELECT id, teacher_id, status, tanggal FROM attendance_sessions WHERE id = ? LIMIT 1",
        [sessionId],
      );

      if (!sessionRows.length) {
        set.status = 404;

        return {
          error: "Session tidak ditemukan",
        };
      }

      const session = sessionRows[0];

      // hanya pemilik session

      if (session.teacher_id !== current.teacher.id) {
        set.status = 403;

        return {
          error: "Bukan absensi milik anda",
        };
      }

      // ========================
      // CEK BATAS EDIT (maksimal 3 hari sejak tanggal sesi)
      // ========================

      if (!isWithinEditWindow(session.tanggal)) {
        set.status = 403;

        return {
          error: `Absensi hanya dapat diedit dalam ${ATTENDANCE_EDIT_WINDOW_DAYS} hari sejak tanggal sesi dibuat`,
        };
      }

      const allowedStatus = ["hadir", "izin", "sakit", "alpha"];

      for (const item of details) {
        if (!allowedStatus.includes(item.status)) {
          set.status = 400;

          return {
            error: `Status tidak valid: ${item.status}`,
          };
        }

        await db.query(
          "UPDATE attendance_details SET status = ?, keterangan = ? WHERE session_id = ? AND student_id = ?",
          [item.status, item.keterangan ?? null, sessionId, item.student_id],
        );
      }

      return {
        success: true,
        message: "Absensi berhasil diperbarui",
      };
    } catch (err) {
      console.error(err);

      set.status = 500;

      return {
        error: "Internal Server Error",
      };
    }
  })

  // 12. API edit status sesi absen
  .put("/session/:id/finish", async ({ params, headers, set }) => {
    try {
      const current = await getCurrentTeacher(headers);

      if (!current) {
        set.status = 401;

        return {
          error: "Unauthorized",
        };
      }

      const teacher = current.teacher;

      const sessionId = Number(params.id);

      // ========================
      // CEK SESSION
      // ========================

      const [sessionRows]: any = await db.query(
        "SELECT * FROM attendance_sessions WHERE id = ? LIMIT 1",
        [sessionId],
      );

      if (!sessionRows.length) {
        set.status = 404;

        return {
          error: "Session tidak ditemukan",
        };
      }

      const session = sessionRows[0];

      if (session.teacher_id !== teacher.id) {
        set.status = 403;

        return {
          error: "Bukan absensi milik anda",
        };
      }

      if (session.status === "selesai") {
        set.status = 400;

        return {
          error: "Absensi sudah selesai",
        };
      }

      // ========================
      // CEK JUMLAH SISWA
      // ========================

      const [studentRows]: any = await db.query(
        "SELECT COUNT(*) AS total FROM students WHERE kelas_id = ?",
        [session.class_id],
      );

      const totalStudents = studentRows[0].total;

      const [detailRows]: any = await db.query(
        "SELECT COUNT(*) AS total FROM attendance_details WHERE session_id = ?",
        [sessionId],
      );

      const totalAttendance = detailRows[0].total;

      if (totalAttendance < totalStudents) {
        set.status = 400;

        return {
          error: "Masih ada siswa yang belum diabsen",
          total_students: totalStudents,
          total_attendance: totalAttendance,
        };
      }

      // ========================
      // UPDATE STATUS
      // ========================

      await db.query(
        "UPDATE attendance_sessions SET status = 'selesai' WHERE id = ?",
        [sessionId],
      );

      return {
        success: true,
        message: "Absensi berhasil diselesaikan",
      };
    } catch (err) {
      console.error(err);

      set.status = 500;

      return {
        error: "Internal Server Error",
      };
    }
  })

  // 13. API hapus sesi absensi yang masih draft
  .delete("/session/:id", async ({ params, headers, set }) => {
    try {
      const current = await getCurrentTeacher(headers);

      if (!current) {
        set.status = 401;

        return {
          error: "Unauthorized",
        };
      }

      const teacher = current.teacher;

      const sessionId = Number(params.id);

      // ========================
      // CEK SESSION
      // ========================

      const [sessionRows]: any = await db.query(
        "SELECT * FROM attendance_sessions WHERE id = ? LIMIT 1",
        [sessionId],
      );

      if (!sessionRows.length) {
        set.status = 404;

        return {
          error: "Session tidak ditemukan",
        };
      }

      const session = sessionRows[0];

      // ========================
      // CEK KEPEMILIKAN
      // ========================

      if (session.teacher_id !== teacher.id) {
        set.status = 403;

        return {
          error: "Bukan absensi milik anda",
        };
      }

      // ========================
      // CEK STATUS
      // ========================

      if (!isWithinEditWindow(session.tanggal)) {
        set.status = 400;

        return {
          error: `Absensi hanya dapat dihapus dalam ${ATTENDANCE_EDIT_WINDOW_DAYS} hari sejak tanggal sesi dibuat`,
        };
      }

      // ========================
      // HAPUS
      // ========================

      await db.query("DELETE FROM attendance_sessions WHERE id = ?", [
        sessionId,
      ]);

      return {
        success: true,
        message: "Absensi berhasil dihapus",
      };
    } catch (err) {
      console.error(err);

      set.status = 500;

      return {
        error: "Internal Server Error",
      };
    }
  })

  // 14. API recap absensi/kehadiran siswa per kelas per semester
  .get("/class/:id/semester-recap", async ({ params, query, headers, set }) => {
    try {
      const current = await getCurrentTeacher(headers);

      if (!current) {
        set.status = 401;

        return {
          error: "Unauthorized",
        };
      }

      const teacher = current.teacher;

      await autoFinalizeExpiredDrafts();

      // ==================================
      // VALIDASI AKSES GURU KELAS
      // ==================================

      if (teacher.teacher_type === "kelas") {
        const [kelas]: any = await db.query(
          "SELECT id FROM classes WHERE id = ? AND wali_id = ? LIMIT 1",
          [params.id, teacher.id],
        );

        if (!kelas.length) {
          set.status = 403;

          return {
            error: "Anda tidak memiliki akses ke kelas ini",
          };
        }
      }

      const classId = Number(params.id);

      const semesterId = Number((query as any).academic_period_id);

      if (!semesterId) {
        set.status = 400;

        return {
          error: "academic_period_id wajib diisi",
        };
      }

      // ==================================
      // VALIDASI AKSES GURU MAPEL
      // ==================================

      if (teacher.teacher_type === "mapel") {
        const [kelas]: any = await db.query(
          "SELECT DISTINCT class_id FROM attendance_sessions WHERE class_id = ? AND teacher_id = ? LIMIT 1",
          [params.id, teacher.id],
        );

        if (!kelas.length) {
          set.status = 403;

          return {
            error: "Anda tidak memiliki akses ke kelas ini",
          };
        }
      }

      // ======================
      // DATA KELAS
      // ======================

      const [classRows]: any = await db.query(
        "SELECT id, nama, tingkat, section FROM classes WHERE id = ? LIMIT 1",
        [classId],
      );

      if (!classRows.length) {
        set.status = 404;

        return {
          error: "Kelas tidak ditemukan",
        };
      }

      // ======================
      // DATA SEMESTER
      // ======================

      const [periodRows]: any = await db.query(
        "SELECT * FROM academic_periods WHERE id = ? LIMIT 1",
        [semesterId],
      );

      if (!periodRows.length) {
        set.status = 404;

        return {
          error: "Semester tidak ditemukan",
        };
      }

      // ======================
      // SEMUA SESI ABSENSI
      // ======================
      // Difilter berdasarkan teacher_id guru yang login, supaya guru mapel
      // hanya melihat rekap mata pelajaran & kelas yang dia ampu sendiri,
      // tidak tercampur dengan sesi guru lain di kelas yang sama.

      const [sessions]: any = await db.query(
        "SELECT id, tanggal, session_type, subject_id FROM attendance_sessions WHERE class_id = ? AND teacher_id = ? AND academic_period_id = ? AND status = 'selesai' ORDER BY tanggal ASC",
        [classId, teacher.id, semesterId],
      );

      // ======================
      // SEMUA SISWA
      // ======================

      const [students]: any = await db.query(
        "SELECT id, nis, nama FROM students WHERE kelas_id = ? ORDER BY nama",
        [classId],
      );

      // ======================
      // DETAIL ABSENSI
      // ======================

      const [details]: any = await db.query(
        "SELECT ad.student_id, ad.session_id, ad.status FROM attendance_details ad JOIN attendance_sessions s ON s.id = ad.session_id WHERE s.class_id = ? AND s.teacher_id = ? AND s.academic_period_id = ? AND s.status = 'selesai'",
        [classId, teacher.id, semesterId],
      );

      const detailMap = new Map();

      for (const row of details) {
        detailMap.set(`${row.student_id}-${row.session_id}`, row.status);
      }

      const studentRows = students.map((student: any) => {
        const attendance: Record<string, string> = {};

        let hadir = 0;
        let izin = 0;
        let sakit = 0;
        let alpha = 0;

        for (const session of sessions) {
          const status = detailMap.get(`${student.id}-${session.id}`) ?? "-";

          attendance[session.id] = status;

          if (status === "hadir") hadir++;
          if (status === "izin") izin++;
          if (status === "sakit") sakit++;
          if (status === "alpha") alpha++;
        }

        return {
          id: student.id,
          nis: student.nis,
          nama: student.nama,
          attendance,
          summary: {
            hadir,
            izin,
            sakit,
            alpha,
          },
        };
      });

      return {
        class: classRows[0],
        semester: periodRows[0],
        total_sessions: sessions.length,
        sessions,
        students: studentRows,
      };
    } catch (err) {
      console.error(err);

      set.status = 500;

      return {
        error: "Internal Server Error",
      };
    }
  })

  // 15. API statistik absensi seluruh siswa
  .get("/statistics", async ({ headers, query, set }) => {
    try {
      const current = await getCurrentTeacher(headers);

      if (!current) {
        set.status = 401;

        return {
          error: "Unauthorized",
        };
      }

      const teacher = current.teacher;

      await autoFinalizeExpiredDrafts();

      const periodId = query.period_id ? Number(query.period_id) : null;

      // ======================
      // SEMESTER AKTIF
      // ======================

      let periodSql =
        "SELECT * FROM academic_periods WHERE is_active = 1 LIMIT 1";

      let periodParams: any[] = [];

      if (periodId) {
        periodSql = "SELECT * FROM academic_periods WHERE id = ? LIMIT 1";

        periodParams.push(periodId);
      }

      const [periodRows]: any = await db.query(periodSql, periodParams);

      if (!periodRows.length) {
        set.status = 404;

        return {
          error: "Semester aktif tidak ditemukan",
        };
      }

      const period = periodRows[0];

      // ======================
      // HARI INI
      // ======================

      const today = new Date().toISOString().slice(0, 10);

      const [todayRows]: any = await db.query(
        "SELECT COUNT(DISTINCT s.id) AS sessions, SUM(ad.status='hadir') AS hadir, SUM(ad.status='izin') AS izin, SUM(ad.status='sakit') AS sakit, SUM(ad.status='alpha') AS alpha FROM attendance_sessions s LEFT JOIN attendance_details ad ON ad.session_id = s.id WHERE s.teacher_id = ? AND s.tanggal = ? AND s.status = 'selesai'",
        [teacher.id, today],
      );

      // ======================
      // SEMESTER BERJALAN
      // ======================

      const [semesterRows]: any = await db.query(
        "SELECT COUNT(DISTINCT s.id) AS sessions, COUNT(ad.id) AS total_records, SUM(ad.status='hadir') AS hadir, SUM(ad.status='izin') AS izin, SUM(ad.status='sakit') AS sakit, SUM(ad.status='alpha') AS alpha FROM attendance_sessions s LEFT JOIN attendance_details ad ON ad.session_id = s.id WHERE s.teacher_id = ? AND s.academic_period_id = ? AND s.status = 'selesai'",
        [teacher.id, period.id],
      );

      return {
        semester: {
          id: period.id,
          nama: period.nama,
        },

        today: {
          sessions: Number(todayRows[0]?.sessions ?? 0),
          hadir: Number(todayRows[0]?.hadir ?? 0),
          izin: Number(todayRows[0]?.izin ?? 0),
          sakit: Number(todayRows[0]?.sakit ?? 0),
          alpha: Number(todayRows[0]?.alpha ?? 0),
        },

        semester_summary: {
          sessions: Number(semesterRows[0]?.sessions ?? 0),
          hadir: Number(semesterRows[0]?.hadir ?? 0),
          izin: Number(semesterRows[0]?.izin ?? 0),
          sakit: Number(semesterRows[0]?.sakit ?? 0),
          alpha: Number(semesterRows[0]?.alpha ?? 0),
        },

        total_records: Number(semesterRows[0]?.total_records ?? 0),
      };
    } catch (err) {
      console.error(err);

      set.status = 500;

      return {
        error: "Internal Server Error",
      };
    }
  });
