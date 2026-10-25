import { startMcp } from './mcp';
const index = process.argv.indexOf('--discovery');
if (index >= 0 && !process.argv[index + 1]) throw new Error('--discovery requires a path');
startMcp(index >= 0 ? process.argv[index + 1] : undefined).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
