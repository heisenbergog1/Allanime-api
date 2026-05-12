exports = async (req, res) => {
  const { createServer } = await import('node:http');
  const { parse } = await import('node:url');
  const module = await import('./src/index.js');

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    const mockReq = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      on: (event, cb) => req.on(event, cb),
      once: (event, cb) => req.once(event, cb),
      end: () => req.end()
    };
    const mockRes = {
      setHeader: (k, v) => res.setHeader(k, v),
      statusCode: 200,
      end: (data) => res.end(data)
    };
    module.default(mockReq, mockRes);
  });

  server.listen(3000);
  return { statusCode: 200, body: 'ok' };
};