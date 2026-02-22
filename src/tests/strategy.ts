import chalk from 'chalk';
import { calculateIL, crossoverDecision } from '../utils/strategy';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

async function test(name: string, fn: () => Promise<void>) {
  process.stdout.write(`  ${name}… `);
  try {
    await fn();
    console.log(chalk.green('✔ PASS'));
  } catch (err) {
    console.log(chalk.red(`✘ FAIL: ${err}`));
    process.exitCode = 1;
  }
}

async function main() {
  console.log(chalk.cyan('\n🧪 Strategy unit tests\n'));

  await test('IL formula baseline', async () => {
    const il = calculateIL(1, 1);
    assert(Math.abs(il) < 1e-9, 'IL should be 0 at equal ratio');
  });

  await test('IL magnitude increases with ratio deviation (loss is negative)', async () => {
    const ilUp = calculateIL(1, 1.2);
    const ilDown = calculateIL(1, 0.8);
    assert(ilUp < 0, 'IL should be negative when ratio increases');
    assert(ilDown < 0, 'IL should be negative when ratio decreases');
    assert(Math.abs(ilUp) > 0 && Math.abs(ilDown) > 0, 'IL magnitude should be > 0');
  });

  await test('BUY on bullish crossover and momentum', async () => {
    const decision = crossoverDecision(10, 9, 0.6, 0.5, 'none', 0);
    assert(decision === 'BUY', 'Should BUY');
  });

  await test('SELL on stop-loss', async () => {
    const decision = crossoverDecision(9, 10, -0.6, 0.5, 'long', -2.5);
    assert(decision === 'SELL', 'Should SELL on stop-loss');
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
