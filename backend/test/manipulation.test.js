import fs from 'fs';

const results = [];

const serverSource = fs.readFileSync('./server.js', 'utf-8');

if (serverSource.includes('const { userAddress } = req.body') && serverSource.indexOf('const { tier') === -1) {
    results.push('PASS: endpoint does not read tier from request body');
} else {
    results.push('FAIL: endpoint may accept tier from client');
}

if (serverSource.includes('evaluateBorrower')) {
    results.push('PASS: endpoint uses evaluateBorrower');
} else {
    results.push('FAIL: endpoint missing evaluation service');
}

console.log('Manipulation test results:');
results.forEach(r => console.log(' ', r));
console.log('All passed:', results.every(r => r.startsWith('PASS')));
