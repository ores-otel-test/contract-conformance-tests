import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

assert.equal(process.argv.length, 5, 'usage: typescript-adapter <corpus> <output> <zod-entry>');
const [corpusPath, outputPath, zodEntry] = process.argv.slice(2);
const { z } = await import(pathToFileURL(zodEntry).href);

const length = (value) => Array.from(value).length;
const contractString = (min, max) => z.string().superRefine((value, ctx) => {
  const size = length(value);
  if (size < min || size > max) ctx.addIssue({ code: 'custom', message: 'contract string length' });
});
const requestMeta = z.object({
  requestId: contractString(1, 128), traceId: contractString(1, 128),
  locale: contractString(2, 64).optional(),
}).strict();
const pageQuery = z.object({
  limit: z.number().int().min(1).max(100), cursor: contractString(1, 512).optional(),
}).strict();
const problemDetails = z.object({
  type: contractString(1, 512), title: contractString(1, 256),
  status: z.number().int().min(400).max(599), detail: contractString(0, 4096).optional(),
  requestId: contractString(1, 128),
}).strict();
const publicContract = z.union([requestMeta, pageQuery, problemDetails]);
const schemas = { RequestMeta: requestMeta, PageQuery: pageQuery, ProblemDetails: problemDetails,
  PublicValidationContract: publicContract };

const cases = JSON.parse(await readFile(corpusPath, 'utf8'));
const results = [];
for (const entry of cases) {
  const input = JSON.parse(entry.payload);
  const parsed = schemas[entry.model].safeParse(input);
  if (parsed.success) assert.deepStrictEqual(parsed.data, input, `Zod transformed ${entry.id}`);
  results.push({ caseId: entry.id, declaration: `Ores.Validation.${entry.model}`,
    verdict: parsed.success ? 'accepted' : 'rejected' });
}
const evidence = {
  id: 'typescript-zod', language: 'typescript', runtime: `node@${process.versions.node}`,
  validator: 'zod@4.5.4', toolchain: `node-json@${process.versions.node}`, status: 'passed', results,
};
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
