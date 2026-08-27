// src/routes/adminData.ts
import { Elysia } from "elysia";
import { db } from "../db";
import { verifyToken, createUser, findUserByUsername } from "../services/auth";
import { getCurrentStudent } from "../services/currentStudent";
import { getCurrentTeacher } from "../services/currentTeacher";
import { getStudentByUserId, getStudentByNis } from "../services/student";
import crypto from "crypto";
import bcrypt from "bcryptjs";

function getTokenFromHeaders(headers: any) {
  const cookie = (headers.cookie as string) ?? "";
  const m = cookie.match(/token=([^;]+)/);
  if (m) return m[1];
  if (headers.authorization)
    return (headers.authorization as string).replace("Bearer ", "");
  return null;
}

/**
 * Parse kolom `payload` (JSON) dari tabel `schedules` dengan aman.
 *
 * Catatan penting: driver mysql2 SECARA OTOMATIS meng-parse kolom
 * bertipe JSON menjadi objek JS (bukan string). Artinya `r.payload`
 * bisa datang dalam 2 bentuk tergantung driver/versi:
 *   - string JSON mentah -> perlu JSON.parse()
 *   - sudah berupa objek/array -> JSON.parse() akan THROW dan tidak
 *     boleh di-fallback ke null, karena datanya sebenarnya valid.
 *
 * Selalu gunakan helper ini (bukan JSON.parse manual) di setiap
 * endpoint yang membaca kolom `payload`, supaya perilakunya konsisten.
 */
function parseSchedulePayload(payload: any): any {
  if (!payload) return null;
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
  // sudah berupa objek/array (auto-parsed oleh mysql2) -> pakai langsung
  return payload;
}

/**
 * Ambil hanya SATU kelas (milik siswa yang login) dari payload jadwal,
 * lalu remap assignments-nya supaya cocok dengan array `classes` yang
 * sudah dipotong (classIdx lama -> 0).
 *
 * Tanpa ini, endpoint /jadwal/mine akan mengirim payload utuh berisi
 * SEMUA kelas dalam jadwal tsb ke siswa, walau siswa cuma boleh lihat
 * kelasnya sendiri.
 */
function filterSchedulePayloadForClass(parsed: any, classIndex: number): any {
  const originalClasses = Array.isArray(parsed.classes) ? parsed.classes : [];
  const myClass = originalClasses[classIndex];

  const remapAssignments = (assignments: any) =>
    Array.isArray(assignments)
      ? assignments
          .filter((a: any) => a && a.classIdx === classIndex)
          .map((a: any) => ({ ...a, classIdx: 0 }))
      : assignments;

  const out: any = {
    ...parsed,
    classes: myClass ? [myClass] : [],
  };

  if (parsed.assignments) {
    out.assignments = remapAssignments(parsed.assignments);
  }
  if (parsed.generated && Array.isArray(parsed.generated.assignments)) {
    out.generated = {
      ...parsed.generated,
      assignments: remapAssignments(parsed.generated.assignments),
    };
  }
  if (parsed.payload && Array.isArray(parsed.payload.classes)) {
    // jaga-jaga kalau ada struktur nested payload.payload (format lama)
    out.payload = {
      ...parsed.payload,
      classes: myClass ? [myClass] : [],
      assignments: parsed.payload.assignments
        ? remapAssignments(parsed.payload.assignments)
        : parsed.payload.assignments,
      generated:
        parsed.payload.generated &&
        Array.isArray(parsed.payload.generated.assignments)
          ? {
              ...parsed.payload.generated,
              assignments: remapAssignments(
                parsed.payload.generated.assignments,
              ),
            }
          : parsed.payload.generated,
    };
  }

  return out;
}

/**
 * Ubah nama siswa jadi username yang valid: huruf kecil, tanpa spasi/simbol,
 * tanpa tanda diakritik. Contoh: "Budi Santoso" -> "budisantoso"
 */
function slugifyNamaToUsername(nama: string): string {
  const slug = nama
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // buang tanda diakritik (é -> e, dll)
    .replace(/[^a-z0-9]/g, ""); // sisakan huruf & angka saja

  return slug || "siswa";
}

/**
 * Cari username unik berbasis nama siswa. Kalau sudah dipakai siswa lain,
 * tambahkan angka urut di belakangnya (mis. budisantoso, budisantoso2, ...).
 */
async function generateUniqueUsernameFromNama(nama: string): Promise<string> {
  const base = slugifyNamaToUsername(nama);
  let candidate = base;
  let suffix = 1;

  while (await findUserByUsername(candidate)) {
    suffix += 1;
    candidate = `${base}${suffix}`;
  }

  return candidate;
}

