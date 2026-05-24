#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const scanRoots = ['apps/web/src/pages', 'apps/web/src/components'];
const extensions = new Set(['.astro', '.tsx', '.jsx']);

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

const buttonRoles = [
  'btn-primary',
  'btn-secondary',
  'btn-text',
  'btn-icon',
  'btn-icon-filled',
  'btn-icon-tonal',
  'btn-icon-outlined',
  'btn-icon-danger',
  'btn-filled',
  'btn-tonal',
  'btn-outlined',
  'btn-elevated',
  'btn-compact',
];

const rawButtonTokens = [
  /^bg-/,
  /^hover:bg-/,
  /^text-(white|blue|red|green|gray|slate|neutral|zinc|stone|amber|yellow)-/,
  /^border/,
  /^rounded/,
  /^shadow/,
  /^px-/,
  /^py-/,
  /^p-/,
  /^font-(medium|semibold|bold)$/,
];

const allowedFragments = [
  'pf-segmented',
  'pf-fab',
  'pf-filter-chip',
  'contact-action-disabled',
  'dashboard-metric-card',
  'dashboard-owner-link',
  'pipeline-card',
  'schedule-job-card',
  'leaflet-',
  'skip-link',
  'nav-',
  'topbar-',
  'sidebar-',
  'menu-',
  'tab-',
  'status',
];

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

function extractAttribute(attrs, name) {
  const match = attrs.match(new RegExp(`${name}=["']([^"']*)["']`));
  return match?.[1] || '';
}

function tokenList(classValue) {
  return classValue.split(/\s+/).filter(Boolean).map((token) => token.replace(/^(sm|md|lg|xl|2xl):/, ''));
}

function hasButtonRole(classValue) {
  const tokens = classValue.split(/\s+/);
  return buttonRoles.some((role) => tokens.includes(role));
}

function looksRawButton(classValue) {
  const tokens = tokenList(classValue);
  const rawHits = tokens.filter((token) => rawButtonTokens.some((pattern) => pattern.test(token)));
  return rawHits.length >= 3;
}

function hasAllowedFragment(classValue) {
  return allowedFragments.some((fragment) => classValue.includes(fragment));
}

function isDestructive(classValue, attrs, innerHtml) {
  return /\b(text|bg|border)-red-/.test(classValue)
    || /\btime-danger/.test(classValue)
    || /\bdelete|remove|void|reject|archive|deactivate/i.test(`${attrs} ${innerHtml}`);
}

function looksLikeActionLink(classValue) {
  return /\b(inline-flex|items-center|justify-center|w-full)\b/.test(classValue) && looksRawButton(classValue);
}

function destructiveIsStyled(classValue) {
  return classValue.includes('btn-icon-danger')
    || classValue.includes('time-danger')
    || (classValue.includes('btn-text') && /\btext-red-/.test(classValue));
}

function suggestionFor(rule) {
  if (rule === 'missing-role') return 'Use btn-primary for the main action, btn-secondary/btn-outlined for supporting actions, btn-text for low-emphasis actions, or btn-icon for icon-only actions.';
  if (rule === 'raw-style') return 'Move raw padding/background/border typography into a design-system button variant.';
  if (rule === 'destructive-style') return 'Use btn-icon-danger for destructive icon buttons or a low-emphasis red btn-text for destructive text actions.';
  return 'Use the shared button classes in design-system.css.';
}

function lintFile(filePath, source) {
  const warnings = [];
  const elementPattern = /<(button|a)\b([^>]*)>([\s\S]*?)(?:<\/\1>|$)/g;
  let match;
  while ((match = elementPattern.exec(source))) {
    const tag = match[1].toLowerCase();
    const attrs = match[2] || '';
    const innerHtml = match[3] || '';
    if (tag === 'a' && !/\bhref=/.test(attrs)) continue;
    const classValue = extractAttribute(attrs, 'class') || extractAttribute(attrs, 'className');
    if (!classValue || hasAllowedFragment(classValue)) continue;
    const hasRole = hasButtonRole(classValue);

    if (!hasRole && tag === 'button') {
      warnings.push({ file: filePath, line: lineForOffset(source, match.index), tag, classValue, rule: 'missing-role' });
      continue;
    }

    if (!hasRole && tag === 'a' && looksLikeActionLink(classValue)) {
      warnings.push({ file: filePath, line: lineForOffset(source, match.index), tag, classValue, rule: 'raw-style' });
      continue;
    }

    if (hasRole && isDestructive(classValue, attrs, innerHtml) && !destructiveIsStyled(classValue)) {
      warnings.push({ file: filePath, line: lineForOffset(source, match.index), tag, classValue, rule: 'destructive-style' });
    }
  }
  return warnings;
}

const files = (await Promise.all(scanRoots.map((dir) => listFiles(path.join(root, dir))))).flat();
const warnings = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  warnings.push(...lintFile(path.relative(root, file), source));
}

const overBudget = Number.isFinite(maxWarnings) && warnings.length > maxWarnings;
const overBaseline = Number.isFinite(baseline) && warnings.length > baseline;
const shouldPrintDetails = verbose || overBudget || overBaseline;

if (shouldPrintDetails) {
  const limited = warnings.slice(0, printLimit);
  for (const warning of limited) {
    const message = `Button hierarchy warning (${warning.rule}) on <${warning.tag}>. ${suggestionFor(warning.rule)} Classes: ${warning.classValue || '(none)'}`;
    if (process.env.GITHUB_ACTIONS) {
      console.log(`::warning file=${warning.file},line=${warning.line},title=Button hierarchy::${message}`);
    } else {
      console.warn(`${warning.file}:${warning.line} ${message}`);
    }
  }

  if (warnings.length > printLimit) {
    console.warn(`... ${warnings.length - printLimit} additional button warnings hidden. Re-run with --verbose --print-limit=${warnings.length} to see all.`);
  }
}

const budgetCopy = Number.isFinite(baseline)
  ? ` Baseline budget: ${baseline}; ${warnings.length <= baseline ? `${baseline - warnings.length} warning${baseline - warnings.length === 1 ? '' : 's'} under budget.` : `${warnings.length - baseline} over budget.`}`
  : '';
console.log(`Button lint: ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.${budgetCopy} Prefer ${buttonRoles.join(', ')}. Use --verbose for details.`);

if (overBaseline) {
  console.error(`Button lint failed: ${warnings.length} warnings exceeds baseline ${baseline}. Use shared btn-* classes or update the baseline after an intentional audit.`);
  process.exit(1);
}

if (overBudget) {
  console.error(`Button lint failed: ${warnings.length} warnings exceeds --max-warnings=${maxWarnings}.`);
  process.exit(1);
}
