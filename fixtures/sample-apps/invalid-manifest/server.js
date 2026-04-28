import http from 'node:http';

http
  .createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  })
  .listen(3000, '0.0.0.0');
