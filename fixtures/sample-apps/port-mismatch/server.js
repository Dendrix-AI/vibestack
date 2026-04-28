import http from 'node:http';

const port = Number(process.env.PORT ?? 4000);
http
  .createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  })
  .listen(port, '0.0.0.0');
