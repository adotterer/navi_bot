import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const URL = 'https://ultimateframedata.com/stats';
const OUTPUT_DIR = './data/stats';

async function scrapeFrameData() {
  try {
    const { data } = await axios.get(URL);
    const $ = cheerio.load(data);
    
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const sections = [];
    
    $('h2').each((i, elem) => {
      const heading = $(elem).text().trim();
      // Tables are inside the next div or sibling element
      const nextDiv = $(elem).nextAll('div').first();
      const table = nextDiv.find('table').first();
      
      if (table.length) {
        sections.push({ heading, table });
      }
    });

    sections.forEach(({ heading, table }) => {
      // Extract headers from <th> elements
      const headerCells = [];
      $(table).find('thead tr th, tr th').each((i, cell) => {
        headerCells.push($(cell).text().trim());
      });
      
      // Extract data rows from <td> elements
      const rows = [];
      $(table).find('tr').each((i, row) => {
        const cells = [];
        $(row).find('td').each((j, cell) => {
          let text = $(cell).text().trim();
          if (text === '**') text = '';
          cells.push(text);
        });
        
        if (cells.length > 0 && cells[0] !== '') {
          rows.push(cells);
        }
      });

      if (rows.length === 0) return;

      // Use extracted headers or create defaults
      let headers = ['Character'];
      if (headerCells.length > 0) {
        // Use the actual header names, skipping empty ones
        headers = headerCells.filter(h => h.length > 0);
        
        // If first header isn't "Character", prepend it
        if (headers[0] !== 'Character') {
          headers.unshift('Character');
        }
      } else {
        // Fallback to generic headers if none found
        const valueCount = rows[0].length - 1;
        for (let i = 1; i <= valueCount; i++) {
          headers.push(`Value${i}`);
        }
      }

      const csvLines = [headers.join(',')];
      rows.forEach(row => {
        const escapedRow = row.map(cell => {
          if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
            return `"${cell.replace(/"/g, '""')}"`;
          }
          return cell;
        });
        csvLines.push(escapedRow.join(','));
      });

      const filename = heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.csv';
      const filepath = path.join(OUTPUT_DIR, filename);
      fs.writeFileSync(filepath, csvLines.join('\n'), 'utf8');
      console.log(`Created: ${filename} (${rows.length} rows, ${headers.length} columns)`);
    });

    console.log(`\nComplete! Scraped ${sections.length} stat tables.`);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

scrapeFrameData();
