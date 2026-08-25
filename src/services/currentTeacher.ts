import { verifyToken } from "./auth";
import { getTeacherByUserId } from "./teacher";

export async function getCurrentTeacher(headers: any) {
  const cookie = headers.cookie ?? "";

  const match = cookie.match(/token=([^;]+)/);

  let token = match ? match[1] : null;

  if (!token && headers.authorization) {
    token = headers.authorization.replace("Bearer ", "");
  }

  if (!token) {
    return null;
  }

  const payload = verifyToken(token);

  if (!payload) {
    return null;
  }

  if (payload.role !== "guru") {
    return null;
  }

  const teacher = await getTeacherByUserId(payload.id);

  if (!teacher) {
    return null;
  }

  return {
    user: payload,
    teacher,
  };
}

/**
 * Khusus endpoint LAPORAN/REKAP absensi (read-only) yang boleh diakses
 * oleh guru (data miliknya sendiri) MAUPUN kepala sekolah (lintas kelas/guru).
 *
 * - role "guru"   -> { role: "guru", teacher: {...} }  (perilaku sama seperti getCurrentTeacher)
 * - role "kepala" -> { role: "kepala", teacher: null }  (tidak ada baris di tabel teachers)
 * - role lain / token tidak valid -> null
 *
 * JANGAN dipakai untuk endpoint yang menulis data (buat/ubah/hapus sesi absensi) —
 * untuk itu tetap pakai getCurrentTeacher agar hanya guru yang bisa akses.
 */
export async function getCurrentReportViewer(headers: any) {
  const cookie = headers.cookie ?? "";

  const match = cookie.match(/token=([^;]+)/);

  let token = match ? match[1] : null;

  if (!token && headers.authorization) {
    token = headers.authorization.replace("Bearer ", "");
  }

  if (!token) {
    return null;
  }

  const payload = verifyToken(token);

  if (!payload) {
    return null;
  }

  if (payload.role === "guru") {
    const teacher = await getTeacherByUserId(payload.id);

    if (!teacher) {
      return null;
    }

    return {
      user: payload,
      role: "guru" as const,
      teacher,
    };
  }

  if (payload.role === "kepala") {
    return {
      user: payload,
      role: "kepala" as const,
      teacher: null as any,
    };
  }

  return null;
}
