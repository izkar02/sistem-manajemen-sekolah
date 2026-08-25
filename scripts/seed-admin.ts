// scripts/seed-admin.ts
import { createPool } from "mysql2/promise";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
dotenv.config();

const {
  DB_HOST = "127.0.0.1",
  DB_PORT = "3306",
  DB_USER = "root",
  DB_PASSWORD = "",
  DB_NAME = "sistem_manajemen_sekolah",
} = process.env;

async function main() {
  const pool = createPool({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  const username = process.argv[2] || "admin";
  const password = process.argv[3] || "admin123";
  const displayName = "administrator";

  const [existsRows] = await pool.query(
    "SELECT id FROM users WHERE username = ?",
    [username],
  );
  if ((existsRows as any[]).length) {
    console.log("User already exists:", username);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 10);
  const [res] = await pool.query(
    "INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)",
    [username, hash, "admin", displayName],
  );
  console.log("Admin created:", username);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
