import { verifyToken } from "../services/auth";
import type { Role } from "../models/role";

export const authorize =
  (roles?: Role[]) =>
  ({ headers, set }: any) => {
    const auth = headers.authorization;

    if (!auth) {
      set.status = 401;
      return { message: "Unauthorized" };
    }

    const token = auth.replace("Bearer ", "");
    const payload = verifyToken(token);

    if (!payload) {
      set.status = 401;
      return { message: "Invalid token" };
    }

    if (roles && !roles.includes(payload.role)) {
      set.status = 403;
      return { message: "Forbidden" };
    }

    // simpan user ke context
    return { user: payload };
  };
