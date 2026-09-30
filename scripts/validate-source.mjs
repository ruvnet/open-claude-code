// Parse recovered source only. Never link, import, evaluate, or execute it.
import vm from 'node:vm';
let input = '';
for await (const chunk of process.stdin) input += chunk;
try {
  const sources = JSON.parse(input);
  if (!Array.isArray(sources) || !sources.length) throw new Error('No source modules');
  for (const { name, source, format } of sources) {
    try {
    if (format === 'module') new vm.SourceTextModule(source, { identifier: name });
    else if (format === 'commonjs') new vm.Script(`(function(exports,require,module,__filename,__dirname){\n${source.replace(/^#![^\n]*/, '')}\n})`, { filename: name });
    else throw new Error(`Unsupported source format: ${format}`);
    } catch (error) { throw new Error(`${name}: ${error.message}`); }
  }
  process.stdout.write(JSON.stringify({ valid: true, modules: sources.length }));
} catch (error) { console.error(`Source syntax validation failed: ${error.message}`); process.exitCode = 1; }
