import type { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { pool } from "../db/pool";

type JwtUserPayload = {
  id?: string;
  user_id?: string;
  sub?: string;
};

let io: Server | null = null;

const getAllowedOrigins = () => {
  const raw = process.env.FRONTEND_ORIGIN || process.env.CORS_ORIGIN || "";
  const origins = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return origins.length ? origins : true;
};

export const initRealtime = (server: HttpServer) => {
  io = new Server(server, {
    cors: {
      origin: getAllowedOrigins(),
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const rawToken =
        socket.handshake.auth?.token || socket.handshake.headers?.authorization;

      const token = String(rawToken || "")
        .replace(/^Bearer\s+/i, "")
        .trim();

      const slug = String(socket.handshake.auth?.slug || "").trim();

      if (!token || !slug) {
        console.warn("[Socket] auth missing", {
          hasToken: Boolean(token),
          slug,
          auth: socket.handshake.auth,
        });

        return next(new Error("Unauthorized"));
      }

      if (!process.env.JWT_SECRET) {
        console.error("[Socket] JWT_SECRET missing");
        return next(new Error("Unauthorized"));
      }

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET,
      ) as JwtUserPayload;

      const userId = decoded.user_id || decoded.id || decoded.sub;

      if (!userId) {
        console.warn("[Socket] userId missing in token", {
          decoded,
        });

        return next(new Error("Unauthorized"));
      }

      const tenantResult = await pool.query(
        `
      SELECT id
      FROM tenants
      WHERE slug = $1
      LIMIT 1
      `,
        [slug],
      );

      const tenantId = tenantResult.rows?.[0]?.id;

      if (!tenantId) {
        console.warn("[Socket] tenant not found", {
          slug,
        });

        return next(new Error("Tenant not found"));
      }

      const userResult = await pool.query(
        `
      SELECT id
      FROM users
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL
      LIMIT 1
      `,
        [tenantId, userId],
      );

      if (!userResult.rows?.length) {
        console.warn("[Socket] user not found in tenant", {
          tenantId,
          userId,
          slug,
        });

        return next(new Error("User not found"));
      }

      socket.data.tenantId = tenantId;
      socket.data.userId = userId;
      socket.data.slug = slug;

      return next();
    } catch (error: any) {
      console.warn("[Socket] auth failed", {
        message: error?.message || error,
        slug: socket.handshake.auth?.slug,
      });

      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const { tenantId, userId, slug } = socket.data;

    socket.join(`tenant:${tenantId}`);
    socket.join(`user:${tenantId}:${userId}`);

    console.log("[Socket] connected", {
      socketId: socket.id,
      slug,
      tenantId,
      userId,
    });

    socket.emit("realtime:ready", {
      ok: true,
    });

    socket.on("disconnect", (reason) => {
      console.log("[Socket] disconnected", {
        socketId: socket.id,
        reason,
      });
    });
  });

  return io;
};

export const getRealtimeServer = () => io;

export const emitToUser = (
  tenantId: string,
  userId: string,
  eventName: string,
  payload?: Record<string, any>,
) => {
  if (!io || !tenantId || !userId) {
    console.warn("[Socket] emit skipped", {
      hasIo: Boolean(io),
      tenantId,
      userId,
      eventName,
    });

    return;
  }

  const room = `user:${tenantId}:${userId}`;
  const roomSize = io.sockets.adapter.rooms.get(room)?.size || 0;

  console.log("[Socket] emit", {
    room,
    roomSize,
    eventName,
    payload,
  });

  io.to(room).emit(eventName, {
    ...(payload || {}),
    at: new Date().toISOString(),
  });
};

export const emitMyDayRefresh = (
  tenantId: string,
  userId: string | null | undefined,
  reason: string,
  meta?: Record<string, any>,
) => {
  if (!tenantId || !userId) return;

  emitToUser(tenantId, userId, "my-day:refresh", {
    reason,
    ...(meta || {}),
  });
};
