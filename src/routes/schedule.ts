// src/routes/schedule.ts
import { Elysia } from "elysia";
import { generateScheduleGA } from "../services/scheduler";
import { ScheduleRequest } from "../models/schedule";
import { verifyToken } from "../services/auth";

function getTokenFromHeaders(headers: any) {
  const cookie = (headers.cookie as string) ?? "";
  const m = cookie.match(/token=([^;]+)/);
  if (m) return m[1];
  if (headers.authorization)
    return (headers.authorization as string).replace("Bearer ", "");
  return null;
}

export const scheduleRouter = new Elysia({ prefix: "/api" }).post(
  "/generate",
  ({ body, headers, set }) => {
    const token = getTokenFromHeaders(headers);
    const payload: any = token ? verifyToken(token) : null;

    if (!payload || payload.role !== "admin") {
      set.status = 403;
      return { error: "Forbidden" };
    }

    const payloadBody = body as ScheduleRequest;

    const result = generateScheduleGA(payloadBody);

    return {
      ok: true,
      data: result,
    };
  },
);
