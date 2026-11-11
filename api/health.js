// GET /api/health: the Self-Heal v1 startup health check. Names missing config, never values,
// plus the deployed build. /selfheal.js calls it after load and reports a failure.
const { BUILD, healthProblems } = require('../lib/selfheal.js');

module.exports = function health(req, res) {
  const problems = healthProblems(process.env);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: problems.length === 0, problems, build: BUILD }));
};
