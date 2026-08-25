// src/routes/auth.ts
import { Elysia } from "elysia";
import { loginUser, verifyToken, changePassword } from "../services/auth";
import { db } from "../db";

function getTokenFromHeaders(headers: any) {
  const cookie = (headers.cookie as string) ?? "";
  const m = cookie.match(/token=([^;]+)/);
  if (m) return m[1];
  if (headers.authorization)
    return (headers.authorization as string).replace("Bearer ", "");
  return null;
}

export const authRoutes = new Elysia({ prefix: "/api/auth" })

  // LOGIN
  .post("/login", async ({ body, set }) => {
    try {
      const { username, password } = body as {
        username?: string;
        password?: string;
      };

      if (!username || !password) {
        set.status = 400;
        return { error: "Username dan password wajib diisi" };
      }

      const user = await loginUser(username, password);

      if (!user) {
        set.status = 401;
        return { error: "Username atau password salah" };
      }

      // Set httpOnly cookie — dengan cast untuk menghindari TS error
      // NOTE: gunakan SameSite/Secure di production.
      (set as any).headers = {
        ...((set as any).headers || {}),
        "Set-Cookie": `token=${user.token}; HttpOnly; Path=/; Max-Age=${60 * 60 * 8}`,
      };

      return {
        ok: true,
        role: user.role,
        username: user.username,
        displayName: user.displayName,
      };
    } catch (err: any) {
      console.error("LOGIN ERROR:", err);
      set.status = 500;
      return { error: err?.message ?? "Internal Server Error" };
    }
  })

  // ME (BARU)
  .get("/me", async ({ headers, set }) => {
    try {
      const cookie = (headers.cookie as string) ?? "";
      const m = cookie.match(/token=([^;]+)/);
      let token = m ? m[1] : null;

      if (!token && headers.authorization) {
        token = (headers.authorization as string).replace("Bearer ", "");
      }

      if (!token) {
        set.status = 401;
        return { error: "Unauthorized" };
      }

      const payload = verifyToken(token);
      if (!payload) {
        set.status = 401;
        return { error: "Invalid token" };
      }

      const result: any = { ok: true, user: payload };

      // Jika role guru, lampirkan data identitas guru + teacher_type + daftar mapel yang diampu
      if (payload.role === "guru") {
        const [rows] = await db.query(
          `SELECT 
             t.id AS teacher_id,
             t.nip,
             t.jk,
             t.agama,
             t.hp,
             t.email,
             t.keterangan,
             t.teacher_type,
             ts.subject_id,
             s.kode,
             s.nama
           FROM teachers t
           LEFT JOIN teacher_subjects ts ON ts.teacher_id = t.id
           LEFT JOIN subjects s ON s.id = ts.subject_id
           WHERE t.user_id = ?`,
          [payload.id],
        );

        const data = rows as any[];

        if (data.length > 0) {
          result.nip = data[0].nip;
          result.jk = data[0].jk;
          result.agama = data[0].agama;
          result.hp = data[0].hp;
          result.email = data[0].email;
          result.keterangan = data[0].keterangan;
          result.teacher_type = data[0].teacher_type;
          result.subjects = data
            .filter((r) => r.subject_id !== null)
            .map((r) => ({
              teacher_id: r.teacher_id,
              subject_id: r.subject_id,
              kode: r.kode,
              nama: r.nama,
            }));
        }
      }

      return result;
    } catch (err: any) {
      console.error("ME ERROR:", err);
      set.status = 500;
      return { error: err?.message ?? "Internal Server Error" };
    }
  })

  /* ME (LAMA)
  .get("/me", ({ headers, set }) => {
    try {
      const cookie = (headers.cookie as string) ?? "";
      const m = cookie.match(/token=([^;]+)/);
      let token = m ? m[1] : null;

      if (!token && headers.authorization) {
        token = (headers.authorization as string).replace("Bearer ", "");
      }

      if (!token) {
        set.status = 401;
        return { error: "Unauthorized" };
      }

      const payload = verifyToken(token);
      if (!payload) {
        set.status = 401;
        return { error: "Invalid token" };
      }

      return { ok: true, user: payload };
    } catch (err: any) {
      console.error("ME ERROR:", err);
      set.status = 500;
      return { error: err?.message ?? "Internal Server Error" };
      }
      }) */

  // GANTI PASSWORD (BARU)
  // Berlaku untuk siapa pun yang sedang login (role apa saja), karena
  // password_hash memang disimpan per-akun di tabel users, bukan per-role.
  // Dipakai oleh halaman siswa, guru, dan kepala sekolah — endpoint-nya generik.
  .post("/change-password", async ({ body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload = token ? verifyToken(token) : null;

      if (!payload) {
        set.status = 401;
        return { error: "Unauthorized" };
      }

      const { oldPassword, newPassword } = body as {
        oldPassword?: string;
        newPassword?: string;
      };

      if (!oldPassword || !newPassword) {
        set.status = 400;
        return { error: "Password lama dan password baru wajib diisi" };
      }

      if (newPassword.length < 6) {
        set.status = 400;
        return { error: "Password baru minimal 6 karakter" };
      }

      if (newPassword === oldPassword) {
        set.status = 400;
        return { error: "Password baru tidak boleh sama dengan password lama" };
      }

      const result = await changePassword(payload.id, oldPassword, newPassword);

      if (!result.ok) {
        set.status = 400;
        return { error: result.error };
      }

      return { ok: true };
    } catch (err: any) {
      console.error("CHANGE PASSWORD ERROR:", err);
      set.status = 500;
      return { error: err?.message ?? "Internal Server Error" };
    }
  })

  // LOGOUT
  .post("/logout", ({ set }) => {
    (set as any).headers = {
      ...((set as any).headers || {}),
      "Set-Cookie": `token=; HttpOnly; Path=/; Max-Age=0`,
    };
    return { ok: true };
  });
