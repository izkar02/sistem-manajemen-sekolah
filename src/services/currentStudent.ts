import { verifyToken } from "./auth";
import { getStudentByUserId, getStudentByNis } from "./student";

/**
 * "Siapa siswa yang login" — mirror dari getCurrentTeacher.
 *
 * PENTING: kelas_id di sini diambil FRESH dari tabel students,
 * bukan dari payload JWT. JWT hanya dipakai untuk mengetahui siapa
 * user-nya (payload.id) dan memastikan role-nya "siswa". Ini supaya
 * kalau admin mengubah kelas siswa setelah siswa login, data yang
 * dipakai (jadwal, riwayat absensi, dashboard) tetap akurat tanpa
 * siswa harus logout/login ulang untuk dapat token baru.
 */
export async function getCurrentStudent(headers: any) {
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
    console.warn("getCurrentStudent: token tidak valid/expired");
    return null;
  }

  if (payload.role !== "siswa") {
    console.warn(
      `getCurrentStudent: role "${payload.role}" bukan siswa (user_id=${payload.id})`,
    );
    return null;
  }

  // 1) coba cari via relasi students.user_id (jalur normal)
  let student = await getStudentByUserId(payload.id);

  // 2) fallback: sebagian akun siswa (hasil import massal) belum punya
  //    students.user_id ter-link, walau username-nya = NIS siswa.
  //    Ini pola yang sama dengan fallback di loginUser (services/auth.ts).
  if (!student && payload.username) {
    student = await getStudentByNis(payload.username);
    if (student) {
      console.warn(
        `getCurrentStudent: students.user_id belum ter-link untuk user_id=${payload.id} ` +
          `(username="${payload.username}") — dipulihkan lewat fallback NIS. ` +
          `Sebaiknya jalankan UPDATE students SET user_id=${payload.id} WHERE nis='${payload.username}'.`,
      );
    }
  }

  if (!student) {
    console.warn(
      `getCurrentStudent: data siswa tidak ditemukan sama sekali untuk user_id=${payload.id} ` +
        `(username="${payload.username}") — cek relasi students.user_id / students.nis.`,
    );
    return null;
  }

  return {
    user: payload,
    student,
  };
}
