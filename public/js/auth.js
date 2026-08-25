// public/js/auth.js
const form = document.getElementById("loginForm");
const msg = document.getElementById("msg");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "";
  const data = new FormData(form);
  const body = {
    username: data.get("username"),
    password: data.get("password"),
  };

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include", // important to receive http-only cookie
    });

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch (err) {
      msg.textContent = text || "Server returned non-JSON response";
      return;
    }

    if (!res.ok) {
      msg.textContent = json.error || "Login gagal";
      return;
    }

    // success: backend returns role in root
    const role = json.role;
    if (role === "admin") window.location.href = "/admin.html";
    else if (role === "kepala") window.location.href = "/kepala-sekolah.html";
    else if (role === "guru") window.location.href = "/guru.html";
    else if (role === "siswa") window.location.href = "/siswa.html";
    else window.location.href = "/";
  } catch (err) {
    console.error(err);
    msg.textContent = "Terjadi kesalahan, coba lagi.";
  }
});
