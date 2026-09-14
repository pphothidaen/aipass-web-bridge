const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(checkFile, options = {}) {
  const fileReader = options.readFile || fs.readFileSync;
  const exec = options.execSync || execSync;

  const content = fileReader(checkFile, 'utf-8');
  const prompt = content.split('---').slice(2).join('---').trim();

  const corePath = path.join(__dirname, '../core/aipass-bridge');
  const diff = exec('git diff origin/main...HEAD', { encoding: 'utf-8' });

  const fullPrompt = `${prompt}\n\n--- DIFF ---\n${diff}`;
  const escaped = fullPrompt.replace(/"/g, '\\"').slice(0, 4000); // กันยาวเกิน

  const result = exec(
    `npm run chat -- --message "${escaped}"`,
    { cwd: corePath, encoding: 'utf-8' }
  );

  return result;
}

if (require.main === module) {
  const checkFile = process.argv[2];
  if (!checkFile) {
    console.error('Usage: node run-check.js <check-file>');
    process.exit(1);
  }
  const result = run(checkFile);
  console.log(result);
  process.exit(result && result.includes('FAIL:') ? 1 : 0);
}

module.exports = { run };