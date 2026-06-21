import cors from 'cors';
import express from 'express';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import { isGcsUri, storage } from './services/storage.js';
import authRouter from './routes/auth.js';
import examsRouter from './routes/exams.js';
import scriptsRouter from './routes/scripts.js';
import marksRouter from './routes/marks.js';
import aiRouter from './routes/ai.js';
import adminRouter from './routes/admin.js';

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '4mb' }));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'marker-api', version: '0.1.0' });
});

app.use('/auth', authRouter);
app.use('/admin/v1', adminRouter);
// Mount routers with specific paths (/my-exams, /clips/*, /exams/*, /marks, /compare)
// before examsRouter, whose greedy `/:id` would otherwise shadow them.
app.use('/api/v1', scriptsRouter);
app.use('/api/v1', marksRouter);
app.use('/api/v1', aiRouter);
app.use('/api/v1', examsRouter);

// `/files/?u=<uri>` — resolve storage URI to bytes (GCS: 302 redirect; local: stream)
app.get('/files/', async (req, res, next) => {
  try {
    const uri = String(req.query.u ?? '');
    if (!uri) { res.status(400).json({ error: 'Missing u param', code: 'BAD_REQUEST' }); return; }
    if (isGcsUri(uri)) {
      const signed = await storage.publicUrl(uri);
      res.redirect(302, signed); return;
    }
    if (!existsSync(uri)) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
    const stat = statSync(uri);
    const ext = uri.toLowerCase();
    const ct = ext.endsWith('.pdf') ? 'application/pdf' : ext.endsWith('.jpg') || ext.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Cache-Control', 'private, max-age=300');
    createReadStream(uri).pipe(res);
  } catch (err) {
    next(err);
  }
});

if (config.storageBackend === 'local' && existsSync(config.storageDir)) {
  app.use('/files', express.static(config.storageDir));
}

// SPA fallback
const frontendDist = resolve(process.cwd(), '..', 'frontend', 'dist');
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get(/^\/(?!(api|admin|files|health|auth)).*/, (_req, res) => {
    res.sendFile(resolve(frontendDist, 'index.html'));
  });
}

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`marker-api listening on :${config.port}`);
});
