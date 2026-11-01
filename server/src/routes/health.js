import { Router } from 'express';
import mongoose from 'mongoose';
import env from '../config/env.js';
import { APP_NAME } from '../config/constants.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'OK',
    data: {
      app: APP_NAME,
      status: 'up',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      env: env.nodeEnv,
    },
  });
});

healthRouter.get('/live', (_req, res) => {
  res.json({ success: true, message: 'Live', data: { timestamp: new Date().toISOString() } });
});

export const readyRouter = Router();

readyRouter.get('/', async (_req, res) => {
  const dbState = mongoose.connection.readyState; // 0=disconnected 1=connected 2=connecting 3=disconnecting
  const ready = dbState === 1;
  res.status(ready ? 200 : 503).json({
    success: ready,
    message: ready ? 'Ready' : 'Database not ready',
    data: {
      db: ['disconnected', 'connected', 'connecting', 'disconnecting'][dbState],
      timestamp: new Date().toISOString(),
    },
  });
});

export default healthRouter;
