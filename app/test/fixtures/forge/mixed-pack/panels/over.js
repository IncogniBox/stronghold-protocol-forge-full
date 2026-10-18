import { writeFileSync } from 'node:fs';
writeFileSync(`${process.env.TEMP || '/tmp'}/sp-forge-bait-wp-h.txt`, 'executed\n');
