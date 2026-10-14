#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const README_PATH = path.join(__dirname, '..', 'README.md');
const HTML_PATH = path.join(__dirname, '..', 'docs', 'index.html');

async function getStars(owner, repo, token) {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = {
    'User-Agent': 'sort-projects-script',
    'Accept': 'application/vnd.github.v3+json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(`Warning: fetch failed for ${owner}/${repo}: ${res.status} ${res.statusText}`);
      return null;
    }
    const data = await res.json();
    return typeof data.stargazers_count === 'number' ? data.stargazers_count : 0;
  } catch (err) {
    console.error(`Error fetching stars for ${owner}/${repo}:`, err.message);
    return null;
  }
}

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  if (!fs.existsSync(README_PATH)) {
    console.error(`README.md not found at ${README_PATH}`);
    process.exit(1);
  }

  const readme = fs.readFileSync(README_PATH, 'utf8');
  const tableRegex = /(###\s+Featured projects\s*\n\n)(\|[\s\S]*?)(?=\n\n(?:<\/div>|<picture>|---|\w|#))/;
  const tableMatch = readme.match(tableRegex);

  if (!tableMatch) {
    console.error('Could not find Featured projects table in README.md');
    process.exit(1);
  }

  const prefix = tableMatch[1];
  const tableContent = tableMatch[2].trim();
  const tableLines = tableContent.split('\n');

  if (tableLines.length < 3) {
    console.error('Table does not contain enough rows.');
    process.exit(1);
  }

  const header = tableLines.slice(0, 2);
  const rows = tableLines.slice(2);

  const projects = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cols = row.split('|').map(s => s.trim()).filter(Boolean);
    if (cols.length < 2) continue;

    const linkMatch = cols[0].match(/\[`([^`]+)`\]\((https:\/\/github\.com\/([^\/]+)\/([^\)\/\s]+))\)/);
    if (!linkMatch) {
      console.warn(`Skipping unparseable row: ${row}`);
      continue;
    }

    const [_, displayName, url, owner, repo] = linkMatch;
    const desc = cols[1];
    const badge = cols[2];

    projects.push({
      originalIndex: i,
      displayName,
      url,
      owner,
      repo,
      repoKey: repo.toLowerCase(),
      desc,
      badge,
      rawRow: row,
      stars: 0,
    });
  }

  console.log(`Found ${projects.length} projects. Fetching star counts...`);

  for (const p of projects) {
    const stars = await getStars(p.owner, p.repo, token);
    if (stars !== null) {
      p.stars = stars;
    }
    console.log(`- ${p.displayName}: ${p.stars} stars`);
  }

  projects.sort((a, b) => {
    if (b.stars !== a.stars) {
      return b.stars - a.stars;
    }
    return a.originalIndex - b.originalIndex;
  });

  console.log('\nSorted rank:');
  projects.forEach((p, idx) => {
    console.log(`  ${idx + 1}. ${p.displayName} (${p.stars} stars)`);
  });

  const maxCol0 = Math.max(7, ...projects.map(p => `[\`${p.displayName}\`](${p.url})`.length));
  const maxCol1 = Math.max(12, ...projects.map(p => p.desc.length));
  const maxCol2 = Math.max(5, ...projects.map(p => p.badge.length));

  const newHeader = [
    `| ${'Project'.padEnd(maxCol0)} | ${'What it does'.padEnd(maxCol1)} | ${'Stars'.padEnd(maxCol2)} |`,
    `| ${'-'.repeat(maxCol0)} | ${'-'.repeat(maxCol1)} | ${'-'.repeat(maxCol2)} |`
  ];

  const newRows = projects.map(p => {
    const col0 = `[\`${p.displayName}\`](${p.url})`.padEnd(maxCol0);
    const col1 = p.desc.padEnd(maxCol1);
    const col2 = p.badge.padEnd(maxCol2);
    return `| ${col0} | ${col1} | ${col2} |`;
  });

  const newTable = [...newHeader, ...newRows].join('\n');
  const newReadme = readme.replace(tableRegex, `${prefix}${newTable}`);

  if (newReadme !== readme) {
    fs.writeFileSync(README_PATH, newReadme, 'utf8');
    console.log('\nUpdated README.md with sorted table.');
  } else {
    console.log('\nREADME.md table is already in sorted order.');
  }

  if (fs.existsSync(HTML_PATH)) {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const repoListRegex = /(<div class="repo-list">)([\s\S]*?)(<\/div>)/;
    const repoListMatch = html.match(repoListRegex);

    if (repoListMatch) {
      const openTag = repoListMatch[1];
      const listContent = repoListMatch[2];
      const closeTag = repoListMatch[3];

      const htmlBlocks = listContent.match(/<a[\s\S]*?<\/a>/g) || [];
      const htmlDescMap = new Map();

      for (const block of htmlBlocks) {
        const hrefMatch = block.match(/href="https:\/\/github\.com\/[^\/]+\/([^\/\s"]+)"/);
        const spanMatch = block.match(/<span>([\s\S]*?)<\/span>/);
        if (hrefMatch && spanMatch) {
          htmlDescMap.set(hrefMatch[1].toLowerCase(), spanMatch[1].trim());
        }
      }

      const formattedBlocks = projects.map(p => {
        const htmlDesc = htmlDescMap.get(p.repoKey) || (p.desc.endsWith('.') ? p.desc : `${p.desc}.`);
        return [
          `            <a class="repo" href="${p.url}">`,
          `              <strong>${p.displayName}</strong>`,
          `              <span>${htmlDesc}</span>`,
          `            </a>`
        ].join('\n');
      }).join('\n');

      const newHtml = html.replace(repoListRegex, `${openTag}\n${formattedBlocks}\n          ${closeTag}`);

      if (newHtml !== html) {
        fs.writeFileSync(HTML_PATH, newHtml, 'utf8');
        console.log('Updated docs/index.html with sorted projects.');
      } else {
        console.log('docs/index.html is already in sorted order.');
      }
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
