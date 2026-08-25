import { Elysia } from "elysia";
import { db } from "../db";
import { verifyToken } from "../services/auth";

function getTokenFromHeaders(headers: any) {
  const cookie = (headers.cookie as string) ?? "";
  const m = cookie.match(/token=([^;]+)/);
  if (m) return m[1];
  if (headers.authorization)
    return (headers.authorization as string).replace("Bearer ", "");
  return null;
}

export const academicPeriodsRouter = new Elysia({
  prefix: "/api/academic-periods",
})

  // semua semester
  .get("/", async ({ headers, set }) => {
    const token = getTokenFromHeaders(headers);
    const payload: any = token ? verifyToken(token) : null;

    if (!payload) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const [rows] = await db.query(
      `
    SELECT *
    FROM academic_periods
    ORDER BY tanggal_mulai DESC
    `,
    );

    return rows;
  })

  // semester aktif
  .get("/active", async ({ headers, set }) => {
    const token = getTokenFromHeaders(headers);
    const payload: any = token ? verifyToken(token) : null;

    if (!payload) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const [rows]: any = await db.query(
      `
    SELECT *
    FROM academic_periods
    WHERE is_active = 1
    LIMIT 1
    `,
    );

    if (!rows.length) {
      set.status = 404;

      return {
        error: "Tidak ada semester aktif",
      };
    }

    return rows[0];
  })

  // buat periode semester baru
  .post("/", async ({ body, headers, set }) => {
    try {
      const token = getTokenFromHeaders(headers);
      const payload: any = token ? verifyToken(token) : null;

      if (!payload || payload.role !== "admin") {
        set.status = 403;
        return { error: "Forbidden" };
      }

      if (!body || typeof body !== "object") {
        set.status = 400;
        return {
          error:
            "Request body diperlukan (isi data yang dibutuhkan terlebih dahulu)",
        };
      }

      const { nama, semester, tanggal_mulai, tanggal_selesai } = body as {
        nama?: string;
        semester?: string;
        tanggal_mulai?: string;
        tanggal_selesai?: string;
      };

      if (!nama || !semester || !tanggal_mulai || !tanggal_selesai) {
        set.status = 400;

        return {
          error: "Data semester tidak lengkap",
        };
      }

      const [result]: any = await db.query(
        `
      INSERT INTO academic_periods (
        nama,
        semester,
        tanggal_mulai,
        tanggal_selesai,
        is_active
      )
      VALUES (?, ?, ?, ?, 0)
      `,
        [nama, semester, tanggal_mulai, tanggal_selesai],
      );

      return {
        success: true,
        id: result.insertId,
      };
    } catch (err) {
      console.error(err);

      set.status = 500;

      return {
        error: "Internal Server Error",
      };
    }
  })

  // aktivasi semester
  .put("/:id/activate", async ({ params, headers, set }) => {
    const token = getTokenFromHeaders(headers);
    const payload: any = token ? verifyToken(token) : null;

    if (!payload || payload.role !== "admin") {
      set.status = 403;
      return { error: "Forbidden" };
    }

    const conn = await db.getConnection();

    try {
      await conn.beginTransaction();

      await conn.query(
        `
      UPDATE academic_periods
      SET is_active = 0
      `,
      );

      const [result]: any = await conn.query(
        `
      UPDATE academic_periods
      SET is_active = 1
      WHERE id = ?
      `,
        [params.id],
      );

      if (result.affectedRows === 0) {
        await conn.rollback();

        set.status = 404;

        return {
          error: "Semester tidak ditemukan",
        };
      }

      await conn.commit();

      return {
        success: true,
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
  });
