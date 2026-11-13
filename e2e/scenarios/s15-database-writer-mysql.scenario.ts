// S15: a Database Writer inserts into a MySQL database.
// Gap doc 12 rank 1: Database connectors pointed at Oracle, SQL Server or
// MySQL. Needs MySQL: docker compose -f docker/docker-compose.yml --profile test up -d mysql-test

import { expect } from '@playwright/test';
import mysql from 'mysql2/promise';
import { channelExport, tcpListener, dbWriter } from './support/mirth-xml.js';
import { sendMllp } from './support/net.js';
import { scenario, mirthId } from './support/scenario.js';

const PORT = 16615;
const MYSQL = { host: '127.0.0.1', port: 3307, user: 'mirth', password: 'mirthpw', database: 'partner' } as const;

async function mysqlQuery<T>(text: string): Promise<T[]> {
  const conn = await mysql.createConnection(MYSQL);
  try {
    const [rows] = await conn.query(text);
    return rows as T[];
  } finally {
    await conn.end();
  }
}

scenario('S15 Database Writer inserts rows into MySQL', async (api) => {
  await mysqlQuery('DROP TABLE IF EXISTS s15_results');
  await mysqlQuery('CREATE TABLE s15_results (accession VARCHAR(64) NOT NULL, impression TEXT NOT NULL)');

  await api.importAndDeploy(channelExport({
    id: mirthId(15),
    name: 'S15 Results to MySQL',
    source: {
      name: 'sourceConnector',
      ...tcpListener(PORT),
      inbound: 'HL7V2',
      steps: [{
        name: 'Fields',
        script: [
          "$c('accession', msg.get('OBR.2'));",
          "$c('impression', msg.get('OBX.5'));",
        ].join('\n'),
      }],
    },
    destinations: [{
      name: 'Results DB',
      ...dbWriter({ driver: 'com.mysql.cj.jdbc.Driver', url: `jdbc:mysql://${MYSQL.host}:${String(MYSQL.port)}/${MYSQL.database}`, username: MYSQL.user, password: MYSQL.password },
        'INSERT INTO s15_results (accession, impression) VALUES (${accession}, ${impression})'),
    }],
  }), ['S15 Results to MySQL']);

  await sendMllp(PORT, 'MSH|^~\\&|EXA|S|VNS|V|20261110120000||ORU^R01|S15|P|2.4\rOBR|1|ACC015|\rOBX|1|TX|IMP||Mild degenerative change');
  await expect.poll(() => mysqlQuery<{ accession: string; impression: string }>('SELECT accession, impression FROM s15_results'), { timeout: 15_000 })
    .toEqual([{ accession: 'ACC015', impression: 'Mild degenerative change' }]);
});
