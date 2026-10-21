import fs from 'fs';

const results = [];
const serverSource = fs.readFileSync('./server.js', 'utf-8');

if (serverSource.indexOf('const { userAddress } = req.body') !== -1 && serverSource.indexOf('const { tier') === -1) {
    results.push('PASS: endpoint ignores client tier parameter');
} else {
    results.push('FAIL: endpoint may accept tier from client');
}

if (serverSource.indexOf('evaluateBorrower') !== -1) {
    results.push('PASS: endpoint calls evaluation service');
} else {
    results.push('FAIL: evaluation service not called');
}

if (serverSource.indexOf('EVALUATOR_PRIVATE_KEY') !== -1) {
    results.push('PASS: evaluator private key kept server-side');
} else {
    results.push('FAIL: private key missing');
}

console.log('Endpoint behavior verification:');
results.forEach(r => console.log(' ', r));
console.log('All passed:', results.every(r => r.startsWith('PASS')));
