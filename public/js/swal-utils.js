// public/js/swal-utils.js
// Helper bersama untuk menampilkan SweetAlert2 di semua halaman
// (admin, guru, kepala sekolah, siswa). Dipakai sebagai pengganti
// alert() / confirm() bawaan browser.

/**
 * Notifikasi sukses (modal, perlu klik OK).
 * Dipakai setelah aksi tambah / edit / hapus data berhasil.
 */
export function successAlert(text, title = "Berhasil") {
  return Swal.fire({
    icon: "success",
    title,
    text,
    confirmButtonText: "OK",
    confirmButtonColor: "#2563eb",
  });
}

/**
 * Notifikasi gagal / error (modal, perlu klik OK).
 */
export function errorAlert(text, title = "Gagal") {
  return Swal.fire({
    icon: "error",
    title,
    text,
    confirmButtonText: "OK",
    confirmButtonColor: "#dc2626",
  });
}

/**
 * Notifikasi peringatan umum (bukan error, bukan konfirmasi).
 * Pengganti alert("...") untuk validasi form dsb.
 */
export function warningAlert(text, title = "Perhatian") {
  return Swal.fire({
    icon: "warning",
    title,
    text,
    confirmButtonText: "OK",
    confirmButtonColor: "#2563eb",
  });
}

/**
 * Konfirmasi sebelum menghapus data.
 * Return: Promise<boolean> — true jika user menekan "Ya, hapus".
 * Pengganti: if (!confirm("Hapus ...?")) return;
 */
export async function confirmDelete(
  text = "Data yang dihapus tidak dapat dikembalikan.",
  title = "Hapus data ini?",
) {
  const result = await Swal.fire({
    icon: "warning",
    title,
    text,
    showCancelButton: true,
    confirmButtonText: "Ya, hapus",
    cancelButtonText: "Batal",
    confirmButtonColor: "#dc2626",
    cancelButtonColor: "#6b7280",
    reverseButtons: true,
  });
  return result.isConfirmed;
}

/**
 * Konfirmasi umum (bukan khusus hapus), misalnya "tetap lanjutkan?".
 * Return: Promise<boolean>
 * Pengganti: confirm("...")
 */
export async function confirmAction(text, title = "Konfirmasi") {
  const result = await Swal.fire({
    icon: "question",
    title,
    text,
    showCancelButton: true,
    confirmButtonText: "Ya, lanjutkan",
    cancelButtonText: "Batal",
    confirmButtonColor: "#2563eb",
    cancelButtonColor: "#6b7280",
    reverseButtons: true,
  });
  return result.isConfirmed;
}
