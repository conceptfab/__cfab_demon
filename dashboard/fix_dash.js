const fs = require('fs');
const path = require('path');

const file = 'C:\\_cloud\\__timeflow_demon\\dashboard\\src\\pages\\Dashboard.tsx';
let txt = fs.readFileSync(file, 'utf8');

txt = txt.replace('minHeightClassName="min-h-[26rem]"', '');

fs.writeFileSync(file, txt);
console.log('Fixed');

