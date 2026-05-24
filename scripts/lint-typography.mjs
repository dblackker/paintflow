#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const scanRoots = ['apps/web/src/pages', 'apps/web/src/components'];
const extensions = new Set(['.astro', '.tsx', '.jsx']);
const ignoredPathFragments = [
  'apps/web/src/pages/dev/design-system.astro',
];

function lastArg(prefix) {
  return process.argv.filter((arg) => arg.startsWith(prefix)).at(-1);
}

const maxWarningsArg = lastArg('--max-warnings=');
const maxWarnings = maxWarningsArg ? Number(maxWarningsArg.split('=')[1]) : Number.POSITIVE_INFINITY;
const baselineArg = lastArg('--baseline=');
const baseline = baselineArg ? Number(baselineArg.split('=')[1]) : null;
const printLimitArg = lastArg('--print-limit=');
const printLimit = printLimitArg ? Number(printLimitArg.split('=')[1]) : 80;
const verbose = process.argv.includes('--verbose');

const typographyTokens = [
  /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)$/,
  /^font-(medium|semibold|bold|black)$/,
  /^leading-(none|tight|snug|normal|relaxed|loose|\d+)$/,
  /^tracking-(tighter|tight|normal|wide|wider|widest)$/,
  /^uppercase$/,
];

const preferredRoles = [
  'pf-kicker',
  'pf-page-title',
  'pf-page-copy',
  'pf-section-title',
  'pf-row-title',
  'pf-copy',
  'pf-meta',
  'pf-metric-label',
  'pf-metric-value',
  'pf-table-heading',
];

const allowedClassFragments = [
  'pf-',
  'time-',
  'btn-',
  'form-label',
  'form-helper',
  'form-hint',
  'input',
  'chip',
  'status',
  'badge',
  'sr-only',
  'font-mono',
  'material-symbol',
  'leaflet-',
  'rounded-full',
];

const allowedTags = new Set(['button', 'input', 'select', 'textarea', 'option', 'svg', 'path', 'canvas']);
const watchedTags = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'span', 'div', 'a', 'summary', 'th', 'td']);

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath));
    } else if (extensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function lineForOffset(text, offset) {
  return text.slice(0, offset).split(/\r?\n/).length;
}

function hasTypographyUtility(classValue) {
  return classValue
    .split(/\s+/)
    .map((token) => token.replace(/^(sm|md|lg|xl|2xl):/, ''))
    .some((token) => typographyTokens.some((pattern) => pattern.test(token)));
}

function hasPreferredRole(classValue) {
  return preferredRoles.some((role) => classValue.split(/\s+/).includes(role));
}

function hasAllowedFragment(classValue) {
  return allowedClassFragments.some((fragment) => classValue.includes(fragment));
}

function suggestionFor(classValue) {
  if (/\btext-(2xl|3xl|4xl|5xl)\b/.test(classValue)) return 'Use pf-page-title for page-level titles.';
  if (/\buppercase\b/.test(classValue) || /\btracking-(wide|wider|widest)\b/.test(classValue)) return 'Use pf-kicker, pf-metric-label, or pf-table-heading for uppercase metadata.';
  if (/\btext-xs\b/.test(classValue)) return 'Use pf-meta or pf-table-heading for small support text.';
  if (/\bfont-(semibold|bold)\b/.test(classValue)) return 'Use pf-section-title or pf-row-title for bold labels/headings.';
  return 'Use the pf-* typography roles from design-system.css.';
}

function lintFile(filePath, source) {
  const warnings = [];
  const attrPattern = /<([A-Za-z][\w:-]*)\b[^>]*(?:class|className)=["']([^"']*)["']/g;
  let match;
  while ((match = attrPattern.exec(source))) {
    const tag = match[1].toLowerCase();
    const classValue = match[2];
    if (!watchedTags.has(tag) || allowedTags.has(tag)) continue;
    if (!hasTypographyUtility(classValue)) continue;
    if (hasPreferredRole(classValue) || hasAllowedFragment(classValue)) continue;
    warnings.push({
      file: filePath,
      line: lineForOffset(source, match.index),
      tag,
      classValue,
      suggestion: suggestionFor(classValue),
    });
  }
  return warnings;
}

const files = (await Promise.all(scanRoots.map((dir) => listFiles(path.join(root, dir))))).flat();
const warnings = [];
for (const file of files) {
  const relativeFile = path.relative(root, file).replaceAll(path.sep, '/');
  if (ignoredPathFragments.some((fragment) => relativeFile === fragment)) continue;
  const source = await readFile(file, 'utf8');
  warnings.push(...lintFile(path.relative(root, file), source));
}

const overBudget = Number.isFinite(maxWarnings) && warnings.length > maxWarnings;
const overBaseline = Number.isFinite(baseline) && warnings.length > baseline;
const shouldPrintDetails = verbose || overBudget || overBaseline;

if (shouldPrintDetails) {
  const limited = warnings.slice(0, printLimit);
  for (const warning of limited) {
    const message = `Ad hoc typography on <${warning.tag}>. ${warning.suggestion} Classes: ${warning.classValue}`;
    if (process.env.GITHUB_ACTIONS) {
      console.log(`::warning file=${warning.file},line=${warning.line},title=Typography role::${message}`);
    } else {
      console.warn(`${warning.file}:${warning.line} ${message}`);
    }
  }

  if (warnings.length > printLimit) {
    console.warn(`... ${warnings.length - printLimit} additional typography warnings hidden. Re-run with --verbose --print-limit=${warnings.length} to see all.`);
  }
}

const budgetCopy = Number.isFinite(baseline)
  ? ` Baseline budget: ${baseline}; ${warnings.length <= baseline ? `${baseline - warnings.length} warning${baseline - warnings.length === 1 ? '' : 's'} under budget.` : `${warnings.length - baseline} over budget.`}`
  : '';
console.log(`Typography lint: ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.${budgetCopy} Prefer ${preferredRoles.join(', ')}. Use --verbose for details.`);

if (overBaseline) {
  console.error(`Typography lint failed: ${warnings.length} warnings exceeds baseline ${baseline}. Replace ad hoc text classes with pf-* roles or update the baseline after an intentional audit.`);
  process.exit(1);
}

if (overBudget) {
  console.error(`Typography lint failed: ${warnings.length} warnings exceeds --max-warnings=${maxWarnings}.`);
  process.exit(1);
}
