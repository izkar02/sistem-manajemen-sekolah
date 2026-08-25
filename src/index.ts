// src/index.ts
import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { scheduleRouter } from "./routes/schedule";
import { authRoutes } from "./routes/auth"; // pastikan ada named export ini
import { adminDataRouter, publicDataRouter } from "./routes/adminData";
import { attendanceRouter } from "./routes/attendance";
import { academicPeriodsRouter } from "./routes/academicPeriods";
import { studentSelfRouter } from "./routes/studentSelf";

const app = new Elysia()
  // Serve static files dari folder 'public'
  .use(
    staticPlugin({
      assets: "./public",
      prefix: "", // File bisa diakses langsung dari root
    }),
  )

  // Mount auth routes (pastikan authRouter kompatibel, lihat catatan di bawah)
  .use(authRoutes)

  // API routes (schedule)
  .use(scheduleRouter)

  //API routes (halaman admin)
  .use(adminDataRouter)

  //API routes (halaman public)
  .use(publicDataRouter)

  //API absensi ()
  .use(attendanceRouter)

  //API periode semester
  .use(academicPeriodsRouter)

  //API self-service siswa (profil + riwayat absensi milik sendiri)
  .use(studentSelfRouter)

  // Route untuk homepage (root) — kembalikan file index.html
  .get("/", () => {
    return Bun.file("./public/login.html");
  })

  .listen(Number(process.env.PORT) || 3000);

console.log(`🚀 Server running at http://localhost:${app.server?.port}`);
