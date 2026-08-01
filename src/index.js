const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const { failure, success } = require('./response');
const userRoutes = require('./routes/users');
const authRoutes = require('./routes/auth');
const menuRoutes = require('./routes/menus');

const app = express();
const port = process.env.PORT || 3000;

if (!process.env.JWT_SECRET) {
  throw new Error('Missing JWT_SECRET environment variable');
}

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const sensitiveFields = new Set([
  'authorization',
  'cookie',
  'password',
  'token',
  'access_token',
  'refresh_token',
]);

function redactSensitiveData(value) {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveData);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveFields.has(key.toLowerCase()) ? '[REDACTED]' : redactSensitiveData(item),
      ]),
    );
  }

  return value;
}

app.use((req, res, next) => {
  console.log('[request]', {
    time: new Date().toISOString(),
    host: req.get('host'),
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    headers: redactSensitiveData(req.headers),
    query: redactSensitiveData(req.query),
    body: redactSensitiveData(req.body),
  });

  next();
});
app.use(authRoutes);
app.use(userRoutes);
app.use(menuRoutes);

app.get('/health', (req, res) => success(res, { status: 'ok' }));

app.use((req, res) => failure(res, 404, '接口不存在'));

app.use((error, req, res, next) => {
  console.error(error);
  return failure(res, 500, '服务器内部错误');
});

app.listen(port, () => {
  console.log(`服务运行在：http://localhost:${port}`);
});
