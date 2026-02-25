import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const BASE_URL = 'https://ultimateframedata.com';
const CHARACTER_LIST_URL = `${BASE_URL}/smash`;
const OUTPUT_DIR = './data/framedata';

// Map of section headings to CSV filenames
// Note: Dodges/Rolls skipped as that data is already in stats
const SECTION_MAPPING = {
  'Ground Attacks': 'ground_attacks',
  'Tilt Attacks': 'tilt_attacks',
  'Smash Attacks': 'smash_attacks',
  'Aerial Attacks': 'aerial_attacks',
  'Special Attacks': 'special_attacks',
  'Grabs / Throws': 'grab_throws'
};

// Known characters with their URL slugs (will be populated dynamically)
const characterList = [];

/**
 * Fetch the main page using Playwright and extract all character links
 * Uses browser automation to load all dynamically loaded characters
 */
async function getCharacterList() {
  let browser = null;
  try {
    console.log(`📥 Fetching character list from ${CHARACTER_LIST_URL}...`);
    
    // Launch browser and navigate to page
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(CHARACTER_LIST_URL, { waitUntil: 'networkidle' });
    
    // Wait a bit more to ensure all lazy-loaded content is loaded
    await page.waitForTimeout(2000);
    
    // Extract all character links using evaluate
    const characters = await page.evaluate(() => {
      const chars = [];
      
      // Find all links that look like character pages
      document.querySelectorAll('a[href^="/"]').forEach(link => {
        const href = link.getAttribute('href');
        const text = link.textContent.trim();
        
        // Character pages are single-word or underscore-separated slugs
        // Exclude common navigation links
        if (href && /^\/[a-z_]+$/.test(href) && 
            ['/', '/smash', '/stats'].indexOf(href) === -1 &&
            text.length > 0) {
          const slug = href.replace(/^\//, '');
          chars.push({ name: text, slug });
        }
      });
      
      return chars;
    });
    
    // Remove duplicates
    const uniqueCharacters = [];
    const seen = new Set();
    for (const char of characters) {
      if (!seen.has(char.slug)) {
        seen.add(char.slug);
        uniqueCharacters.push({
          ...char,
          url: `${BASE_URL}/${char.slug}`
        });
      }
    }
    
    console.log(`✅ Found ${uniqueCharacters.length} characters`);
    return uniqueCharacters;
  } catch (error) {
    console.error(`❌ Error fetching character list: ${error.message}`);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Parse frame data from move containers
 * The website uses <div class="movecontainer"> with child divs for each data field
 */
function parseFrameDataSection($, sectionElement) {
  const moves = [];
  
  // Find all movecontainers within this section
  $(sectionElement).find('.movecontainer').each((i, container) => {
    const $container = $(container);
    
    // Extract data from each field div
    const moveName = $container.find('.movename').text().trim();
    const startup = $container.find('.startup').text().trim();
    const totalFrames = $container.find('.totalframes').text().trim();
    const landingLag = $container.find('.landinglag').text().trim();
    const notes = $container.find('.notes').text().trim();
    const baseDamage = $container.find('.basedamage').text().trim();
    const shieldLag = $container.find('.shieldlag').text().trim();
    const shieldStun = $container.find('.shieldstun').text().trim();
    const whichHitbox = $container.find('.whichhitbox').text().trim();
    const advantage = $container.find('.advantage').text().trim();
    const activeFrames = $container.find('.activeframes').text().trim();
    const endLag = $container.find('.endlag').text().trim();
    
    // Extract all GIF URLs from data-src attributes (some moves have multiple hitbox images)
    const gifUrls = [];
    $container.find('img[data-src]').each((_, img) => {
      const src = $(img).attr('data-src');
      if (!src) return;
      const full = /^https?:\/\//i.test(src.trim())
        ? src.trim()
        : `${BASE_URL}/${src.replace(/^\//, '')}`;
      gifUrls.push(full);
    });
    const gifUrl = [...new Set(gifUrls)].join('|');
    
    // Only add if we have a move name
    if (moveName) {
      moves.push({
        moveName,
        startup: startup === '**' ? '' : startup,
        totalFrames: totalFrames === '**' ? '' : totalFrames,
        landingLag: landingLag === '--' ? '' : landingLag,
        notes: notes === '--' ? '' : notes,
        baseDamage: baseDamage === '--' ? '' : baseDamage,
        shieldLag: shieldLag === '--' ? '' : shieldLag,
        shieldStun: shieldStun === '--' ? '' : shieldStun,
        whichHitbox: whichHitbox === '--' ? '' : whichHitbox,
        onShield: advantage === '--' ? '' : advantage,
        activeFrames: activeFrames === '**' ? '' : activeFrames,
        endLag: endLag.trim() === '--' ? '' : endLag.trim(),
        gifUrl: gifUrl || ''
      });
    }
  });
  
  return moves;
}

/**
 * Scrape frame data for a specific character
 */
async function scrapeCharacterFrameData(characterUrl, characterName) {
  try {
    console.log(`  📄 Fetching ${characterName}...`);
    const { data } = await axios.get(characterUrl);
    const $ = cheerio.load(data);
    
    // Find all section headings (h2 with class movecategory)
    const sections = {};
    
    const h2Elements = $('h2.movecategory');
    console.log(`  📊 Found ${h2Elements.length} section headings`);
    
    $('h2.movecategory').each((i, elem) => {
      const heading = $(elem).text().trim();
      const headingId = $(elem).attr('id');
      const mappedSection = SECTION_MAPPING[heading];
      
      console.log(`    - "${heading}" -> ${mappedSection || 'NOT MAPPED'}`);
      
      if (mappedSection) {
        // Find the next moves div after this heading
        const movesDiv = $(elem).nextAll('.moves').first();
        if (movesDiv.length) {
          sections[mappedSection] = {
            heading: heading,
            element: movesDiv,
            $: $
          };
          console.log(`      ✅ Found moves div`);
        } else {
          console.log(`      ⚠️ No moves div found`);
        }
      }
    });
    
    return sections;
  } catch (error) {
    console.error(`  ❌ Error scraping ${characterName}:`, error.message);
    return {};
  }
}

/**
 * Convert move data to CSV format
 */
function moveDataToCsv(moves) {
  if (moves.length === 0) return '';
  
  const headers = [
    'Move Name',
    'Startup',
    'Total Frames',
    'Landing Lag',
    'Notes',
    'Base Damage',
    'Shield Lag',
    'Shield Stun',
    'Property 1',
    'On Shield',
    'Active Frames',
    'End Lag',
    'GIF URL'
  ];
  
  const csvLines = [headers.join(',')];
  
  moves.forEach(move => {
    const row = [
      move.moveName,
      move.startup,
      move.totalFrames,
      move.landingLag,
      move.notes,
      move.baseDamage,
      move.shieldLag,
      move.shieldStun,
      move.whichHitbox,
      move.onShield,
      move.activeFrames,
      move.endLag,
      move.gifUrl || ''
    ];
    
    // Escape CSV values that contain commas, quotes, or newlines
    const escapedRow = row.map(cell => {
      const cellStr = String(cell || '').trim();
      if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
        return `"${cellStr.replace(/"/g, '""')}"`;
      }
      return cellStr;
    });
    
    csvLines.push(escapedRow.join(','));
  });
  
  return csvLines.join('\n');
}

/**
 * Main scraper function
 */
async function scrapeAllCharacterFrameData() {
  try {
    // Create output directory
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    
    // Get character list
    const characters = await getCharacterList();
    if (characters.length === 0) {
      console.log('⚠️  No characters found');
      return;
    }
    
    console.log(`\n🔄 Scraping frame data for ${characters.length} characters...\n`);
    
    let totalFilesCreated = 0;
    
    // Scrape each character
    for (const character of characters) {
      try {
        console.log(`\n👤 ${character.name}`);
        
        const sections = await scrapeCharacterFrameData(character.url, character.name);
        
        if (!sections || Object.keys(sections).length === 0) {
          console.log(`  ⚠️  No frame data found`);
          continue;
        }
        
        // Create character directory
        const characterSlug = character.slug.replace(/_/g, '-');
        const characterDir = path.join(OUTPUT_DIR, characterSlug);
        if (!fs.existsSync(characterDir)) {
          fs.mkdirSync(characterDir, { recursive: true });
        }
        
        // Process each section and create CSV files
        for (const [sectionKey, sectionData] of Object.entries(sections)) {
          try {
            // Don't reload cheerio, just use the element directly
            const moves = parseFrameDataSection(sectionData.$, sectionData.element);
            
            if (moves.length === 0) {
              console.log(`  ⚠️  No moves found in ${sectionKey}`);
              continue;
            }
            
            // Create filename: section.csv inside character directory
            const filename = `${sectionKey}.csv`;
            const filepath = path.join(characterDir, filename);
            
            // Write CSV file
            const csv = moveDataToCsv(moves);
            fs.writeFileSync(filepath, csv, 'utf8');
            
            console.log(`  ✅ Created ${characterSlug}/${filename} (${moves.length} moves)`);
            totalFilesCreated++;
          } catch (sectionError) {
            console.error(`  ⚠️  Error processing ${sectionKey}:`, sectionError.message);
            continue;
          }
        }
      } catch (charError) {
        console.error(`❌ Error processing ${character.name}:`, charError.message);
        continue;
      }
    }
    
    console.log(`\n✨ Complete! Created ${totalFilesCreated} CSV files in ${OUTPUT_DIR}`);
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
  }
}

// Run the scraper
scrapeAllCharacterFrameData();
