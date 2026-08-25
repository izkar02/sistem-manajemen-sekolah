import { db } from "../db";

export async function getTeacherByUserId(userId: number) {
  const [rows] = await db.query(
    `
    SELECT
      id,
      nama,
      teacher_type
    FROM teachers
    WHERE user_id = ?
    LIMIT 1
    `,
    [userId],
  );

  return (rows as any[])[0] ?? null;
}
