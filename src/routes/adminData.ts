// src/routes/adminData.ts
import { Elysia } from "elysia";
import { db } from "../db";
import { verifyToken, createUser, findUserByUsername } from "../services/auth";
import { getCurrentStudent } from "../services/currentStudent";
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
  .get("/dashboard", ({ headers, set }) => {
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

    return Promise.all([
      db.query("SELECT COUNT(*) AS total FROM teachers"),
      db.query("SELECT COUNT(*) AS total FROM students"),
      db.query("SELECT COUNT(*) AS total FROM classes"),
    ]).then(([guru, siswa, kelas]) => ({
      guru: (guru[0] as any)[0].total,
      siswa: (siswa[0] as any)[0].total,
      kelas: (kelas[0] as any)[0].total,
    }));
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
