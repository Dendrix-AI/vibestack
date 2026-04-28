import Fastify from 'fastify';

const app = Fastify();
const port = Number(process.env.PORT ?? 3000);

app.get('/', async () => ({
  ok: true,
  app: 'vibestack-node-basic',
  dataDir: process.env.VIBESTACK_DATA_DIR ?? null,
  postgresConfigured: Boolean(process.env.DATABASE_URL)
}));

await app.listen({ host: '0.0.0.0', port });