export const adminDataRouter = new Elysia({ prefix: "/api/admin" })

  /* =====================
   DASHBOARD
   ===================== */
  .get("/dashboard", async ({ headers, set }) => {
    try {
      const cookie = headers.cookie ?? "";
      const m = cookie.match(/token=([^;]+)/);
      const token = m ? m[1] : null;

      if (!token) {
        set.status = 401;
        return { error: "Unauthorized" };
      }

      const user = verifyToken(token);
      if (!user || !["admin", "kepala"].includes(user.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      // --- 1) Angka ringkasan (kartu statistik) -----------------------
      const [
        guruRows,
        siswaRows,
        kelasRows,
        staffRows,
        saranaRows,
        prasaranaRows,
        ekskulRows,
        ekskulPesertaRows,
        jadwalRows,
      ] = await Promise.all([
        db.query("SELECT COUNT(*) AS total FROM teachers"),
        db.query("SELECT COUNT(*) AS total FROM students"),
        db.query("SELECT COUNT(*) AS total FROM classes"),
        db.query("SELECT COUNT(*) AS total FROM staff"),
        db.query("SELECT COUNT(*) AS total FROM facilities"),
        db.query("SELECT COUNT(*) AS total FROM infrastructure"),
        db.query(
          `SELECT COUNT(*) AS total, SUM(status = 'aktif') AS aktif
           FROM extracurriculars`,
        ),
        db.query(
          `SELECT COUNT(*) AS total FROM extracurricular_members WHERE status = 'aktif'`,
        ),
        db.query("SELECT COUNT(*) AS total FROM schedules"),
      ]);

      const ekskulStat: any = (ekskulRows[0] as any)[0] || {};

      // --- 2) Insight actionable ---------------------------------------

      // a) Ekskul yang hampir penuh kapasitas (>= 80% dari max_members)
      const [ekskulHampirPenuhRows]: any = await db.query(
        `SELECT
          e.id,
          e.name,
          e.max_members,
          (
            SELECT COUNT(*)
            FROM extracurricular_members em
            WHERE em.extracurricular_id = e.id
              AND em.status = 'aktif'
          ) AS active_members
         FROM extracurriculars e
         WHERE e.status = 'aktif'
           AND e.max_members IS NOT NULL
           AND e.max_members > 0
         HAVING active_members >= (e.max_members * 0.8)
         ORDER BY (active_members / e.max_members) DESC`,
      );

      // b) Guru yang belum punya mapel (teacher_type = 'mapel') atau
      //    belum mengampu kelas (teacher_type = 'kelas', classes.wali_id)
      const [guruBelumLengkapRows]: any = await db.query(
        `SELECT t.id, t.nama, t.teacher_type
         FROM teachers t
         WHERE (
           t.teacher_type = 'mapel'
           AND NOT EXISTS (
             SELECT 1 FROM teacher_subjects ts WHERE ts.teacher_id = t.id
           )
         ) OR (
           t.teacher_type = 'kelas'
           AND NOT EXISTS (
             SELECT 1 FROM classes c WHERE c.wali_id = t.id
           )
         )
         ORDER BY t.nama`,
      );

      // c) Siswa yang belum punya user_id ter-link (rawan gejala fallback
      //    NIS di getCurrentStudent kalau username login-nya berubah)
      const [siswaBelumAkunCountRows]: any = await db.query(
        `SELECT COUNT(*) AS total FROM students WHERE user_id IS NULL`,
      );
      const [siswaBelumAkunSampleRows]: any = await db.query(
        `SELECT id, nis, nama
         FROM students
         WHERE user_id IS NULL
         ORDER BY nama
         LIMIT 10`,
      );

      return {
        guru: (guruRows[0] as any)[0].total,
        siswa: (siswaRows[0] as any)[0].total,
        kelas: (kelasRows[0] as any)[0].total,
        staff: (staffRows[0] as any)[0].total,
        sarana: (saranaRows[0] as any)[0].total,
        prasarana: (prasaranaRows[0] as any)[0].total,
        ekstrakurikuler: {
          total: Number(ekskulStat.total || 0),
          aktif: Number(ekskulStat.aktif || 0),
          total_peserta: Number((ekskulPesertaRows[0] as any)[0]?.total || 0),
        },
        jadwal_generated: (jadwalRows[0] as any)[0].total,
        insights: {
          ekskul_hampir_penuh: (ekskulHampirPenuhRows as any[]).map((r) => ({
            id: r.id,
            name: r.name,
            active_members: Number(r.active_members || 0),
            max_members: Number(r.max_members || 0),
          })),
          guru_belum_lengkap: (guruBelumLengkapRows as any[]).map((r) => ({
            id: r.id,
            nama: r.nama,
            teacher_type: r.teacher_type,
            issue:
              r.teacher_type === "mapel"
                ? "Belum ada mapel diampu"
                : "Belum mengampu kelas (wali kelas)",
          })),
          siswa_belum_akun: {
            count: Number((siswaBelumAkunCountRows as any[])[0]?.total || 0),
            sample: (siswaBelumAkunSampleRows as any[]).map((r) => ({
              id: r.id,
              nis: r.nis,
              nama: r.nama,
            })),
          },
        },
      };
    } catch (err: any) {
      console.error("GET /api/admin/dashboard error:", err);
      set.status = 500;
      return { error: err.message || "Gagal memuat data dashboard" };
    }
  })

  /* =====================
   TEACHERS (GURU)
   ===================== */

  /* list semua guru */
  .get("/guru", async ({ headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [rows] = await db.query("SELECT * FROM teachers ORDER BY nama");
      return { ok: true, data: rows };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* get guru by id */
  .get("/guru/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = params.id;
      const [rows] = await db.query(
        "SELECT * FROM teachers WHERE id = ? LIMIT 1",
        [id],
      );
      const r = (rows as any[])[0] ?? null;
      if (!r) {
        set.status = 404;
        return { error: "Not found" };
      }
      return { ok: true, data: r };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* list guru untuk keperluan penjadwalan otomatis (Tahap 2):
     - lengkap dengan mata pelajaran yang diampu (dari teacher_subjects)
     - lengkap dengan kelas yang diwalikan (dari classes.wali_id), untuk guru_type = 'kelas' */
  .get("/guru-jadwal", async ({ headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [teacherRows] = await db.query(
        "SELECT id, nama, teacher_type FROM teachers ORDER BY nama",
      );
      const teachers = teacherRows as any[];

      if (!teachers.length) {
        return { ok: true, data: [] };
      }

      const teacherIds = teachers.map((t) => t.id);

      // mata pelajaran yang diampu tiap guru
      const [subjectRows]: any = await db.query(
        `SELECT ts.teacher_id, s.nama AS subject_name
         FROM teacher_subjects ts
         JOIN subjects s ON ts.subject_id = s.id
         WHERE ts.teacher_id IN (?)`,
        [teacherIds],
      );

      // kelas yang diwalikan (jika guru_type = 'kelas')
      const [classRows]: any = await db.query(
        `SELECT id, nama, tingkat, section, wali_id
         FROM classes
         WHERE wali_id IN (?)`,
        [teacherIds],
      );

      const subjectsByTeacher = new Map<number, string[]>();
      (subjectRows as any[]).forEach((r) => {
        if (!subjectsByTeacher.has(r.teacher_id)) {
          subjectsByTeacher.set(r.teacher_id, []);
        }
        subjectsByTeacher.get(r.teacher_id)!.push(r.subject_name);
      });

      const classByTeacher = new Map<number, any>();
      (classRows as any[]).forEach((r) => {
        classByTeacher.set(r.wali_id, r);
      });

      const data = teachers.map((t) => {
        const cls = classByTeacher.get(t.id);
        const kelasNama = cls
          ? cls.nama ||
            (cls.tingkat && cls.section
              ? `${cls.tingkat}.${cls.section}`
              : null)
          : null;
        return {
          id: t.id,
          nama: t.nama,
          teacher_type: t.teacher_type,
          subjects: subjectsByTeacher.get(t.id) || [],
          kelas_id: cls ? cls.id : null,
          kelas_nama: kelasNama,
        };
      });

      return { ok: true, data };
    } catch (err: any) {
      console.error("GET /api/admin/guru-jadwal error:", err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* create guru */
  .post("/guru", async ({ body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const b = body as any;
      const {
        nama,
        nip,
        jk,
        agama,
        hp,
        email,
        username,
        password,
        teacher_type,
        keterangan,
      } = b;
      if (!nama || !username || !password) {
        set.status = 400;
        return {
          error: "Nama, username dan password wajib diisi",
        };
      }
      const [exists]: any = await db.query(
        "SELECT id FROM users WHERE username = ? LIMIT 1",
        [username],
      );

      if (exists.length) {
        set.status = 400;
        return {
          error: "Username sudah digunakan",
        };
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const [userRes]: any = await db.query(
        "INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, 'guru', ?)",
        [username, passwordHash, nama],
      );
      const userId = userRes.insertId;
      const [teacherRes]: any = await db.query(
        "INSERT INTO teachers (nama, nip, jk, agama, hp, email, teacher_type, keterangan, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          nama,
          nip || null,
          jk || "L",
          agama || null,
          hp || null,
          email || null,
          teacher_type || "mapel",
          keterangan || null,
          userId,
        ],
      );
      return {
        ok: true,
        id: teacherRes.insertId,
      };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* update guru */
  .put("/guru/:id", async ({ params, body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = params.id;
      const b = body as any;
      const {
        nama,
        nip,
        jk,
        agama,
        hp,
        email,
        username,
        password,
        teacher_type,
        keterangan,
      } = b;
      const [teacherRows]: any = await db.query(
        "SELECT user_id FROM teachers WHERE id = ?",
        [id],
      );
      if (!teacherRows.length) {
        set.status = 404;
        return {
          error: "Guru tidak ditemukan",
        };
      }
      const userId = teacherRows[0].user_id;
      await db.query(
        "UPDATE teachers SET nama=?, nip=?, jk=?, agama=?, hp=?, email=?, teacher_type=?, keterangan=? WHERE id=?",
        [
          nama,
          nip || null,
          jk || "L",
          agama || null,
          hp || null,
          email || null,
          teacher_type || "mapel",
          keterangan || null,
          id,
        ],
      );
      if (userId && username) {
        await db.query(
          "UPDATE users SET username=?, display_name=? WHERE id=?",
          [username, nama, userId],
        );
      }
      if (userId && password) {
        const passwordHash = await bcrypt.hash(password, 10);

        await db.query("UPDATE users SET password_hash=? WHERE id=?", [
          passwordHash,
          userId,
        ]);
      }
      return { ok: true };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* delete guru */
  .delete("/guru/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = params.id;
      await db.query("DELETE FROM teachers WHERE id = ?", [id]);
      return { ok: true };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* =====================
   TEACHER_SUBJECTS (mapel yang diampu seorang guru)
   - sebelumnya tidak ada endpoint sama sekali untuk mengelola tabel ini,
     sehingga guru kelas yang belum di-assign mapel via SQL manual akan
     hilang total dari daftar guru di halaman Penjadwalan (lihat filter di
     admin_main.js -> sched_populateTeachersFromDB).
   ===================== */

  /* daftar id mapel yang diampu satu guru */
  .get("/guru/:id/subjects", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = params.id;
      const [rows]: any = await db.query(
        "SELECT subject_id FROM teacher_subjects WHERE teacher_id = ?",
        [id],
      );
      return { ok: true, data: rows.map((r: any) => r.subject_id) };
    } catch (err: any) {
      console.error("GET /api/admin/guru/:id/subjects error:", err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* set ulang (sync) mapel yang diampu satu guru.
     body: { subject_ids: number[] } -> menimpa seluruh assignment lama */
  .put("/guru/:id/subjects", async ({ params, body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = Number(params.id);
      const b = body as any;
      const subjectIds: number[] = Array.isArray(b?.subject_ids)
        ? b.subject_ids.map((x: any) => Number(x)).filter((x: number) => !!x)
        : [];

      const [teacherRows]: any = await db.query(
        "SELECT id FROM teachers WHERE id = ?",
        [id],
      );
      if (!teacherRows.length) {
        set.status = 404;
        return { error: "Guru tidak ditemukan" };
      }

      await db.query("DELETE FROM teacher_subjects WHERE teacher_id = ?", [id]);

      if (subjectIds.length) {
        const values = subjectIds.map((sid) => [id, sid]);
        await db.query(
          "INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES ?",
          [values],
        );
      }

      return { ok: true, subject_ids: subjectIds };
    } catch (err: any) {
      console.error("PUT /api/admin/guru/:id/subjects error:", err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* =====================
   CLASSES (KELAS)
   ===================== */

  .get("/kelas", async ({ headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [rows] = await db.query(
        "SELECT c.id, c.nama, c.tingkat, c.section, c.wali_id, t.nama as wali_nama FROM classes c LEFT JOIN teachers t ON c.wali_id = t.id ORDER BY c.tingkat, c.section",
      );
      return { ok: true, data: rows };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .get("/kelas/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = params.id;
      const [rows] = await db.query(
        "SELECT c.*, t.nama as wali_nama FROM classes c LEFT JOIN teachers t ON c.wali_id = t.id WHERE c.id = ? LIMIT 1",
        [id],
      );
      const r = (rows as any[])[0] ?? null;
      if (!r) {
        set.status = 404;
        return { error: "Not found" };
      }
      return { ok: true, data: r };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .post("/kelas", async ({ body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const { tingkat, section, nama, wali_id } = body as any;

      let insertNama = nama ?? null;
      if ((tingkat || tingkat === 0) && section) {
        insertNama = `${tingkat}.${section}`;
      }

      const [res]: any = await db.query(
        "INSERT INTO classes (nama, tingkat, section, wali_id) VALUES (?, ?, ?, ?)",
        [insertNama, tingkat ?? null, section ?? null, wali_id ?? null],
      );

      return { ok: true, id: res.insertId };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .put("/kelas/:id", async ({ params, body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = params.id;
      const { tingkat, section, nama, wali_id } = body as any;
      let updateNama = nama ?? null;
      if ((tingkat || tingkat === 0) && section)
        updateNama = `${tingkat}.${section}`;

      await db.query(
        "UPDATE classes SET nama=?, tingkat=?, section=?, wali_id=? WHERE id=?",
        [updateNama, tingkat ?? null, section ?? null, wali_id ?? null, id],
      );
      return { ok: true };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .delete("/kelas/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = params.id;
      await db.query("DELETE FROM classes WHERE id=?", [id]);
      return { ok: true };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* =====================
   STAFF
   ===================== */

  /* list staff + search (nama, jabatan, status) */
  .get("/staff", async ({ headers, set, query }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const q = query as any;
      const conditions: string[] = [];
      const params: any[] = [];

      if (q?.nama) {
        conditions.push("nama_lengkap LIKE ?");
        params.push(`%${q.nama}%`);
      }
      if (q?.jabatan) {
        conditions.push("jabatan = ?");
        params.push(q.jabatan);
      }
      if (q?.status) {
        conditions.push("status = ?");
        params.push(q.status);
      }

      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const [rows] = await db.query(
        `SELECT * FROM staff ${where} ORDER BY nama_lengkap`,
        params,
      );
      return { ok: true, data: rows };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* daftar jabatan unik, dipakai untuk isi dropdown filter search */
  .get("/staff/jabatan", async ({ headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }
      const [rows] = await db.query(
        "SELECT DISTINCT jabatan FROM staff ORDER BY jabatan",
      );
      return { ok: true, data: (rows as any[]).map((r) => r.jabatan) };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* get staff by id (dipakai untuk edit & detail) */
  .get("/staff/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = params.id;
      const [rows] = await db.query(
        "SELECT * FROM staff WHERE id = ? LIMIT 1",
        [id],
      );
      const r = (rows as any[])[0] ?? null;
      if (!r) {
        set.status = 404;
        return { error: "Not found" };
      }
      return { ok: true, data: r };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* tambah staff baru */
  .post("/staff", async ({ body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const {
        nik,
        nama_lengkap,
        jenis_kelamin,
        agama,
        tempat_lahir,
        tanggal_lahir,
        alamat,
        no_hp,
        email,
        jabatan,
        status_kepegawaian,
        tanggal_mulai,
        status,
        keterangan,
      } = body as any;

      if (!nik || !nama_lengkap || !jenis_kelamin || !jabatan) {
        set.status = 400;
        return {
          error: "NIK, nama lengkap, jenis kelamin, dan jabatan wajib diisi",
        };
      }

      const [found] = await db.query(
        "SELECT id FROM staff WHERE nik = ? LIMIT 1",
        [nik],
      );
      if ((found as any[]).length) {
        set.status = 400;
        return { error: "NIK sudah terdaftar pada staff lain" };
      }

      const [res]: any = await db.query(
        `INSERT INTO staff
          (nik, nama_lengkap, jenis_kelamin, agama, tempat_lahir, tanggal_lahir,
           alamat, no_hp, email, jabatan, status_kepegawaian, tanggal_mulai, status, keterangan)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nik,
          nama_lengkap,
          jenis_kelamin,
          agama || null,
          tempat_lahir || null,
          tanggal_lahir || null,
          alamat || null,
          no_hp || null,
          email || null,
          jabatan,
          status_kepegawaian || null,
          tanggal_mulai || null,
          status || "aktif",
          keterangan || null,
        ],
      );

      return { ok: true, id: res.insertId };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* edit staff */
  .put("/staff/:id", async ({ params, body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = params.id;
      const {
        nik,
        nama_lengkap,
        jenis_kelamin,
        agama,
        tempat_lahir,
        tanggal_lahir,
        alamat,
        no_hp,
        email,
        jabatan,
        status_kepegawaian,
        tanggal_mulai,
        status,
        keterangan,
      } = body as any;

      if (!nik || !nama_lengkap || !jenis_kelamin || !jabatan) {
        set.status = 400;
        return {
          error: "NIK, nama lengkap, jenis kelamin, dan jabatan wajib diisi",
        };
      }

      const [found] = await db.query(
        "SELECT id FROM staff WHERE nik = ? AND id != ? LIMIT 1",
        [nik, id],
      );
      if ((found as any[]).length) {
        set.status = 400;
        return { error: "NIK sudah dipakai oleh staff lain" };
      }

      await db.query(
        `UPDATE staff SET
          nik=?, nama_lengkap=?, jenis_kelamin=?, agama=?, tempat_lahir=?, tanggal_lahir=?,
          alamat=?, no_hp=?, email=?, jabatan=?, status_kepegawaian=?, tanggal_mulai=?, status=?, keterangan=?
         WHERE id=?`,
        [
          nik,
          nama_lengkap,
          jenis_kelamin,
          agama || null,
          tempat_lahir || null,
          tanggal_lahir || null,
          alamat || null,
          no_hp || null,
          email || null,
          jabatan,
          status_kepegawaian || null,
          tanggal_mulai || null,
          status || "aktif",
          keterangan || null,
          id,
        ],
      );
      return { ok: true };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* hapus staff - hanya admin */
  .delete("/staff/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      // Hanya admin yang boleh menghapus
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = params.id;

      // Cek apakah staff ada
      const [found] = await db.query(
        "SELECT id FROM staff WHERE id = ? LIMIT 1",
        [id],
      );

      if (!(found as any[]).length) {
        set.status = 404;
        return { error: "Data staff tidak ditemukan" };
      }

      // Hapus staff
      await db.query("DELETE FROM staff WHERE id = ?", [id]);

      return {
        ok: true,
        message: "Data staff berhasil dihapus",
      };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* =====================
   STUDENTS (SISWA)
   ===================== */
  .get("/siswa", async ({ headers, set, query }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      // ambil query param kelas_id jika ada
      const kelasId = (query as any)?.kelas_id ?? null;

      if (kelasId) {
        const [rows] = await db.query(
          "SELECT s.*, c.nama as kelas_nama FROM students s LEFT JOIN classes c ON s.kelas_id = c.id WHERE s.kelas_id = ? ORDER BY s.nama",
          [kelasId],
        );
        return { ok: true, data: rows };
      } else {
        const [rows] = await db.query(
          "SELECT s.*, c.nama as kelas_nama FROM students s LEFT JOIN classes c ON s.kelas_id = c.id ORDER BY s.nama",
        );
        return { ok: true, data: rows };
      }
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .get("/siswa/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = params.id;
      const [rows] = await db.query(
        "SELECT s.*, c.nama as kelas_nama FROM students s LEFT JOIN classes c ON s.kelas_id = c.id WHERE s.id = ? LIMIT 1",
        [id],
      );
      const r = (rows as any[])[0] ?? null;
      if (!r) {
        set.status = 404;
        return { error: "Not found" };
      }
      return { ok: true, data: r };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .post("/siswa", async ({ body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const { nis, nama, jk, agama, kelas_id, hp_ortu } = body as any;

      if (!kelas_id) {
        set.status = 400;
        return { error: "Kelas wajib dipilih" };
      }

      // server-side: cek NIS unik

      // server-side: cek NIS unik
      const [found] = await db.query(
        "SELECT id FROM students WHERE nis = ? LIMIT 1",
        [nis],
      );
      const foundRows = (found as any[]) || [];
      if (foundRows.length) {
        set.status = 400;
        return { error: "NIS sudah terdaftar pada siswa lain" };
      }

      // insert siswa
      const [res]: any = await db.query(
        "INSERT INTO students (nis, nama, jk, agama, kelas_id, hp_ortu) VALUES (?, ?, ?, ?, ?, ?)",
        [
          nis,
          nama,
          jk || null,
          agama || null,
          kelas_id || null,
          hp_ortu || null,
        ],
      );

      const studentId = res.insertId;

      // --- buat akun user (username otomatis dari nama siswa) ---
      let plainPassword: string | null = null;
      let userId: number | null = null;
      let username: string | null = null;

      try {
        // NIS baru saja dipastikan unik di atas, jadi siswa ini pasti baru —
        // selalu buat akun baru (tidak ada cabang "akun sudah ada").
        username = await generateUniqueUsernameFromNama(nama);

        // generate password random (12 karakter hex)
        plainPassword = crypto.randomBytes(6).toString("hex"); // contoh: 'a3f4...'
        const newUser = await createUser(
          username,
          plainPassword,
          "siswa",
          nama,
        );
        userId = (newUser as any).id ?? null;

        // BUG FIX: sebelumnya user_id tidak pernah disimpan balik ke tabel
        // students, jadi login siswa tidak bisa menemukan data siswanya sendiri.
        if (userId) {
          await db.query("UPDATE students SET user_id = ? WHERE id = ?", [
            userId,
            studentId,
          ]);
        }

        // simpan ke export table (untuk CSV)
        await db.query(
          "INSERT INTO student_account_exports (student_id, user_id, nis, username, plain_password) VALUES (?, ?, ?, ?, ?)",
          [studentId, userId, nis, username, plainPassword],
        );
      } catch (errInner) {
        // catat error tapi jangan batalkan pembuatan siswa — admin tetap melihat siswa terbuat
        console.warn("Pembuatan akun siswa / export gagal:", errInner);
      }

      return { ok: true, id: studentId, username, plainPassword };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .put("/siswa/:id", async ({ params, body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = params.id;
      const { nis, nama, jk, agama, kelas_id, hp_ortu } = body as any;

      if (!kelas_id) {
        set.status = 400;
        return { error: "Kelas wajib dipilih" };
      }

      // server-side: cek NIS unik

      // server-side: cek NIS unik (kecuali untuk record ini sendiri)
      const [found] = await db.query(
        "SELECT id FROM students WHERE nis = ? AND id != ? LIMIT 1",
        [nis, id],
      );
      const foundRows = (found as any[]) || [];
      if (foundRows.length) {
        set.status = 400;
        return { error: "NIS sudah terpakai oleh siswa lain" };
      }

      await db.query(
        "UPDATE students SET nis=?, nama=?, jk=?, agama=?, kelas_id=?, hp_ortu=? WHERE id=?",
        [
          nis,
          nama,
          jk || null,
          agama || null,
          kelas_id || null,
          hp_ortu || null,
          id,
        ],
      );
      return { ok: true };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .delete("/siswa/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = params.id;
      await db.query("DELETE FROM students WHERE id=?", [id]);
      return { ok: true };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* =====================
     EXPORT CSV (akun siswa)
     ===================== */
  .get("/siswa/export", async ({ headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payloadUser: any = token ? verifyToken(token) : null;
      if (!payloadUser || payloadUser.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [rows] = await db.query(
        `SELECT e.nis, e.username, e.plain_password, s.nama as student_name, e.created_at
         FROM student_account_exports e
         LEFT JOIN students s ON e.student_id = s.id
         ORDER BY e.created_at DESC`,
      );

      // build CSV text
      let csv = "nis,username,password,nama,created_at\n";
      (rows as any[]).forEach((r) => {
        const nis = String(r.nis ?? "");
        const username = String(r.username ?? "");
        const pw = String(r.plain_password ?? "");
        const nama = String(r.student_name ?? "");
        const created = r.created_at ? String(r.created_at) : "";
        // escape double quotes by doubling
        const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
        csv += `${esc(nis)},${esc(username)},${esc(pw)},${esc(nama)},${esc(created)}\n`;
      });

      // Return CSV as JSON field 'csv' (frontend can accept 'text/csv' or JSON with csv)
      return { ok: true, csv };
    } catch (err: any) {
      console.error("GET /api/admin/siswa/export error:", err);
      set.status = 500;
      return { error: err.message ?? String(err) };
    }
  })

  /* =========================================================
     SARANA & PRASARANA
     Admin dan Kepala dapat mengakses API.
  ========================================================= */

  .get("/facilities", async ({ query, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const q: any = query || {};

      const where: string[] = [];
      const values: any[] = [];

      if (q.search) {
        where.push("(f.name LIKE ? OR f.code LIKE ?)");
        values.push(`%${q.search}%`, `%${q.search}%`);
      }

      if (q.category_id) {
        where.push("f.category_id = ?");
        values.push(Number(q.category_id));
      }

      if (q.condition_status) {
        where.push("f.condition_status = ?");
        values.push(q.condition_status);
      }

      if (q.status) {
        where.push("f.status = ?");
        values.push(q.status);
      }

      if (q.location) {
        where.push("f.location = ?");
        values.push(q.location);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const [rows] = await db.query(
        `SELECT
          f.*,
          fc.name AS category_name
         FROM facilities f
         LEFT JOIN facility_categories fc
           ON fc.id = f.category_id
         ${whereSql}
         ORDER BY f.id DESC`,
        values,
      );

      return {
        ok: true,
        data: rows,
      };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .get("/facilities/stats", async ({ headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [rows] = await db.query(
        `SELECT
          COUNT(*) AS total,
          SUM(condition_status = 'baik') AS baik,
          SUM(condition_status = 'rusak_ringan') AS rusak_ringan,
          SUM(condition_status = 'rusak_berat') AS rusak_berat
         FROM facilities`,
      );

      const stat: any = (rows as any[])[0] || {};

      return {
        ok: true,
        data: {
          total: Number(stat.total || 0),
          baik: Number(stat.baik || 0),
          rusak_ringan: Number(stat.rusak_ringan || 0),
          rusak_berat: Number(stat.rusak_berat || 0),
        },
      };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .get("/facilities/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [facilityRows] = await db.query(
        `SELECT
          f.*,
          fc.name AS category_name
         FROM facilities f
         LEFT JOIN facility_categories fc
           ON fc.id = f.category_id
         WHERE f.id = ?
         LIMIT 1`,
        [params.id],
      );

      const facility = (facilityRows as any[])[0];

      if (!facility) {
        set.status = 404;
        return { error: "Data sarana tidak ditemukan" };
      }

      const [maintenanceRows] = await db.query(
        `SELECT *
         FROM facility_maintenance
         WHERE facility_id = ?
         ORDER BY maintenance_date DESC, id DESC`,
        [params.id],
      );

      return {
        ok: true,
        data: facility,
        maintenance: maintenanceRows,
      };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .get("/facility-categories", async ({ headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [rows] = await db.query(
        `SELECT id, name, description
         FROM facility_categories
         ORDER BY name ASC`,
      );

      return {
        ok: true,
        data: rows,
      };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .get("/facilities/locations", async ({ headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [rows] = await db.query(
        `SELECT DISTINCT location
         FROM facilities
         WHERE location IS NOT NULL
           AND TRIM(location) <> ''
         ORDER BY location ASC`,
      );

      return {
        ok: true,
        data: (rows as any[]).map((r) => r.location),
      };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .post("/facilities", async ({ body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const b: any = body;

      if (!b.category_id || !b.code || !b.name) {
        set.status = 400;
        return {
          error: "Kategori, kode, dan nama sarana wajib diisi",
        };
      }

      const [categoryRows] = await db.query(
        "SELECT id FROM facility_categories WHERE id = ? LIMIT 1",
        [b.category_id],
      );

      if (!(categoryRows as any[]).length) {
        set.status = 400;
        return { error: "Kategori sarana tidak ditemukan" };
      }

      const [found] = await db.query(
        "SELECT id FROM facilities WHERE code = ? LIMIT 1",
        [b.code],
      );

      if ((found as any[]).length) {
        set.status = 400;
        return { error: "Kode sarana sudah digunakan" };
      }

      const [result]: any = await db.query(
        `INSERT INTO facilities (
          category_id,
          code,
          name,
          quantity,
          condition_status,
          location,
          procurement_date,
          funding_source,
          description,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Number(b.category_id),
          b.code.trim(),
          b.name.trim(),
          Number(b.quantity || 1),
          b.condition_status || "baik",
          b.location || null,
          b.procurement_date || null,
          b.funding_source || null,
          b.description || null,
          b.status || "aktif",
        ],
      );

      return {
        ok: true,
        id: result.insertId,
      };
    } catch (err: any) {
      console.error(err);

      if (err.code === "ER_DUP_ENTRY") {
        set.status = 400;
        return { error: "Kode sarana sudah digunakan" };
      }

      set.status = 500;
      return { error: err.message };
    }
  })

  .put("/facilities/:id", async ({ params, body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const b: any = body;

      if (!b.category_id || !b.code || !b.name) {
        set.status = 400;
        return {
          error: "Kategori, kode, dan nama sarana wajib diisi",
        };
      }

      const [found] = await db.query(
        `SELECT id
         FROM facilities
         WHERE code = ?
           AND id <> ?
         LIMIT 1`,
        [b.code, params.id],
      );

      if ((found as any[]).length) {
        set.status = 400;
        return { error: "Kode sarana sudah digunakan" };
      }

      const [result]: any = await db.query(
        `UPDATE facilities SET
          category_id = ?,
          code = ?,
          name = ?,
          quantity = ?,
          condition_status = ?,
          location = ?,
          procurement_date = ?,
          funding_source = ?,
          description = ?,
          status = ?
         WHERE id = ?`,
        [
          Number(b.category_id),
          b.code.trim(),
          b.name.trim(),
          Number(b.quantity || 1),
          b.condition_status || "baik",
          b.location || null,
          b.procurement_date || null,
          b.funding_source || null,
          b.description || null,
          b.status || "aktif",
          params.id,
        ],
      );

      if (!result.affectedRows) {
        set.status = 404;
        return { error: "Data sarana tidak ditemukan" };
      }

      return { ok: true };
    } catch (err: any) {
      console.error(err);

      if (err.code === "ER_DUP_ENTRY") {
        set.status = 400;
        return { error: "Kode sarana sudah digunakan" };
      }

      set.status = 500;
      return { error: err.message };
    }
  })

  .delete("/facilities/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      await db.query("DELETE FROM facility_maintenance WHERE facility_id = ?", [
        params.id,
      ]);

      const [result]: any = await db.query(
        "DELETE FROM facilities WHERE id = ?",
        [params.id],
      );

      if (!result.affectedRows) {
        set.status = 404;
        return { error: "Data sarana tidak ditemukan" };
      }

      return { ok: true };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* =====================
     PRASARANA
  ===================== */

  .get("/infrastructure/stats", async ({ headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [rows] = await db.query(
        `SELECT
          COUNT(*) AS total,
          SUM(condition_status = 'baik') AS baik,
          SUM(condition_status = 'rusak_ringan') AS rusak_ringan,
          SUM(condition_status = 'rusak_berat') AS rusak_berat
         FROM infrastructure`,
      );

      const stat: any = (rows as any[])[0] || {};

      return {
        ok: true,
        data: {
          total: Number(stat.total || 0),
          baik: Number(stat.baik || 0),
          rusak_ringan: Number(stat.rusak_ringan || 0),
          rusak_berat: Number(stat.rusak_berat || 0),
        },
      };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .get("/infrastructure/types", async ({ headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [rows] = await db.query(
        `SELECT DISTINCT type
         FROM infrastructure
         WHERE TRIM(type) <> ''
         ORDER BY type ASC`,
      );

      return {
        ok: true,
        data: (rows as any[]).map((r) => r.type),
      };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .get("/infrastructure", async ({ query, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const q: any = query || {};

      const where: string[] = [];
      const values: any[] = [];

      if (q.search) {
        where.push("(name LIKE ? OR code LIKE ?)");
        values.push(`%${q.search}%`, `%${q.search}%`);
      }

      if (q.type) {
        where.push("type = ?");
        values.push(q.type);
      }

      if (q.condition_status) {
        where.push("condition_status = ?");
        values.push(q.condition_status);
      }

      if (q.status) {
        where.push("status = ?");
        values.push(q.status);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const [rows] = await db.query(
        `SELECT *
         FROM infrastructure
         ${whereSql}
         ORDER BY id DESC`,
        values,
      );

      return {
        ok: true,
        data: rows,
      };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .get("/infrastructure/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [rows] = await db.query(
        "SELECT * FROM infrastructure WHERE id = ? LIMIT 1",
        [params.id],
      );

      const item = (rows as any[])[0];

      if (!item) {
        set.status = 404;
        return { error: "Data prasarana tidak ditemukan" };
      }

      return {
        ok: true,
        data: item,
      };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .post("/infrastructure", async ({ body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const b: any = body;

      if (!b.code || !b.name || !b.type) {
        set.status = 400;
        return {
          error: "Kode, nama, dan jenis prasarana wajib diisi",
        };
      }

      const [found] = await db.query(
        "SELECT id FROM infrastructure WHERE code = ? LIMIT 1",
        [b.code],
      );

      if ((found as any[]).length) {
        set.status = 400;
        return { error: "Kode prasarana sudah digunakan" };
      }

      const [result]: any = await db.query(
        `INSERT INTO infrastructure (
          code,
          name,
          type,
          capacity,
          area_size,
          location,
          condition_status,
          status,
          description
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          b.code.trim(),
          b.name.trim(),
          b.type.trim(),
          b.capacity ?? null,
          b.area_size ?? null,
          b.location || null,
          b.condition_status || "baik",
          b.status || "aktif",
          b.description || null,
        ],
      );

      return {
        ok: true,
        id: result.insertId,
      };
    } catch (err: any) {
      console.error(err);

      if (err.code === "ER_DUP_ENTRY") {
        set.status = 400;
        return { error: "Kode prasarana sudah digunakan" };
      }

      set.status = 500;
      return { error: err.message };
    }
  })

  .put("/infrastructure/:id", async ({ params, body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const b: any = body;

      if (!b.code || !b.name || !b.type) {
        set.status = 400;
        return {
          error: "Kode, nama, dan jenis prasarana wajib diisi",
        };
      }

      const [found] = await db.query(
        `SELECT id
         FROM infrastructure
         WHERE code = ?
           AND id <> ?
         LIMIT 1`,
        [b.code, params.id],
      );

      if ((found as any[]).length) {
        set.status = 400;
        return { error: "Kode prasarana sudah digunakan" };
      }

      const [result]: any = await db.query(
        `UPDATE infrastructure SET
          code = ?,
          name = ?,
          type = ?,
          capacity = ?,
          area_size = ?,
          location = ?,
          condition_status = ?,
          status = ?,
          description = ?
         WHERE id = ?`,
        [
          b.code.trim(),
          b.name.trim(),
          b.type.trim(),
          b.capacity ?? null,
          b.area_size ?? null,
          b.location || null,
          b.condition_status || "baik",
          b.status || "aktif",
          b.description || null,
          params.id,
        ],
      );

      if (!result.affectedRows) {
        set.status = 404;
        return { error: "Data prasarana tidak ditemukan" };
      }

      return { ok: true };
    } catch (err: any) {
      console.error(err);

      if (err.code === "ER_DUP_ENTRY") {
        set.status = 400;
        return { error: "Kode prasarana sudah digunakan" };
      }

      set.status = 500;
      return { error: err.message };
    }
  })

  .delete("/infrastructure/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [result]: any = await db.query(
        "DELETE FROM infrastructure WHERE id = ?",
        [params.id],
      );

      if (!result.affectedRows) {
        set.status = 404;
        return { error: "Data prasarana tidak ditemukan" };
      }

      return { ok: true };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* =====================================================
   FACILITY MAINTENANCE
   RIWAYAT PEMELIHARAAN SARANA
===================================================== */

  /* GET semua riwayat berdasarkan facility */
  .get("/facilities/:id/maintenance", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      // Admin dan Kepala boleh melihat
      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const facilityId = Number(params.id);

      if (!facilityId) {
        set.status = 400;
        return { error: "ID sarana tidak valid" };
      }

      const [facilityRows]: any = await db.query(
        "SELECT id FROM facilities WHERE id = ? LIMIT 1",
        [facilityId],
      );

      if (!facilityRows.length) {
        set.status = 404;
        return { error: "Sarana tidak ditemukan" };
      }

      const [rows]: any = await db.query(
        `
        SELECT
          id,
          facility_id,
          maintenance_date,
          issue_description,
          action_taken,
          cost,
          status,
          notes,
          created_at,
          updated_at
        FROM facility_maintenance
        WHERE facility_id = ?
        ORDER BY maintenance_date DESC, id DESC
      `,
        [facilityId],
      );

      return {
        ok: true,
        data: rows,
      };
    } catch (err: any) {
      console.error("GET facility maintenance error:", err);
      set.status = 500;
      return {
        error: err?.message || "Gagal memuat riwayat pemeliharaan",
      };
    }
  })

  /* GET satu riwayat pemeliharaan */
  .get("/facility-maintenance/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      // Admin dan Kepala boleh melihat
      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = Number(params.id);

      const [rows]: any = await db.query(
        `
        SELECT
          id,
          facility_id,
          maintenance_date,
          issue_description,
          action_taken,
          cost,
          status,
          notes,
          created_at,
          updated_at
        FROM facility_maintenance
        WHERE id = ?
        LIMIT 1
      `,
        [id],
      );

      if (!rows.length) {
        set.status = 404;
        return { error: "Riwayat pemeliharaan tidak ditemukan" };
      }

      return {
        ok: true,
        data: rows[0],
      };
    } catch (err: any) {
      console.error("GET facility maintenance by id error:", err);
      set.status = 500;
      return {
        error: err?.message || "Gagal memuat data pemeliharaan",
      };
    }
  })

  /* TAMBAH riwayat pemeliharaan */
  .post(
    "/facilities/:id/maintenance",
    async ({ params, body, headers, set }) => {
      try {
        const token = getTokenFromHeaders(headers);
        const payload: any = token ? verifyToken(token) : null;

        // Hanya admin yang boleh menambah
        if (!payload || payload.role !== "admin") {
          set.status = 403;
          return { error: "Forbidden" };
        }

        const facilityId = Number(params.id);
        const b = body as any;

        const {
          maintenance_date,
          issue_description,
          action_taken,
          cost,
          status,
          notes,
        } = b;

        if (!facilityId) {
          set.status = 400;
          return { error: "ID sarana tidak valid" };
        }

        if (!maintenance_date) {
          set.status = 400;
          return {
            error: "Tanggal pemeliharaan wajib diisi",
          };
        }

        if (!issue_description || !String(issue_description).trim()) {
          set.status = 400;
          return {
            error: "Deskripsi masalah wajib diisi",
          };
        }

        const validStatus = ["dilaporkan", "diproses", "selesai"];

        const maintenanceStatus =
          status && validStatus.includes(status) ? status : "dilaporkan";

        const maintenanceCost =
          cost === "" || cost === null || cost === undefined ? 0 : Number(cost);

        if (Number.isNaN(maintenanceCost) || maintenanceCost < 0) {
          set.status = 400;
          return {
            error: "Biaya pemeliharaan tidak valid",
          };
        }

        const [facilityRows]: any = await db.query(
          "SELECT id FROM facilities WHERE id = ? LIMIT 1",
          [facilityId],
        );

        if (!facilityRows.length) {
          set.status = 404;
          return { error: "Sarana tidak ditemukan" };
        }

        const [result]: any = await db.query(
          `
          INSERT INTO facility_maintenance
          (
            facility_id,
            maintenance_date,
            issue_description,
            action_taken,
            cost,
            status,
            notes
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
          [
            facilityId,
            maintenance_date,
            String(issue_description).trim(),
            action_taken || null,
            maintenanceCost,
            maintenanceStatus,
            notes || null,
          ],
        );

        return {
          ok: true,
          id: result.insertId,
          message: "Riwayat pemeliharaan berhasil ditambahkan",
        };
      } catch (err: any) {
        console.error("POST facility maintenance error:", err);
        set.status = 500;
        return {
          error: err?.message || "Gagal menambahkan riwayat pemeliharaan",
        };
      }
    },
  )

  /* UPDATE riwayat pemeliharaan */
  .put("/facility-maintenance/:id", async ({ params, body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      // Hanya admin yang boleh mengubah
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = Number(params.id);
      const b = body as any;

      const {
        maintenance_date,
        issue_description,
        action_taken,
        cost,
        status,
        notes,
      } = b;

      if (!id) {
        set.status = 400;
        return { error: "ID riwayat tidak valid" };
      }

      if (!maintenance_date) {
        set.status = 400;
        return {
          error: "Tanggal pemeliharaan wajib diisi",
        };
      }

      if (!issue_description || !String(issue_description).trim()) {
        set.status = 400;
        return {
          error: "Deskripsi masalah wajib diisi",
        };
      }

      const validStatus = ["dilaporkan", "diproses", "selesai"];

      if (!validStatus.includes(status)) {
        set.status = 400;
        return {
          error: "Status pemeliharaan tidak valid",
        };
      }

      const maintenanceCost =
        cost === "" || cost === null || cost === undefined ? 0 : Number(cost);

      if (Number.isNaN(maintenanceCost) || maintenanceCost < 0) {
        set.status = 400;
        return {
          error: "Biaya pemeliharaan tidak valid",
        };
      }

      const [existingRows]: any = await db.query(
        "SELECT id FROM facility_maintenance WHERE id = ? LIMIT 1",
        [id],
      );

      if (!existingRows.length) {
        set.status = 404;
        return {
          error: "Riwayat pemeliharaan tidak ditemukan",
        };
      }

      await db.query(
        `
        UPDATE facility_maintenance
        SET
          maintenance_date = ?,
          issue_description = ?,
          action_taken = ?,
          cost = ?,
          status = ?,
          notes = ?
        WHERE id = ?
      `,
        [
          maintenance_date,
          String(issue_description).trim(),
          action_taken || null,
          maintenanceCost,
          status,
          notes || null,
          id,
        ],
      );

      return {
        ok: true,
        message: "Riwayat pemeliharaan berhasil diperbarui",
      };
    } catch (err: any) {
      console.error("PUT facility maintenance error:", err);
      set.status = 500;
      return {
        error: err?.message || "Gagal memperbarui riwayat pemeliharaan",
      };
    }
  })

  /* HAPUS riwayat pemeliharaan */
  .delete("/facility-maintenance/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      // Hanya admin yang boleh menghapus
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = Number(params.id);

      if (!id) {
        set.status = 400;
        return {
          error: "ID riwayat tidak valid",
        };
      }

      const [existingRows]: any = await db.query(
        "SELECT id FROM facility_maintenance WHERE id = ? LIMIT 1",
        [id],
      );

      if (!existingRows.length) {
        set.status = 404;
        return {
          error: "Riwayat pemeliharaan tidak ditemukan",
        };
      }

      await db.query("DELETE FROM facility_maintenance WHERE id = ?", [id]);

      return {
        ok: true,
        message: "Riwayat pemeliharaan berhasil dihapus",
      };
    } catch (err: any) {
      console.error("DELETE facility maintenance error:", err);
      set.status = 500;
      return {
        error: err?.message || "Gagal menghapus riwayat pemeliharaan",
      };
    }
  })

  /* =====================================================
     EKSTRAKURIKULER
  ===================================================== */

  .get("/extracurriculars/stats", async ({ headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [rows]: any = await db.query(`
          SELECT
            COUNT(*) AS total,
            SUM(status = 'aktif') AS aktif
          FROM extracurriculars
        `);

      const [memberRows]: any = await db.query(`
            SELECT COUNT(*) AS total_peserta
            FROM extracurricular_members
            WHERE status = 'aktif'
          `);

      const stat = rows[0] || {};
      const memberStat = memberRows[0] || {};

      return {
        ok: true,
        data: {
          total: Number(stat.total || 0),
          aktif: Number(stat.aktif || 0),
          total_peserta: Number(memberStat.total_peserta || 0),
        },
      };
    } catch (err: any) {
      console.error("GET extracurricular stats:", err);

      set.status = 500;

      return {
        error: err.message,
      };
    }
  })

  .get("/extracurriculars", async ({ headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [rows]: any = await db.query(`
            SELECT
              e.id,
              e.name,
              e.description,
              e.teacher_id,
              t.nama AS teacher_name,
              e.day_of_week,
              e.start_time,
              e.end_time,
              e.location,
              e.max_members,
              e.status,
              COUNT(
                CASE
                  WHEN em.status = 'aktif'
                  THEN 1
                END
              ) AS active_members
            FROM extracurriculars e
            INNER JOIN teachers t
              ON t.id = e.teacher_id
            LEFT JOIN extracurricular_members em
              ON em.extracurricular_id = e.id
            GROUP BY
              e.id,
              e.name,
              e.description,
              e.teacher_id,
              t.nama,
              e.day_of_week,
              e.start_time,
              e.end_time,
              e.location,
              e.max_members,
              e.status
            ORDER BY e.name ASC
          `);

      return {
        ok: true,
        data: rows,
      };
    } catch (err: any) {
      console.error("GET extracurriculars:", err);

      set.status = 500;

      return {
        error: err.message,
      };
    }
  })

  .get("/extracurriculars/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = Number(params.id);

      const [rows]: any = await db.query(
        `
            SELECT
              e.id,
              e.name,
              e.description,
              e.teacher_id,
              t.nama AS teacher_name,
              e.day_of_week,
              e.start_time,
              e.end_time,
              e.location,
              e.max_members,
              e.status,
              (
                SELECT COUNT(*)
                FROM extracurricular_members em
                WHERE em.extracurricular_id = e.id
                  AND em.status = 'aktif'
              ) AS active_members
            FROM extracurriculars e
            INNER JOIN teachers t
              ON t.id = e.teacher_id
            WHERE e.id = ?
            LIMIT 1
            `,
        [id],
      );

      if (!rows.length) {
        set.status = 404;

        return {
          error: "Ekstrakurikuler tidak ditemukan",
        };
      }

      return {
        ok: true,
        data: rows[0],
      };
    } catch (err: any) {
      console.error("GET extracurricular detail:", err);

      set.status = 500;

      return {
        error: err.message,
      };
    }
  })

  .post("/extracurriculars", async ({ body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);

      const payload: any = token ? verifyToken(token) : null;

      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const b: any = body;

      if (
        !b.name ||
        !b.teacher_id ||
        !b.day_of_week ||
        !b.start_time ||
        !b.end_time ||
        !b.max_members
      ) {
        set.status = 400;

        return {
          error: "Nama, pembina, hari, waktu, dan maksimal anggota wajib diisi",
        };
      }

      if (
        !["senin", "selasa", "rabu", "kamis", "jumat", "sabtu"].includes(
          b.day_of_week,
        )
      ) {
        set.status = 400;

        return {
          error: "Hari ekstrakurikuler tidak valid",
        };
      }

      if (b.start_time >= b.end_time) {
        set.status = 400;

        return {
          error: "Jam selesai harus lebih besar dari jam mulai",
        };
      }

      if (Number(b.max_members) < 1) {
        set.status = 400;

        return {
          error: "Maksimal anggota minimal 1 siswa",
        };
      }

      const [teacherRows]: any = await db.query(
        "SELECT id FROM teachers WHERE id = ? LIMIT 1",
        [Number(b.teacher_id)],
      );

      if (!teacherRows.length) {
        set.status = 400;

        return {
          error: "Guru / pembina tidak ditemukan",
        };
      }

      const [result]: any = await db.query(
        `
            INSERT INTO extracurriculars
            (
              name,
              description,
              teacher_id,
              day_of_week,
              start_time,
              end_time,
              location,
              max_members,
              status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
        [
          b.name.trim(),
          b.description || null,
          Number(b.teacher_id),
          b.day_of_week,
          b.start_time,
          b.end_time,
          b.location || null,
          Number(b.max_members),
          b.status || "aktif",
        ],
      );

      return {
        ok: true,
        id: result.insertId,
      };
    } catch (err: any) {
      console.error("POST extracurricular:", err);

      set.status = 500;

      return {
        error: err.message,
      };
    }
  })

  .put("/extracurriculars/:id", async ({ params, body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);

      const payload: any = token ? verifyToken(token) : null;

      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = Number(params.id);
      const b: any = body;

      if (
        !b.name ||
        !b.teacher_id ||
        !b.day_of_week ||
        !b.start_time ||
        !b.end_time ||
        !b.max_members
      ) {
        set.status = 400;

        return {
          error: "Nama, pembina, hari, waktu, dan maksimal anggota wajib diisi",
        };
      }

      if (b.start_time >= b.end_time) {
        set.status = 400;

        return {
          error: "Jam selesai harus lebih besar dari jam mulai",
        };
      }

      /*
       * Jangan izinkan max_members lebih kecil
       * dari jumlah anggota aktif saat ini.
       */
      const [memberRows]: any = await db.query(
        `
            SELECT COUNT(*) AS total
            FROM extracurricular_members
            WHERE extracurricular_id = ?
              AND status = 'aktif'
            `,
        [id],
      );

      const activeMembers = Number(memberRows[0]?.total || 0);

      if (Number(b.max_members) < activeMembers) {
        set.status = 400;

        return {
          error: `Maksimal anggota tidak boleh lebih kecil dari jumlah anggota aktif saat ini (${activeMembers} siswa)`,
        };
      }

      const [result]: any = await db.query(
        `
            UPDATE extracurriculars
            SET
              name = ?,
              description = ?,
              teacher_id = ?,
              day_of_week = ?,
              start_time = ?,
              end_time = ?,
              location = ?,
              max_members = ?,
              status = ?
            WHERE id = ?
            `,
        [
          b.name.trim(),
          b.description || null,
          Number(b.teacher_id),
          b.day_of_week,
          b.start_time,
          b.end_time,
          b.location || null,
          Number(b.max_members),
          b.status || "aktif",
          id,
        ],
      );

      if (!result.affectedRows) {
        set.status = 404;

        return {
          error: "Ekstrakurikuler tidak ditemukan",
        };
      }

      return {
        ok: true,
      };
    } catch (err: any) {
      console.error("PUT extracurricular:", err);

      set.status = 500;

      return {
        error: err.message,
      };
    }
  })

  .delete("/extracurriculars/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);

      const payload: any = token ? verifyToken(token) : null;

      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = Number(params.id);

      const [result]: any = await db.query(
        "DELETE FROM extracurriculars WHERE id = ?",
        [id],
      );

      if (!result.affectedRows) {
        set.status = 404;

        return {
          error: "Ekstrakurikuler tidak ditemukan",
        };
      }

      return {
        ok: true,
      };
    } catch (err: any) {
      console.error("DELETE extracurricular:", err);

      set.status = 500;

      return {
        error: err.message,
      };
    }
  })

  .get("/extracurriculars/:id/members", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);

      const payload: any = token ? verifyToken(token) : null;

      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const extracurricularId = Number(params.id);

      const [rows]: any = await db.query(
        `
            SELECT
              em.id,
              em.extracurricular_id,
              em.student_id,
              em.join_date,
              em.status,
              s.nis,
              s.nama AS student_name,
              c.nama AS kelas_nama
            FROM extracurricular_members em
            INNER JOIN students s
              ON s.id = em.student_id
            LEFT JOIN classes c
              ON c.id = s.kelas_id
            WHERE em.extracurricular_id = ?
            ORDER BY
              CASE
                WHEN em.status = 'aktif'
                THEN 0
                ELSE 1
              END,
              em.join_date ASC,
              s.nama ASC
            `,
        [extracurricularId],
      );

      return {
        ok: true,
        data: rows,
      };
    } catch (err: any) {
      console.error("GET extracurricular members:", err);

      set.status = 500;

      return {
        error: err.message,
      };
    }
  })

  .post(
    "/extracurriculars/:id/members",
    async ({ params, body, headers, set }) => {
      try {
        const token = getTokenFromHeaders(headers);

        const payload: any = token ? verifyToken(token) : null;

        if (!payload || payload.role !== "admin") {
          set.status = 403;
          return { error: "Forbidden" };
        }

        const extracurricularId = Number(params.id);

        const b: any = body;

        const studentId = Number(b.student_id);

        const joinDate = b.join_date || new Date().toISOString().slice(0, 10);

        if (!extracurricularId || !studentId) {
          set.status = 400;

          return {
            error: "Ekstrakurikuler dan siswa wajib dipilih",
          };
        }

        /*
         * Ambil data ekskul + kapasitas.
         */
        const [exRows]: any = await db.query(
          `
            SELECT
              id,
              max_members,
              status
            FROM extracurriculars
            WHERE id = ?
            LIMIT 1
            `,
          [extracurricularId],
        );

        if (!exRows.length) {
          set.status = 404;

          return {
            error: "Ekstrakurikuler tidak ditemukan",
          };
        }

        const ex = exRows[0];

        if (ex.status !== "aktif") {
          set.status = 400;

          return {
            error: "Ekstrakurikuler sedang nonaktif",
          };
        }

        /*
         * Pastikan siswa benar-benar ada.
         */
        const [studentRows]: any = await db.query(
          "SELECT id FROM students WHERE id = ? LIMIT 1",
          [studentId],
        );

        if (!studentRows.length) {
          set.status = 400;

          return {
            error: "Siswa tidak ditemukan",
          };
        }

        /*
         * Cek apakah siswa pernah masuk
         * ke ekskul ini.
         */
        const [existingRows]: any = await db.query(
          `
            SELECT
              id,
              status
            FROM extracurricular_members
            WHERE extracurricular_id = ?
              AND student_id = ?
            LIMIT 1
            `,
          [extracurricularId, studentId],
        );

        /*
         * Kalau masih aktif:
         * jangan masukkan dua kali.
         */
        if (existingRows.length && existingRows[0].status === "aktif") {
          set.status = 400;

          return {
            error: "Siswa sudah terdaftar sebagai anggota ekstrakurikuler ini",
          };
        }

        /*
         * Hitung HANYA anggota aktif.
         */
        const [countRows]: any = await db.query(
          `
            SELECT COUNT(*) AS total
            FROM extracurricular_members
            WHERE extracurricular_id = ?
              AND status = 'aktif'
            `,
          [extracurricularId],
        );

        const activeMembers = Number(countRows[0]?.total || 0);

        const maxMembers = Number(ex.max_members);

        /*
         * VALIDASI KAPASITAS
         */
        if (maxMembers && activeMembers >= maxMembers) {
          set.status = 400;

          return {
            error: `Gagal menambahkan anggota. Kapasitas ekstrakurikuler telah mencapai batas maksimal (${maxMembers} siswa).`,
          };
        }

        /*
         * Kalau siswa pernah ikut dan
         * statusnya "keluar", AKTIFKAN ROW LAMA.
         *
         * Tidak membuat row baru karena ada:
         * UNIQUE(extracurricular_id, student_id)
         */
        if (existingRows.length && existingRows[0].status === "keluar") {
          await db.query(
            `
            UPDATE extracurricular_members
            SET
              join_date = ?,
              status = 'aktif'
            WHERE id = ?
            `,
            [joinDate, existingRows[0].id],
          );

          return {
            ok: true,
            message: "Siswa berhasil diaktifkan kembali sebagai anggota",
          };
        }

        /*
         * Siswa belum pernah ikut.
         */
        await db.query(
          `
          INSERT INTO extracurricular_members
          (
            extracurricular_id,
            student_id,
            join_date,
            status
          )
          VALUES (?, ?, ?, 'aktif')
          `,
          [extracurricularId, studentId, joinDate],
        );

        return {
          ok: true,
          message: "Anggota berhasil ditambahkan",
        };
      } catch (err: any) {
        console.error("POST extracurricular member:", err);

        /*
         * Safety net untuk UNIQUE KEY.
         */
        if (err.code === "ER_DUP_ENTRY") {
          set.status = 400;

          return {
            error: "Siswa sudah terdaftar pada ekstrakurikuler ini",
          };
        }

        set.status = 500;

        return {
          error: err.message,
        };
      }
    },
  )

  .put(
    "/extracurricular-members/:id/status",
    async ({ params, body, headers, set }) => {
      try {
        const token = getTokenFromHeaders(headers);

        const payload: any = token ? verifyToken(token) : null;

        if (!payload || payload.role !== "admin") {
          set.status = 403;
          return { error: "Forbidden" };
        }

        const id = Number(params.id);

        const status = (body as any)?.status;

        if (!["aktif", "keluar"].includes(status)) {
          set.status = 400;

          return {
            error: "Status anggota tidak valid",
          };
        }

        /*
         * Jika mau mengaktifkan kembali,
         * cek kapasitas terlebih dahulu.
         */
        if (status === "aktif") {
          const [memberRows]: any = await db.query(
            `
              SELECT
                em.extracurricular_id,
                e.max_members
              FROM extracurricular_members em
              INNER JOIN extracurriculars e
                ON e.id = em.extracurricular_id
              WHERE em.id = ?
              LIMIT 1
              `,
            [id],
          );

          if (!memberRows.length) {
            set.status = 404;

            return {
              error: "Anggota tidak ditemukan",
            };
          }

          const member = memberRows[0];

          const [countRows]: any = await db.query(
            `
              SELECT COUNT(*) AS total
              FROM extracurricular_members
              WHERE extracurricular_id = ?
                AND status = 'aktif'
                AND id <> ?
              `,
            [member.extracurricular_id, id],
          );

          const activeMembers = Number(countRows[0]?.total || 0);

          if (
            member.max_members !== null &&
            activeMembers >= Number(member.max_members)
          ) {
            set.status = 400;

            return {
              error: `Tidak dapat mengaktifkan anggota. Kapasitas maksimal (${member.max_members} siswa) sudah penuh.`,
            };
          }
        }

        const [result]: any = await db.query(
          `
            UPDATE extracurricular_members
            SET status = ?
            WHERE id = ?
            `,
          [status, id],
        );

        if (!result.affectedRows) {
          set.status = 404;

          return {
            error: "Anggota ekstrakurikuler tidak ditemukan",
          };
        }

        return {
          ok: true,
        };
      } catch (err: any) {
        console.error("UPDATE extracurricular member status:", err);

        set.status = 500;

        return {
          error: err.message,
        };
      }
    },
  )

  /* =========================================================
   EKSTRAKURIKULER - KEPALA SEKOLAH
   READ ONLY
========================================================= */

  /* Statistik ekstrakurikuler */
  .get("/extracurriculars/stats/kepala", async ({ headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || payload.role !== "kepala") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [rows] = await db.query(`
      SELECT
        COUNT(*) AS total,
        SUM(status = 'aktif') AS aktif
      FROM extracurriculars
    `);

      const [memberRows] = await db.query(`
      SELECT COUNT(*) AS total
      FROM extracurricular_members
      WHERE status = 'aktif'
    `);

      const stat: any = (rows as any[])[0] || {};
      const memberStat: any = (memberRows as any[])[0] || {};

      return {
        ok: true,
        data: {
          total: Number(stat.total || 0),
          aktif: Number(stat.aktif || 0),
          total_peserta: Number(memberStat.total || 0),
        },
      };
    } catch (err: any) {
      console.error("GET extracurricular stats error:", err);
      set.status = 500;
      return {
        error: err?.message || "Gagal memuat statistik ekstrakurikuler",
      };
    }
  })

  /* Daftar ekstrakurikuler - Kepala hanya melihat */
  .get("/extracurriculars", async ({ headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || !["admin", "kepala"].includes(payload.role)) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [rows] = await db.query(`
      SELECT
        e.id,
        e.name,
        e.description,
        e.teacher_id,
        t.nama AS teacher_name,
        e.day_of_week,
        e.start_time,
        e.end_time,
        e.location,
        e.max_members,
        e.status,

        (
          SELECT COUNT(*)
          FROM extracurricular_members em
          WHERE em.extracurricular_id = e.id
            AND em.status = 'aktif'
        ) AS active_members

      FROM extracurriculars e

      LEFT JOIN teachers t
        ON t.id = e.teacher_id

      ORDER BY e.name ASC
    `);

      return {
        ok: true,
        data: rows,
      };
    } catch (err: any) {
      console.error("GET extracurriculars error:", err);
      set.status = 500;
      return {
        error: err?.message || "Gagal memuat data ekstrakurikuler",
      };
    }
  })

  /* Detail ekstrakurikuler + daftar anggota */
  .get("/extracurriculars/kepala/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || payload.role !== "kepala") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = Number(params.id);

      if (!id) {
        set.status = 400;
        return {
          error: "ID ekstrakurikuler tidak valid",
        };
      }

      /* ==========================
       DETAIL EKSTRAKURIKULER
    ========================== */

      const [extraRows] = await db.query(
        `
      SELECT
        e.id,
        e.name,
        e.description,
        e.teacher_id,
        t.nama AS teacher_name,
        e.day_of_week,
        e.start_time,
        e.end_time,
        e.location,
        e.max_members,
        e.status,

        (
          SELECT COUNT(*)
          FROM extracurricular_members em
          WHERE em.extracurricular_id = e.id
            AND em.status = 'aktif'
        ) AS active_members

      FROM extracurriculars e

      LEFT JOIN teachers t
        ON t.id = e.teacher_id

      WHERE e.id = ?

      LIMIT 1
      `,
        [id],
      );

      const extracurricular = (extraRows as any[])[0];

      if (!extracurricular) {
        set.status = 404;
        return {
          error: "Ekstrakurikuler tidak ditemukan",
        };
      }

      /* ==========================
       DAFTAR ANGGOTA
    ========================== */

      const [memberRows] = await db.query(
        `
      SELECT
        em.id,
        em.student_id,
        em.join_date,
        em.status,

        s.nis,
        s.nama AS student_name,

        c.nama AS kelas_nama

      FROM extracurricular_members em

      INNER JOIN students s
        ON s.id = em.student_id

      LEFT JOIN classes c
        ON c.id = s.kelas_id

      WHERE em.extracurricular_id = ?

      ORDER BY
        CASE
          WHEN em.status = 'aktif' THEN 0
          ELSE 1
        END,
        s.nama ASC
      `,
        [id],
      );

      return {
        ok: true,
        data: extracurricular,
        members: memberRows,
      };
    } catch (err: any) {
      console.error("GET extracurricular detail error:", err);
      set.status = 500;
      return {
        error: err?.message || "Gagal memuat detail ekstrakurikuler",
      };
    }
  })

  /* =====================
   SCHEDULES (JADWAL)
   ===================== */
  .post("/jadwal", async ({ body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payloadUser: any = token ? verifyToken(token) : null;
      if (!payloadUser || payloadUser.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const b = body as any;
      // expected payload: { name, academic, daysPerWeek, periodsPerDay, periodDuration, classes, subjects, teachers, preferences, generated, assignments, ... }
      const nameInput: string = (b.name || "Jadwal").trim();
      const academic = b.academic ?? null;
      const daysPerWeek = Number(b.daysPerWeek) || null;
      const periodsPerDay = Number(b.periodsPerDay) || null;
      const periodDuration = Number(b.periodDuration) || null;
      const payloadJson = JSON.stringify(b); // simpan seluruh payload

      // Cari nama yang sama atau nama yang berformat "nameInput (n)"
      const [existingRows] = await db.query(
        "SELECT name FROM schedules WHERE name = ? OR name LIKE CONCAT(?, ' (%')",
        [nameInput, nameInput],
      );

      // hitung suffix terbesar
      let maxSuffix = 0;
      let exactExists = false;
      (existingRows as any[]).forEach((r) => {
        const nm: string = r.name;
        if (nm === nameInput) exactExists = true;
        const m = nm.match(
          new RegExp(`^${escapeRegExp(nameInput)} \\((\\d+)\\)$`),
        );
        if (m) {
          const n = Number(m[1]);
          if (!isNaN(n) && n > maxSuffix) maxSuffix = n;
        }
      });

      let finalName = nameInput;
      if (exactExists) {
        finalName = `${nameInput} (${maxSuffix + 1})`;
      } else if (maxSuffix > 0) {
        // jika ada suffixs seperti name (2),(3) tapi nama asli belum ada — tetap tidak perlu menambah
        // (jaga konsistensi) — tidak mengubah finalName
      }

      // Insert ke DB (parameterized)
      const [res]: any = await db.query(
        "INSERT INTO schedules (name, academic, days_per_week, periods_per_day, period_duration, payload, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          finalName,
          academic,
          daysPerWeek,
          periodsPerDay,
          periodDuration,
          payloadJson,
          payloadUser?.id ?? null,
        ],
      );

      return { ok: true, id: res.insertId, name: finalName };
    } catch (err: any) {
      console.error("POST /api/admin/jadwal error:", err);
      set.status = 500;
      return { error: err?.message ?? String(err) };
    }
  })

  /* list saved schedules (light) */
  .get("/jadwal", async ({ headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payloadUser: any = token ? verifyToken(token) : null;
      if (!payloadUser || payloadUser.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [rows] = await db.query(
        "SELECT id, name, academic, created_at FROM schedules ORDER BY created_at DESC",
      );
      return { ok: true, data: rows };
    } catch (err: any) {
      console.error("GET /api/admin/jadwal error:", err);
      set.status = 500;
      return { error: err?.message ?? String(err) };
    }
  })

  /* get jadwal detail by id */
  .get("/jadwal/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payloadUser: any = token ? verifyToken(token) : null;
      if (!payloadUser || payloadUser.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = params.id;
      const [rows] = await db.query(
        "SELECT id, name, academic, payload, created_at FROM schedules WHERE id = ? LIMIT 1",
        [id],
      );
      const r = (rows as any[])[0] ?? null;
      if (!r) {
        set.status = 404;
        return { error: "Not found" };
      }

      // parse payload JSON before returning (safe fallback)
      const parsed = parseSchedulePayload(r.payload);

      return {
        ok: true,
        data: {
          id: r.id,
          name: r.name,
          academic: r.academic,
          created_at: r.created_at,
          payload: parsed,
        },
      };
    } catch (err: any) {
      console.error("GET /api/admin/jadwal/:id error:", err);
      set.status = 500;
      return { error: err?.message ?? String(err) };
    }
  })

  /* =====================
   SUBJECTS (MATA PELAJARAN)
   ===================== */

  /* list semua mata pelajaran (dipakai form konfigurasi penjadwalan) */
  .get("/subjects", async ({ headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [rows] = await db.query(
        "SELECT id, kode, nama FROM subjects ORDER BY nama",
      );
      return { ok: true, data: rows };
    } catch (err: any) {
      console.error("GET /api/admin/subjects error:", err);
      set.status = 500;
      return { error: err.message };
    }
  });

/**
 * Ambil metadata + assignments dari payload jadwal, tanpa peduli struktur
 * nesting-nya (payload lama vs baru, dibungkus `payload.payload` atau tidak).
 * Meniru persis urutan prioritas yang dipakai di frontend (renderJadwalDetail
 * pada guru.main.js / siswa.main.js) supaya hasilnya konsisten dengan yang
 * pernah ditampilkan sebelumnya.
 */
function extractScheduleMeta(parsed: any) {
  const classes =
    (parsed.payload &&
      Array.isArray(parsed.payload.classes) &&
      parsed.payload.classes) ||
    (Array.isArray(parsed.classes) && parsed.classes) ||
    [];

  const daysPerWeek =
    (parsed.payload && parsed.payload.daysPerWeek) || parsed.daysPerWeek || 5;

  const periodsPerDay =
    (parsed.payload && parsed.payload.periodsPerDay) ||
    parsed.periodsPerDay ||
    8;

  const periodDuration =
    (parsed.payload && parsed.payload.periodDuration) ||
    parsed.periodDuration ||
    35;

  const assignments =
    (parsed.payload &&
      parsed.payload.generated &&
      Array.isArray(parsed.payload.generated.assignments) &&
      parsed.payload.generated.assignments) ||
    (parsed.generated &&
      Array.isArray(parsed.generated.assignments) &&
      parsed.generated.assignments) ||
    (Array.isArray(parsed.assignments) && parsed.assignments) ||
    (parsed.payload &&
      Array.isArray(parsed.payload.assignments) &&
      parsed.payload.assignments) ||
    [];

  return { classes, daysPerWeek, periodsPerDay, periodDuration, assignments };
}

export const publicDataRouter = new Elysia({ prefix: "/api/public" })
  /*
  PUBLIC API
  */

  /*** PANGGIL DAFTAR KELAS ***/
  .get("/kelas", async ({ set }) => {
    try {
      const [rows] = await db.query(
        "SELECT id, nama FROM classes ORDER BY tingkat, section",
      );

      return {
        ok: true,
        data: rows,
      };
    } catch (err: any) {
      set.status = 500;
      return { error: err.message };
    }
  })

  // Ekstrakurikuler yang diikuti siswa yang sedang login.
  // Kalau siswa belum jadi anggota ekskul manapun (status 'aktif' di
  // extracurricular_members), data dikembalikan kosong — frontend yang
  // menampilkan pesan "Anda tidak mengikuti ekstrakurikuler manapun".
  .get("/extracurriculars/mine", async ({ headers, set }) => {
    try {
      const current = await getCurrentStudent(headers);
      if (!current) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [rows] = await db.query(
        `
          SELECT
            e.id,
            e.name,
            e.description,
            e.teacher_id,
            t.nama AS teacher_name,
            e.day_of_week,
            e.start_time,
            e.end_time,
            e.location,
            e.max_members,
            e.status,
            em.join_date,
            (
              SELECT COUNT(*)
              FROM extracurricular_members em2
              WHERE em2.extracurricular_id = e.id
                AND em2.status = 'aktif'
            ) AS active_members
          FROM extracurricular_members em
          INNER JOIN extracurriculars e
            ON e.id = em.extracurricular_id
          LEFT JOIN teachers t
            ON t.id = e.teacher_id
          WHERE em.student_id = ?
            AND em.status = 'aktif'
          ORDER BY e.name ASC
        `,
        [current.student.id],
      );

      return { ok: true, data: rows };
    } catch (err: any) {
      console.error("GET /api/public/extracurriculars/mine error:", err);
      set.status = 500;
      return { error: err.message };
    }
  })

  // Daftar ekstrakurikuler untuk halaman siswa — read-only.
  // Sengaja tanpa endpoint pendaftaran; siswa belum bisa daftar ekskul
  // sendiri dari sini (masih dikelola manual oleh pembina/admin).
  .get("/extracurriculars", async ({ set }) => {
    try {
      const [rows] = await db.query(`
        SELECT
          e.id,
          e.name,
          e.description,
          e.teacher_id,
          t.nama AS teacher_name,
          e.day_of_week,
          e.start_time,
          e.end_time,
          e.location,
          e.max_members,
          e.status,
          COUNT(
            CASE
              WHEN em.status = 'aktif'
              THEN 1
            END
          ) AS active_members
        FROM extracurriculars e
        LEFT JOIN teachers t
          ON t.id = e.teacher_id
        LEFT JOIN extracurricular_members em
          ON em.extracurricular_id = e.id
        WHERE e.status = 'aktif'
        GROUP BY
          e.id, e.name, e.description, e.teacher_id, t.nama,
          e.day_of_week, e.start_time, e.end_time, e.location,
          e.max_members, e.status
        ORDER BY e.name ASC
      `);

      return { ok: true, data: rows };
    } catch (err: any) {
      console.error("GET /api/public/extracurriculars error:", err);
      set.status = 500;
      return { error: err.message };
    }
  })

  // public guru (bisa dipanggil oleh siswa)
  .get("/guru", async ({ set }) => {
    try {
      const [rows] = await db.query("SELECT * FROM teachers ORDER BY nama");
      return { ok: true, data: rows };
    } catch (err: any) {
      set.status = 500;
      return { error: err.message };
    }
  })

  // public jadwal list
  .get("/jadwal", async ({ set }) => {
    try {
      const [rows] = await db.query(
        "SELECT id, name, academic, created_at FROM schedules ORDER BY created_at DESC",
      );
      return { ok: true, data: rows };
    } catch (err: any) {
      set.status = 500;
      return { error: err.message };
    }
  })

  // public jadwal detail
  .get("/jadwal/:id", async ({ params, set }) => {
    try {
      const id = params.id;
      const [rows] = await db.query(
        "SELECT id, name, academic, payload, created_at FROM schedules WHERE id = ? LIMIT 1",
        [id],
      );
      const r = (rows as any[])[0] ?? null;
      if (!r) {
        set.status = 404;
        return { error: "Not found" };
      }
      const parsed = parseSchedulePayload(r.payload);
      return {
        ok: true,
        data: {
          id: r.id,
          name: r.name,
          academic: r.academic,
          created_at: r.created_at,
          payload: parsed,
        },
      };
    } catch (err: any) {
      set.status = 500;
      return { error: err.message };
    }
  })

  // ============================================================
  // ENDPOINT DEBUG SEMENTARA — hapus lagi setelah bug 403 terpecahkan.
  // Buka langsung di browser (saat sudah login sebagai siswa):
  //   GET /api/public/_debug/whoami
  // Akan menunjukkan persis di langkah mana getCurrentStudent gagal.
  // ============================================================
  .get("/_debug/whoami", async ({ headers, set }) => {
    try {
      const cookie = (headers.cookie as string) ?? "";
      const hasCookieHeader = !!cookie;
      const tokenMatch = cookie.match(/token=([^;]+)/);
      const token = tokenMatch
        ? tokenMatch[1]
        : headers.authorization
          ? (headers.authorization as string).replace("Bearer ", "")
          : null;

      if (!token) {
        set.status = 200;
        return {
          step: "no_token",
          explanation:
            "Tidak ada cookie 'token' maupun header Authorization terkirim ke server. " +
            "Cek Network tab: request ke endpoint ini punya header Cookie: token=... atau tidak. " +
            "Kalau tidak ada, kemungkinan browser tidak mengirim cookie (mis. beda origin/port, atau belum login).",
          hasCookieHeader,
          rawCookieHeader: cookie || null,
        };
      }

      const payload: any = verifyToken(token);
      if (!payload) {
        set.status = 200;
        return {
          step: "invalid_or_expired_token",
          explanation:
            "Cookie token ada, tapi verifyToken() gagal (token tidak valid / sudah expired / JWT_SECRET beda). " +
            "Coba logout lalu login ulang.",
        };
      }

      if (payload.role !== "siswa") {
        set.status = 200;
        return {
          step: "wrong_role",
          explanation: `Token valid, tapi role di dalam token adalah "${payload.role}", bukan "siswa".`,
          payload,
        };
      }

      const byUserId = await getStudentByUserId(payload.id);
      const byNis = payload.username
        ? await getStudentByNis(payload.username)
        : null;

      set.status = 200;
      return {
        step: byUserId || byNis ? "ok" : "student_not_found",
        explanation: byUserId
          ? "Ditemukan lewat students.user_id — jalur normal, seharusnya /jadwal/mine sudah jalan."
          : byNis
            ? "students.user_id TIDAK ter-link, tapi ditemukan lewat fallback NIS (students.nis = users.username). " +
              "Ini sebabnya perlu file currentStudent.ts & student.ts terbaru sudah ter-deploy."
            : "Tidak ditemukan sama sekali — baik lewat students.user_id maupun students.nis. " +
              "Kemungkinan besar: tidak ada baris di tabel `students` yang user_id ATAU nis-nya cocok dengan akun ini. " +
              "Cek manual: SELECT * FROM students WHERE user_id = " +
              payload.id +
              " OR nis = '" +
              (payload.username ?? "") +
              "';",
        tokenPayload: payload,
        foundByUserId: byUserId,
        foundByNis: byNis,
      };
    } catch (err: any) {
      set.status = 500;
      return { error: err?.message ?? String(err) };
    }
  })

  // GET jadwal untuk siswa yang login (kelas diambil fresh dari DB via getCurrentStudent)
  .get("/jadwal/mine", async ({ headers, set }) => {
    try {
      const current = await getCurrentStudent(headers);
      if (!current) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const kelasId = current.student.kelas_id ?? null;
      if (!kelasId) {
        // siswa belum di-assign ke kelas manapun di DB
        return { ok: true, data: [] };
      }

      // ambil semua jadwal (biasanya tidak terlalu banyak) lalu filter di server
      const [rows] = await db.query(
        "SELECT id, name, academic, payload, created_at FROM schedules ORDER BY created_at DESC",
      );

      const out: any[] = [];

      for (const r of rows as any[]) {
        const parsed = parseSchedulePayload(r.payload);
        if (!parsed || !Array.isArray(parsed.classes)) continue;

        // jika payload.classes berisi objek dengan id yang cocok -> include
        const matchedIdxById = parsed.classes.findIndex(
          (c: any) =>
            c && (c.id === kelasId || String(c.id) === String(kelasId)),
        );
        if (matchedIdxById !== -1) {
          out.push({
            id: r.id,
            name: r.name,
            academic: r.academic,
            created_at: r.created_at,
            payload: filterSchedulePayloadForClass(parsed, matchedIdxById),
          });
          continue;
        }

        // jika tidak ada id di payload (misal lama) -> coba cocokkan berdasarkan nama kelas
        // ambil nama kelas di DB untuk kelasId
        const [cres]: any = await db.query(
          "SELECT nama, tingkat, section FROM classes WHERE id = ? LIMIT 1",
          [kelasId],
        );
        if (cres && cres.length) {
          const cls = cres[0];
          const className =
            cls.nama ||
            (cls.tingkat && cls.section
              ? `${cls.tingkat}.${cls.section}`
              : null);
          if (className) {
            const matchedIdxByName = parsed.classes.findIndex(
              (c: any) =>
                c &&
                (c.name === className ||
                  c.display === className ||
                  (c.display && c.display.trim() === className)),
            );
            if (matchedIdxByName !== -1) {
              out.push({
                id: r.id,
                name: r.name,
                academic: r.academic,
                created_at: r.created_at,
                payload: filterSchedulePayloadForClass(
                  parsed,
                  matchedIdxByName,
                ),
              });
            }
          }
        }
      }

      return { ok: true, data: out };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  // GET jadwal untuk guru yang login — hanya menampilkan jam mengajar
  // milik guru tsb sendiri (dicocokkan lewat nama guru, karena assignment
  // hasil generate jadwal cuma menyimpan teacherName, bukan teacherId).
  // Bentuk data sengaja flat (hari, sesi, mapel, kelas) — bukan tabel
  // grid per-kelas seperti endpoint admin/publik — sesuai kebutuhan
  // halaman "Jadwal Saya" milik guru.
  .get("/jadwal/mine-guru", async ({ headers, set }) => {
    try {
      const current = await getCurrentTeacher(headers);
      if (!current) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const teacherName = (current.teacher.nama || "").trim().toLowerCase();
      if (!teacherName) {
        return { ok: true, data: [] };
      }

      const [rows] = await db.query(
        "SELECT id, name, academic, payload, created_at FROM schedules ORDER BY created_at DESC",
      );

      const out: any[] = [];

      for (const r of rows as any[]) {
        const parsed = parseSchedulePayload(r.payload);
        if (!parsed) continue;

        const {
          classes,
          daysPerWeek,
          periodsPerDay,
          periodDuration,
          assignments,
        } = extractScheduleMeta(parsed);

        const mine = (assignments as any[]).filter(
          (a) =>
            a &&
            typeof a.teacherName === "string" &&
            a.teacherName.trim().toLowerCase() === teacherName,
        );

        if (!mine.length) continue;

        const items = mine
          .map((a: any) => ({
            day: a.day,
            period: a.period,
            subjectName: a.subjectName,
            className:
              (classes[a.classIdx] &&
                (classes[a.classIdx].display || classes[a.classIdx].name)) ||
              "-",
          }))
          .sort((x: any, y: any) => x.day - y.day || x.period - y.period);

        out.push({
          id: r.id,
          name: r.name,
          academic: r.academic,
          created_at: r.created_at,
          daysPerWeek,
          periodsPerDay,
          periodDuration,
          items,
        });
      }

      return { ok: true, data: out };
    } catch (err: any) {
      console.error("GET /api/public/jadwal/mine-guru error:", err);
      set.status = 500;
      return { error: err?.message ?? String(err) };
    }
  })

  /* ============================================================
   EKSTRAKURIKULER YANG DIBINA GURU LOGIN
   READ ONLY
   ============================================================ */

  .get("/extracurriculars/mine-guru", async ({ headers, set }) => {
    try {
      const current = await getCurrentTeacher(headers);

      if (!current) {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const teacherId = current.teacher.id;

      const [rows] = await db.query(
        `
      SELECT
        e.id,
        e.name,
        e.description,
        e.day_of_week,
        e.start_time,
        e.end_time,
        e.location,
        e.max_members,
        e.status,

        (
          SELECT COUNT(*)
          FROM extracurricular_members em
          WHERE em.extracurricular_id = e.id
            AND em.status = 'aktif'
        ) AS active_members

      FROM extracurriculars e

      WHERE e.teacher_id = ?

      ORDER BY
        CASE
          WHEN e.status = 'aktif' THEN 0
          ELSE 1
        END,
        e.name ASC
      `,
        [teacherId],
      );

      return {
        ok: true,
        data: rows,
      };
    } catch (err: any) {
      console.error("GET /api/public/extracurriculars/mine-guru error:", err);

      set.status = 500;

      return {
        error: err?.message || "Gagal memuat ekstrakurikuler yang dibina",
      };
    }
  })

  /* ============================================================
   DETAIL ANGGOTA EKSTRAKURIKULER UNTUK GURU PEMBINA
   ============================================================ */

  .get(
    "/extracurriculars/:id/members-guru",
    async ({ params, headers, set }) => {
      try {
        const current = await getCurrentTeacher(headers);

        if (!current) {
          set.status = 403;
          return { error: "Forbidden" };
        }

        const teacherId = current.teacher.id;
        const extracurricularId = Number(params.id);

        if (!extracurricularId) {
          set.status = 400;
          return {
            error: "ID ekstrakurikuler tidak valid",
          };
        }

        /*
         * Pastikan ekskul memang dibina
         * oleh guru yang sedang login.
         */
        const [extraRows] = await db.query(
          `
        SELECT
          e.id,
          e.name,
          e.day_of_week,
          e.start_time,
          e.end_time,
          e.location,
          e.max_members,
          e.status

        FROM extracurriculars e

        WHERE e.id = ?
          AND e.teacher_id = ?

        LIMIT 1
        `,
          [extracurricularId, teacherId],
        );

        const extracurricular = (extraRows as any[])[0];

        if (!extracurricular) {
          set.status = 404;

          return {
            error:
              "Ekstrakurikuler tidak ditemukan atau bukan tanggung jawab Anda",
          };
        }

        const [members] = await db.query(
          `
        SELECT
          em.id,
          em.student_id,
          em.join_date,
          em.status,

          s.nis,
          s.nama AS student_name,

          c.nama AS kelas_nama

        FROM extracurricular_members em

        INNER JOIN students s
          ON s.id = em.student_id

        LEFT JOIN classes c
          ON c.id = s.kelas_id

        WHERE em.extracurricular_id = ?

        ORDER BY
          CASE
            WHEN em.status = 'aktif' THEN 0
            ELSE 1
          END,
          s.nama ASC
        `,
          [extracurricularId],
        );

        return {
          ok: true,
          data: extracurricular,
          members,
        };
      } catch (err: any) {
        console.error(
          "GET /api/public/extracurriculars/:id/members-guru error:",
          err,
        );

        set.status = 500;

        return {
          error: err?.message || "Gagal memuat anggota ekstrakurikuler",
        };
      }
    },
  )

  /* =====================
   STUDENTS (SISWA)
   ===================== */
  .get("/siswa", async ({ headers, set, query }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "guru") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      // ambil query param kelas_id jika ada
      const kelasId = (query as any)?.kelas_id ?? null;

      if (kelasId) {
        const [rows] = await db.query(
          "SELECT s.*, c.nama as kelas_nama FROM students s LEFT JOIN classes c ON s.kelas_id = c.id WHERE s.kelas_id = ? ORDER BY s.nama",
          [kelasId],
        );
        return { ok: true, data: rows };
      } else {
        const [rows] = await db.query(
          "SELECT s.*, c.nama as kelas_nama FROM students s LEFT JOIN classes c ON s.kelas_id = c.id ORDER BY s.nama",
        );
        return { ok: true, data: rows };
      }
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .get("/siswa/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "guru") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = params.id;
      const [rows] = await db.query(
        "SELECT s.*, c.nama as kelas_nama FROM students s LEFT JOIN classes c ON s.kelas_id = c.id WHERE s.id = ? LIMIT 1",
        [id],
      );
      const r = (rows as any[])[0] ?? null;
      if (!r) {
        set.status = 404;
        return { error: "Not found" };
      }
      return { ok: true, data: r };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .post("/siswa", async ({ body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "guru") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const { nis, nama, jk, kelas_id, hp_ortu } = body as any;

      // server-side: cek NIS unik
      const [found] = await db.query(
        "SELECT id FROM students WHERE nis = ? LIMIT 1",
        [nis],
      );
      const foundRows = (found as any[]) || [];
      if (foundRows.length) {
        set.status = 400;
        return { error: "NIS sudah terdaftar pada siswa lain" };
      }

      // insert siswa
      const [res]: any = await db.query(
        "INSERT INTO students (nis, nama, jk, kelas_id, hp_ortu) VALUES (?, ?, ?, ?, ?)",
        [nis, nama, jk || null, kelas_id || null, hp_ortu || null],
      );

      const studentId = res.insertId;

      // --- buat akun user (username otomatis dari nama siswa) ---
      let plainPassword: string | null = null;
      let userId: number | null = null;
      let username: string | null = null;

      try {
        // NIS baru saja dipastikan unik di atas, jadi siswa ini pasti baru —
        // selalu buat akun baru (tidak ada cabang "akun sudah ada").
        username = await generateUniqueUsernameFromNama(nama);

        // generate password random (12 karakter hex)
        plainPassword = crypto.randomBytes(6).toString("hex"); // contoh: 'a3f4...'
        const newUser = await createUser(
          username,
          plainPassword,
          "siswa",
          nama,
        );
        userId = (newUser as any).id ?? null;

        // BUG FIX: sebelumnya user_id tidak pernah disimpan balik ke tabel
        // students, jadi login siswa tidak bisa menemukan data siswanya sendiri.
        if (userId) {
          await db.query("UPDATE students SET user_id = ? WHERE id = ?", [
            userId,
            studentId,
          ]);
        }

        // simpan ke export table (untuk CSV)
        await db.query(
          "INSERT INTO student_account_exports (student_id, user_id, nis, username, plain_password) VALUES (?, ?, ?, ?, ?)",
          [studentId, userId, nis, username, plainPassword],
        );
      } catch (errInner) {
        // catat error tapi jangan batalkan pembuatan siswa — admin tetap melihat siswa terbuat
        console.warn("Pembuatan akun siswa / export gagal:", errInner);
      }

      return { ok: true, id: studentId, username, plainPassword };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .put("/siswa/:id", async ({ params, body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "guru") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = params.id;
      const { nis, nama, jk, kelas_id, hp_ortu } = body as any;

      // server-side: cek NIS unik (kecuali untuk record ini sendiri)
      const [found] = await db.query(
        "SELECT id FROM students WHERE nis = ? AND id != ? LIMIT 1",
        [nis, id],
      );
      const foundRows = (found as any[]) || [];
      if (foundRows.length) {
        set.status = 400;
        return { error: "NIS sudah terpakai oleh siswa lain" };
      }

      await db.query(
        "UPDATE students SET nis=?, nama=?, jk=?, kelas_id=?, hp_ortu=? WHERE id=?",
        [nis, nama, jk || null, kelas_id || null, hp_ortu || null, id],
      );
      return { ok: true };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  .delete("/siswa/:id", async ({ params, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;
      if (!payload || payload.role !== "guru") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const id = params.id;
      await db.query("DELETE FROM students WHERE id=?", [id]);
      return { ok: true };
    } catch (err: any) {
      console.error(err);
      set.status = 500;
      return { error: err.message };
    }
  })

  /* =====================
     EXPORT CSV (akun siswa)
     ===================== */
  .get("/siswa/export", async ({ headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payloadUser: any = token ? verifyToken(token) : null;
      if (!payloadUser || payloadUser.role !== "guru") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      const [rows] = await db.query(
        `SELECT e.nis, e.username, e.plain_password, s.nama as student_name, e.created_at
         FROM student_account_exports e
         LEFT JOIN students s ON e.student_id = s.id
         ORDER BY e.created_at DESC`,
      );

      // build CSV text
      let csv = "nis,username,password,nama,created_at\n";
      (rows as any[]).forEach((r) => {
        const nis = String(r.nis ?? "");
        const username = String(r.username ?? "");
        const pw = String(r.plain_password ?? "");
        const nama = String(r.student_name ?? "");
        const created = r.created_at ? String(r.created_at) : "";
        // escape double quotes by doubling
        const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
        csv += `${esc(nis)},${esc(username)},${esc(pw)},${esc(nama)},${esc(created)}\n`;
      });

      // Return CSV as JSON field 'csv' (frontend can accept 'text/csv' or JSON with csv)
      return { ok: true, csv };
    } catch (err: any) {
      console.error("GET /api/public/siswa/export error:", err);
      set.status = 500;
      return { error: err.message ?? String(err) };
    }
  });

/* helper kecil: escape regexp for name matching */
function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
