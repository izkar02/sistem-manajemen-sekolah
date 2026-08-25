// src/services/auth.ts
import { db } from "../db";
import bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import dotenv from "dotenv";
import type { Role } from "../models/role";
dotenv.config();

const JWT_SECRET: jwt.Secret =
  process.env.JWT_SECRET ?? "change_this_secret_for_dev";
const JWT_EXPIRES = process.env.JWT_EXPIRES ?? "8h";

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  display_name?: string | null;
}

export async function findUserByUsername(
  username: string,
): Promise<UserRow | null> {
  const [rows] = await db.query(
    "SELECT id, username, password_hash, role, display_name FROM users WHERE username = ? LIMIT 1",
    [username],
  );
  const rs = rows as any[];
  if (!rs.length) return null;
  return rs[0] as UserRow;
}

export async function findUserById(id: number): Promise<UserRow | null> {
  const [rows] = await db.query(
    "SELECT id, username, password_hash, role, display_name FROM users WHERE id = ? LIMIT 1",
    [id],
  );
  const rs = rows as any[];
  if (!rs.length) return null;
  return rs[0] as UserRow;
}

export async function createUser(
  username: string,
  plainPassword: string,
  role: Role,
  displayName?: string,
) {
  const hash = await bcrypt.hash(plainPassword, 10);
  const [res] = await db.query(
    "INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)",
    [username, hash, role, displayName || null],
  );
  // @ts-ignore
  return { id: res.insertId, username, role, displayName };
}

/* ==============
   verifyCredentials (optional)
   ============== */
export async function verifyCredentials(username: string, plain: string) {
  const u = await findUserByUsername(username);
  if (!u) return null;
  const ok = await bcrypt.compare(plain, u.password_hash);
  if (!ok) return null;
  return u;
}

/* =========================
   LOGIN USER (UPDATED)
   ========================= */
export async function loginUser(username: string, password: string) {
  const row = await findUserByUsername(username);
  if (!row) return null;

  const match = await bcrypt.compare(password, row.password_hash);
  if (!match) return null;

  let kelasId: number | null = null;

  // 🔎 Jika user adalah siswa, cari kelas_id dari tabel students
  if (row.role === "siswa") {
    try {
      // 1️⃣ coba cari berdasarkan user_id (jika relasi tersedia)
      const [r1]: any = await db.query(
        "SELECT kelas_id FROM students WHERE user_id = ? LIMIT 1",
        [row.id],
      );

      if (r1 && r1.length) {
        kelasId = r1[0].kelas_id ?? null;
      } else {
        // 2️⃣ fallback: jika username = nis siswa
        const [r2]: any = await db.query(
          "SELECT kelas_id FROM students WHERE nis = ? LIMIT 1",
          [row.username],
        );

        if (r2 && r2.length) {
          kelasId = r2[0].kelas_id ?? null;
        }
      }
    } catch (err) {
      console.warn("Lookup kelas_id gagal:", err);
    }
  }

  // 🧠 Payload JWT
  const payload: any = {
    id: row.id,
    username: row.username,
    role: row.role as Role,
    displayName: row.display_name ?? null,
  };

  if (kelasId !== null) {
    payload.kelas_id = kelasId;
  }

  const options: SignOptions = { expiresIn: JWT_EXPIRES as any };
  const token = jwt.sign(payload, JWT_SECRET, options);

  return {
    id: row.id,
    username: row.username,
    role: row.role as Role,
    displayName: row.display_name ?? null,
    kelas_id: kelasId,
    token,
  };
}

/* =========================
   JWT verify (UPDATED TYPE)
   ========================= */
export function verifyToken(token: string) {
  try {
    return jwt.verify(token, JWT_SECRET) as {
      id: number;
      username: string;
      role: Role;
      displayName?: string | null;
      kelas_id?: number | null;
    };
  } catch {
    return null;
  }
}

/* =========================
   CHANGE PASSWORD
   ========================= */
// Ganti password akun sendiri. Independen dari relasi siswa-kelas-absensi —
// murni cek password_hash lama lewat bcrypt lalu update dengan hash baru.
// Dipakai oleh siapa pun yang sedang login (tidak dibatasi role tertentu),
// karena kolom password_hash ada di tabel users, bukan di tabel per-role.
export async function changePassword(
  userId: number,
  oldPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await findUserById(userId);

  if (!user) {
    return { ok: false, error: "Akun tidak ditemukan" };
  }

  const match = await bcrypt.compare(oldPassword, user.password_hash);

  if (!match) {
    return { ok: false, error: "Password lama salah" };
  }

  const newHash = await bcrypt.hash(newPassword, 10);

  await db.query("UPDATE users SET password_hash = ? WHERE id = ?", [
    newHash,
    userId,
  ]);

  return { ok: true };
}
