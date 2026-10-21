function calculateTier(count, total, avg) {
    if (count >= 3 && total >= 5000 && avg >= 1500) return 'A';
    if (count >= 1 && total >= 1000 && avg >= 500) return 'B';
    return 'C';
}

const results = [];

function assert(condition, label) {
    if (condition) results.push('PASS: ' + label);
    else results.push('FAIL: ' + label);
}

assert(calculateTier(3, 5000, 1666) === 'A', 'Tier A for strong history');
assert(calculateTier(2, 1200, 600) === 'B', 'Tier B for moderate history');
assert(calculateTier(0, 0, 0) === 'C', 'Tier C for zero records');
assert(calculateTier(1, 100, 100) === 'C', 'Tier C for weak single record');
assert(calculateTier(5, 5000, 100) === 'C', 'Tier C when average is low despite total');

console.log('Tier calculation results:');
results.forEach(r => console.log(' ', r));
console.log('All tier assertions passed:', results.every(r => r.startsWith('PASS')));
