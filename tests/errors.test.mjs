// Run with:
//   npx esbuild src/errors.ts --format=esm --outfile=tests/.errors.mjs && node tests/errors.test.mjs
//
// Proves the error normaliser can never render "[object Object]" for any of the
// shapes a wallet or RPC layer actually throws.
import { normalizeError, reportError, isUserRejection, errorCode } from './.errors.mjs'

const origError = console.error
console.error = () => {}   // silence the intentional raw logging during the test

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; origError.call(console, 'PASS  ' + name) }
  else { fail++; origError.call(console, 'FAIL  ' + name + '  ' + detail) }
}

// The exact shapes a wallet / RPC layer actually throws.
const cases = [
  ['MetaMask user rejection (plain object)', { code: 4001, message: 'User rejected the request.' }],
  ['MetaMask rejection nested in data',      { message: 'Internal JSON-RPC error.', data: { code: 4001, message: 'User rejected the request.' } }],
  ['unknown chain',                          { code: 4902, message: 'Unrecognized chain ID.' }],
  ['pending request',                        { code: -32002, message: 'Request already pending.' }],
  ['snap unsupported',                       { code: -32601, message: 'The method does not exist.' }],
  ['wallet internal error',                  { code: -32603, message: 'Internal error' }],
  ['bare object, no code/message',           { foo: 'bar' }],
  ['empty object',                           {} ],
  ['null',                                   null],
  ['undefined',                              undefined],
  ['string throw',                           'something broke'],
  ['number throw',                           42],
  ['real Error',                             new Error('MetaMask is not installed.')],
  ['viem-style multiline',                   { shortMessage: 'User rejected the request.', message: 'User rejected the request.\n\nDetails: ...\nVersion: viem@2.21' }],
  ['deeply nested cause',                    { message: 'x', cause: { data: { originalError: { code: 4001 } } } }],
  ['array throw',                            [1, 2, 3]],
]

for (const [name, thrown] of cases) {
  const shown = reportError('test', thrown)
  check(`${name}: no [object Object]`, !shown.includes('[object Object]'), `-> ${shown}`)
  check(`${name}: non-empty message`, typeof shown === 'string' && shown.trim().length > 0, `-> ${shown}`)
  check(`${name}: single line`, !shown.includes('\n'), `-> ${JSON.stringify(shown)}`)
}

// Friendly copy for the codes this flow really produces.
check('4001 -> friendly', normalizeError({ code: 4001, message: 'User rejected the request.' }).message.includes('rejected the request in your wallet'))
check('4902 -> friendly', normalizeError({ code: 4902 }).message.includes('not added to your wallet'))
check('-32601 -> friendly + says optional', normalizeError({ code: -32601 }).message.includes('optional'))
check('nested code is found', String(errorCode({ cause: { data: { originalError: { code: 4001 } } } })) === '4001')
check('isUserRejection true for 4001', isUserRejection({ code: 4001 }) === true)
check('isUserRejection false for 4902', isUserRejection({ code: 4902 }) === false)
check('message is truncated', normalizeError({ message: 'x'.repeat(5000) }).message.length <= 240)
check('code shown in output', reportError('t', { code: 4001 }).includes('(code 4001)'))
check('no code -> no parens', !reportError('t', new Error('plain')).includes('(code'))

// Regression: this is exactly what the old code did.
const oldBehaviour = (e) => (e instanceof Error ? e.message : String(e))
check('OLD code really did produce [object Object]', oldBehaviour({ code: 4001, message: 'User rejected the request.' }) === '[object Object]')

console.error = origError
console.log(`\nTOTAL: ${pass + fail} checks, ${fail} failed`)
process.exit(fail ? 1 : 0)
