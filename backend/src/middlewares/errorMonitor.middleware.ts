import { NextFunction, Request, Response } from 'express';

export interface TelemetryEvent {
  id: string;
  source: 'BACKEND' | 'FRONTEND_POS' | 'SYNC_ENGINE';
  severity: 'ERROR' | 'WARN' | 'INFO';
  message: string;
  code?: string;
  path?: string;
  method?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

const MAX_EVENTS = 100;
const recentEvents: TelemetryEvent[] = [];

export class ErrorMonitorService {
  static capture(event: Omit<TelemetryEvent, 'id' | 'createdAt'>): TelemetryEvent {
    const entry: TelemetryEvent = {
      id: `err-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      createdAt: new Date().toISOString(),
      ...event,
    };

    recentEvents.unshift(entry);
    if (recentEvents.length > MAX_EVENTS) {
      recentEvents.length = MAX_EVENTS;
    }

    const sentryDsn = process.env.SENTRY_DSN?.trim();
    if (sentryDsn && sentryDsn.startsWith('http')) {
      fetch(sentryDsn, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).catch(() => {
        // Non-blocking external error telemetry webhook
      });
    }

    return entry;
  }

  static getRecentEvents(limit = 50): TelemetryEvent[] {
    return recentEvents.slice(0, Math.max(1, Math.min(MAX_EVENTS, limit)));
  }

  static clearEvents(): void {
    recentEvents.length = 0;
  }
}

export function globalErrorMonitorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const message = err instanceof Error ? err.message : 'Unhandled server error';
  const tracked = ErrorMonitorService.capture({
    source: 'BACKEND',
    severity: 'ERROR',
    message,
    path: req.originalUrl,
    method: req.method,
    userId: req.user?.userId,
  });

  if (res.headersSent) {
    next(err);
    return;
  }

  res.status(500).json({
    success: false,
    message: 'حدث خطأ داخلي في الخادم وتم تسجيله في نظام المراقبة',
    errorId: tracked.id,
  });
}

