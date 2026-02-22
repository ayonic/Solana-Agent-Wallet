import * as http from 'http';

class Metrics {
  totalTx = 0;
  confirmedTx = 0;
  failedTx = 0;
  agentCycles: Record<string, number> = {};
  balances: Record<string, number> = {};
  errors = 0;

  incTx(status: 'confirmed' | 'failed') {
    this.totalTx++;
    if (status === 'confirmed') this.confirmedTx++;
    else this.failedTx++;
  }
  setBalance(agentId: string, sol: number) {
    this.balances[agentId] = sol;
  }
  incCycle(agentId: string) {
    this.agentCycles[agentId] = (this.agentCycles[agentId] || 0) + 1;
  }
  incError() {
    this.errors++;
  }
  toPrometheus(): string {
    const lines: string[] = [];
    lines.push(`agent_total_tx ${this.totalTx}`);
    lines.push(`agent_confirmed_tx ${this.confirmedTx}`);
    lines.push(`agent_failed_tx ${this.failedTx}`);
    lines.push(`agent_errors ${this.errors}`);
    for (const [id, c] of Object.entries(this.agentCycles)) {
      lines.push(`agent_cycles{agent="${id}"} ${c}`);
    }
    for (const [id, b] of Object.entries(this.balances)) {
      lines.push(`agent_balance_sol{agent="${id}"} ${b}`);
    }
    return lines.join('\n') + '\n';
  }
}

export const metrics = new Metrics();

export function startMetricsServer(port: number) {
  const server = http.createServer((req, res) => {
    if (req.url === '/metrics') {
      const body = metrics.toPrometheus();
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(body);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port);
  return server;
}
